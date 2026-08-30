/**
 * WebSocket manager for streaming execution events.
 *
 * Implements the RFC 6455 server side with a hardened frame decoder:
 * - per-socket receive buffering (a frame may span several TCP segments and
 *   several frames may arrive in one segment);
 * - strict length bounds (attacker-supplied lengths cannot drive Buffer.alloc,
 *   and the per-socket receive buffer is capped) so malformed peers cannot
 *   grow memory without limit;
 * - masked-client-frame enforcement, bounded control frames, and full socket
 *   teardown (destroy, not half-close) on any protocol error so offending
 *   bytes can never accumulate behind a half-closed connection;
 * - an outbound write backlog cap so a peer that stops reading cannot make
 *   the server buffer frames in memory without bound;
 * - optional Origin allow-list to mitigate cross-site WebSocket hijacking.
 */
import { createHash } from 'node:crypto';
import type { Server, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

/** Maximum accepted payload for a single WebSocket frame (bytes). */
export const MAX_WS_FRAME_SIZE = 1_000_000;

/**
 * Max bytes of outbound frames allowed to sit in a socket's write queue before
 * the connection is dropped. Bounds memory for peers that never read.
 */
export const MAX_WS_OUTBOUND_BACKLOG = 1_000_000;

interface WSClient {
  id: string;
  send: (data: string) => void;
  close: () => void;
  filter?: Set<string>;
}

interface WSEvent {
  type: string;
  payload: unknown;
  timestamp: string;
}

/** Decoded frame (payload unmasked, opcode preserved). */
interface ParsedFrame {
  opcode: number;
  payload: Buffer;
  consumed: number;
}

/** Thrown for protocol violations; leads to teardown of the connection. */
class WsProtocolError extends Error {}

/** Per-connection receive buffer for frame reassembly. */
interface RxBuffer {
  chunks: Buffer[];
  length: number;
}

/** Coalesce the receive buffer once it holds this many chunks, so a peer
 * micro-fragmenting a large frame cannot retain unbounded small-Buffer
 * objects (each ~100B of V8 overhead) under a fixed payload cap. */
const MAX_RX_CHUNKS = 64;

/**
 * Extract the hostname (port stripped, lowercased) from an HTTP `Host`
 * header value. IPv6 literals keep their brackets: `[::1]:3002` → `[::1]`.
 */
export function hostHeaderHostname(hostHeader: string): string {
  const h = hostHeader.trim().toLowerCase();
  if (h.startsWith('[')) {
    const end = h.indexOf(']');
    return end === -1 ? h : h.slice(0, end + 1);
  }
  const colon = h.lastIndexOf(':');
  return colon === -1 ? h : h.slice(0, colon);
}

/**
 * Host-match Origin rule (D5): with no explicit origin allow-list, a browser
 * upgrade is only accepted when its Origin HOSTNAME equals the request Host
 * hostname (ports may differ — the GUI page on `http://localhost:3081`
 * legitimately opens `ws://localhost:3002`). A page on any other host
 * (`https://evil.example`) fails: previously an empty allow-list accepted
 * ANY Origin, which is cross-site WebSocket hijacking on the legacy socket.
 * Requests with no Origin header (curl, SDKs, server-to-server) pass —
 * browsers always send Origin on WebSocket handshakes.
 */
export function sameHostOrigin(
  origin: string | undefined,
  hostHeader: string | undefined,
): boolean {
  // Non-browser clients (tools, SDKs) send no Origin; browsers always do.
  if (origin === undefined || origin === '') return true;
  // The literal `null` origin (sandboxed iframe, file://) is never same-host.
  if (origin === 'null') return false;
  if (hostHeader === undefined || hostHeader === '') return false;
  let originHost: string;
  try {
    originHost = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (originHost === '') return false;
  return originHost === hostHeaderHostname(hostHeader);
}

/**
 * Shared WebSocket upgrade Origin gate (D5), used by BOTH the legacy
 * node:http manager and the Bun realtime hub wiring in main.ts. Precedence
 * (identical to the REST CORS policy in AetherServer):
 * - list contains the literal '*' → any browser origin allowed (explicit
 *   operator opt-in, e.g. a remote/Docker GUI), except the opaque `null`
 *   origin which REST always denies too;
 * - other non-empty list → exact-match (no-Origin requests still pass);
 * - empty list → the host-match rule, NOT "accept anything".
 */
export function isUpgradeOriginAllowed(
  origin: string | undefined,
  hostHeader: string | undefined,
  allowedOrigins: string[],
): boolean {
  if (allowedOrigins.includes('*')) return origin !== 'null';
  if (allowedOrigins.length > 0) {
    if (origin === undefined || origin === '') return true;
    return allowedOrigins.includes(origin);
  }
  return sameHostOrigin(origin, hostHeader);
}

export class WebSocketManager {
  private clients = new Map<string, WSClient>();
  private server: Server | null = null;
  private upgradeHandler: ((req: IncomingMessage, socket: Duplex, head: Buffer) => void) | null =
    null;
  private allowedOrigins: string[] = [];

  /** Per-socket receive buffer for frame reassembly. */
  private rx = new WeakMap<Duplex, RxBuffer>();
  /** Per-socket outbound backlog state (bytes queued while back-pressured). */
  private tx = new WeakMap<Duplex, { buffered: number; drainBound: boolean }>();

  /**
   * Restrict WebSocket upgrades by `Origin` header. A non-empty array uses
   * exact-match semantics; an empty array applies the host-match default
   * (see `sameHostOrigin`) — it no longer accepts any Origin (D5). Pass
   * e.g. `['http://localhost:5173']` to pin an explicit origin.
   */
  setAllowedOrigins(origins: string[]): void {
    this.allowedOrigins = origins;
  }

  /**
   * Attach the upgrade handler to an HTTP server.
   *
   * @param authenticate - Optional request authenticator; when provided, an
   *   upgrade is rejected unless it returns true (API-key auth for event
   *   streaming).
   */
  attach(server: Server, authenticate?: (req: IncomingMessage) => boolean): void {
    // Re-attach safety: a previous upgrade listener on the same (or an older)
    // server must be removed first, or a second attach() would double-handshake
    // every upgrade and leak a stale listener.
    if (this.server && this.upgradeHandler) {
      this.server.removeListener('upgrade', this.upgradeHandler);
    }
    this.server = server;

    this.upgradeHandler = (req, socket, head) => {
      if (!this.isOriginAllowed(req)) {
        socket.destroy();
        return;
      }

      if (authenticate && !authenticate(req)) {
        socket.destroy();
        return;
      }

      const key = req.headers['sec-websocket-key'];
      if (!key) {
        socket.destroy();
        return;
      }

      const acceptKey = this.generateAcceptValue(key);
      const responseHeaders = [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${acceptKey}`,
        '',
        '',
      ].join('\r\n');

      socket.write(responseHeaders);
      if (head.length > 0) {
        try {
          this.pushRx(socket, head);
        } catch {
          socket.destroy();
          return;
        }
      }

      const clientId = crypto.randomUUID();
      const client: WSClient = {
        id: clientId,
        send: (data: string) => {
          this.writeFrame(socket, this.createTextFrame(data));
        },
        close: () => {
          try {
            socket.destroy();
          } catch {
            /* ignore */
          }
          this.clients.delete(clientId);
          this.rx.delete(socket);
        },
      };

      this.clients.set(clientId, client);

      socket.on('data', (chunk: Buffer) => {
        try {
          this.pushRx(socket, chunk);
          this.processFrames(client, socket);
        } catch (err) {
          // Malformed or oversized input: tear the connection down completely.
          // A half-close (socket.end()) would leave the readable side open and
          // let the peer keep appending to the rx buffer forever.
          if (!(err instanceof WsProtocolError)) {
            console.error('[WebSocket] frame decode error:', err);
          }
          this.clients.delete(clientId);
          this.rx.delete(socket);
          try {
            socket.destroy();
          } catch {
            /* ignore */
          }
        }
      });

      socket.on('close', () => {
        this.clients.delete(clientId);
        this.rx.delete(socket);
      });

      socket.on('error', () => {
        this.clients.delete(clientId);
        this.rx.delete(socket);
      });

      if (head.length > 0) {
        // The pipelined head may already hold a complete frame (e.g. a filter
        // subscription sent with the handshake) — dispatch it immediately.
        try {
          this.processFrames(client, socket);
        } catch (err) {
          if (!(err instanceof WsProtocolError)) {
            console.error('[WebSocket] frame decode error:', err);
          }
          this.clients.delete(clientId);
          this.rx.delete(socket);
          try {
            socket.destroy();
          } catch {
            /* ignore */
          }
        }
      }
    };

    server.on('upgrade', this.upgradeHandler);
  }

  detach(): void {
    if (this.server && this.upgradeHandler) {
      this.server.removeListener('upgrade', this.upgradeHandler);
      this.upgradeHandler = null;
    }
    this.server = null;
    const entries = Array.from(this.clients.entries());
    for (const [, client] of entries) {
      client.close();
    }
    this.clients.clear();
  }

  broadcast(type: string, payload: unknown): void {
    const event: WSEvent = {
      type,
      payload,
      timestamp: new Date().toISOString(),
    };
    const data = JSON.stringify(event);
    const entries = Array.from(this.clients.entries());
    for (const [, client] of entries) {
      if (client.filter && !client.filter.has(type)) continue;
      client.send(data);
    }
  }

  sendTo(clientId: string, type: string, payload: unknown): void {
    const client = this.clients.get(clientId);
    if (!client) return;
    const event: WSEvent = {
      type,
      payload,
      timestamp: new Date().toISOString(),
    };
    client.send(JSON.stringify(event));
  }

  get connectionCount(): number {
    return this.clients.size;
  }

  private isOriginAllowed(req: IncomingMessage): boolean {
    return isUpgradeOriginAllowed(
      typeof req.headers.origin === 'string' ? req.headers.origin : undefined,
      typeof req.headers.host === 'string' ? req.headers.host : undefined,
      this.allowedOrigins,
    );
  }

  /** Buffer raw bytes for a socket. Throws when the buffer would grow past
   * the frame bound (a peer streaming garbage faster than frames drain). */
  private pushRx(socket: Duplex, chunk: Buffer): void {
    let buf = this.rx.get(socket);
    if (!buf) {
      buf = { chunks: [chunk], length: chunk.length };
      this.rx.set(socket, buf);
      return;
    }
    // Accumulate up front so repeated partial-frame trickles do not re-copy
    // the whole prefix, and cap the total to bound memory. Two complete frames
    // may legitimately arrive coalesced in one chunk, hence the 2x allowance.
    if (buf.length + chunk.length > MAX_WS_FRAME_SIZE * 2 + 64) {
      throw new WsProtocolError('Receive buffer exceeds frame size limit');
    }
    buf.chunks.push(chunk);
    buf.length += chunk.length;
    if (buf.chunks.length > MAX_RX_CHUNKS) {
      const merged = Buffer.concat(buf.chunks);
      buf.chunks.length = 0;
      buf.chunks.push(merged);
    }
  }

  /** Decode and dispatch every complete frame currently buffered for a socket. */
  private processFrames(client: WSClient, socket: Duplex): void {
    const buf = this.rx.get(socket);
    if (!buf || buf.length === 0) return;

    let offset = 0;
    while (true) {
      const frame = this.tryParseFrame(buf.chunks, offset);
      if (frame === null) break;
      offset += frame.consumed;

      if (frame.opcode === 0x01) {
        // Text frame — expects a JSON control message (optional filter).
        try {
          const parsed = JSON.parse(frame.payload.toString('utf-8'));
          if (parsed.filter && Array.isArray(parsed.filter)) {
            client.filter = new Set<string>(parsed.filter);
          }
        } catch {
          /* ignore non-JSON control messages */
        }
      } else if (frame.opcode === 0x08) {
        // Close frame — full teardown (destroy, not a half-close) so no FD or
        // buffered rx lingers on a peer that stops talking.
        this.clients.delete(client.id);
        this.rx.delete(socket);
        try {
          socket.destroy();
        } catch {
          /* ignore */
        }
        return;
      } else if (frame.opcode === 0x09) {
        // Ping — answer with a pong carrying the same payload.
        this.writeFrame(socket, this.createFrame(0x0a, frame.payload));
      }
      // Binary frames are rejected in tryParseFrame; fragmented messages are
      // rejected at their first non-FIN frame, so nothing else reaches here.
    }

    // Drop the consumed prefix so the residual buffer only holds a partial
    // frame (keeps pushRx's memory bound meaningful).
    if (offset > 0) {
      const remaining = this.sliceBuffered(buf.chunks, offset);
      if (remaining.length === 0) {
        this.rx.delete(socket);
      } else {
        this.rx.set(socket, { chunks: [remaining], length: remaining.length });
      }
    }
  }

  /** Parse one frame starting at `offset` bytes into a chunked buffer.
   * Returns null when more bytes are needed. Throws WsProtocolError on
   * malformed or oversized frames (caller tears the connection down).
   * Accepts a raw Buffer (single chunk) as well as a chunk list. */
  private tryParseFrame(chunks: Buffer[] | Buffer, offset = 0): ParsedFrame | null {
    const list: Buffer[] = Array.isArray(chunks) ? chunks : [chunks];
    const first = this.readBytesAt(list, offset, 2);
    if (first === null) return null;

    const opcode = first[0] & 0x0f;
    // Fragmentation is unsupported: reject a non-FIN frame outright instead of
    // accepting the first fragment and then killing the socket on the
    // mandatory continuation frame that follows.
    const fin = (first[0] & 0x80) !== 0;
    if (!fin) throw new WsProtocolError('Fragmented frames are not supported');
    if (opcode !== 0x01 && opcode !== 0x08 && opcode !== 0x09) {
      throw new WsProtocolError(`Unsupported frame opcode: ${opcode}`);
    }

    const masked = (first[1] & 0x80) !== 0;
    // RFC 6455 §5.1: client-to-server frames MUST be masked.
    if (!masked) throw new WsProtocolError('Client frames must be masked');

    let length = first[1] & 0x7f;
    let headerLen = 2;

    if (length === 126) {
      const ext = this.readBytesAt(list, offset + 2, 2);
      if (ext === null) return null;
      length = ext.readUInt16BE(0);
      headerLen = 4;
    } else if (length === 127) {
      const ext = this.readBytesAt(list, offset + 2, 8);
      if (ext === null) return null;
      const bigLength = ext.readBigUInt64BE(0);
      // Reject absurd lengths before allocating a mask buffer.
      if (bigLength > BigInt(MAX_WS_FRAME_SIZE)) {
        throw new WsProtocolError('Frame payload exceeds size limit');
      }
      length = Number(bigLength);
      headerLen = 10;
    }

    if (opcode === 0x08 || opcode === 0x09) {
      // RFC 6455 §5.5: control frame payloads MUST be 125 bytes or fewer.
      if (length > 125) {
        throw new WsProtocolError('Control frame payload exceeds 125 bytes');
      }
    }
    if (length > MAX_WS_FRAME_SIZE) {
      throw new WsProtocolError('Frame payload exceeds size limit');
    }

    const mask = this.readBytesAt(list, offset + headerLen, 4);
    if (mask === null) return null;
    const payload = this.readBytesAt(list, offset + headerLen + 4, length);
    if (payload === null) return null;

    const unmasked = Buffer.allocUnsafe(length);
    for (let i = 0; i < length; i++) {
      unmasked[i] = payload[i] ^ mask[i % 4];
    }
    return { opcode, payload: unmasked, consumed: headerLen + 4 + length };
  }

  /**
   * Write one frame to a client socket under an outbound backlog cap. If the
   * peer stops reading (TCP window full), socket.write() buffers bytes in
   * memory without limit; past the cap the connection is dropped instead.
   */
  private writeFrame(socket: Duplex, frame: Buffer): void {
    let state = this.tx.get(socket);
    if (!state) {
      state = { buffered: 0, drainBound: false };
      this.tx.set(socket, state);
    }
    if (state.buffered > MAX_WS_OUTBOUND_BACKLOG) {
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
      return;
    }
    try {
      const ok = socket.write(frame);
      if (ok === false) {
        state.buffered += frame.length;
        if (!state.drainBound) {
          state.drainBound = true;
          socket.once('drain', () => {
            const s = this.tx.get(socket);
            if (s) {
              s.buffered = 0;
              s.drainBound = false;
            }
          });
        }
      }
    } catch {
      /* client disconnected */
    }
  }

  /**
   * Read `length` bytes of the logical concatenation of `chunks` starting at
   * `offset`. Returns null when fewer than `length` bytes are available.
   */
  private readBytesAt(chunks: Buffer[], offset: number, length: number): Buffer | null {
    // Fast-fail on incomplete data BEFORE allocating/copying, so a peer that
    // trickles bytes of a large unfinished frame cannot force repeated
    // O(available) copies per event.
    let available = -offset;
    for (const chunk of chunks) available += chunk.length;
    if (available < length) return null;

    const out = Buffer.allocUnsafe(length);
    let copied = 0;
    let remaining = offset;
    for (const chunk of chunks) {
      if (remaining >= chunk.length) {
        remaining -= chunk.length;
        continue;
      }
      let start = remaining;
      remaining = 0;
      while (copied < length && start < chunk.length) {
        const take = Math.min(length - copied, chunk.length - start);
        chunk.copy(out, copied, start, start + take);
        copied += take;
        start += take;
        if (copied >= length) return out;
      }
    }
    return copied === length ? out : null;
  }

  /** Slice the logical concatenation of `chunks` from `offset` to the end. */
  private sliceBuffered(chunks: Buffer[], offset: number): Buffer {
    // Fast path: the residual lands entirely within the last chunk.
    const total = chunks.reduce((acc, c) => acc + c.length, 0);
    const out = Buffer.allocUnsafe(total - offset);
    let written = 0;
    let remaining = offset;
    for (const chunk of chunks) {
      if (remaining >= chunk.length) {
        remaining -= chunk.length;
        continue;
      }
      const start = remaining;
      remaining = 0;
      const copied = chunk.copy(out, written, start, chunk.length);
      written += copied;
      if (written >= out.length) break;
    }
    return out;
  }

  private generateAcceptValue(key: string): string {
    const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
    return createHash('sha1')
      .update(key + GUID, 'utf-8')
      .digest('base64');
  }

  private createTextFrame(data: string): Buffer {
    return this.createFrame(0x01, Buffer.from(data, 'utf-8'));
  }

  private createFrame(opcode: number, payload: Buffer): Buffer {
    return Buffer.concat([this.createFrameHeader(opcode, payload.length), payload]);
  }

  /**
   * RFC 6455 §5.2 framing header for a payload of `length` bytes.
   * The 64-bit branch must NOT use `>>`: JS shift counts are taken mod 32, so
   * `length >> 32` silently aliases back to `length >> 0` and the high half
   * duplicated the low half (len 70000 declared 300647710790000). Split the
   * length arithmetically instead — exact for every length up to 2^53-1.
   */
  private createFrameHeader(opcode: number, length: number): Buffer {
    if (length < 126) {
      return Buffer.from([0x80 | opcode, length]);
    }
    if (length < 65536) {
      const header = Buffer.allocUnsafe(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(length, 2);
      return header;
    }
    const header = Buffer.allocUnsafe(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    const high = Math.floor(length / 0x1_0000_0000);
    const low = length - high * 0x1_0000_0000;
    header.writeUInt32BE(high, 2);
    header.writeUInt32BE(low, 6);
    return header;
  }
}
