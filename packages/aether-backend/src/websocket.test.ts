import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  WebSocketManager,
  MAX_WS_FRAME_SIZE,
  sameHostOrigin,
  isUpgradeOriginAllowed,
} from './websocket.js';
import { createHash } from 'node:crypto';

describe('WebSocketManager', () => {
  let wsm: WebSocketManager;

  beforeEach(() => {
    wsm = new WebSocketManager();
  });

  describe('connection management', () => {
    it('should start with zero connections', () => {
      expect(wsm.connectionCount).toBe(0);
    });

    it('should generate correct WebSocket accept key', () => {
      const key = 'dGhlIHNhbXBsZSBub25jZQ==';
      const expectedAccept = createHash('sha1')
        .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11', 'utf-8')
        .digest('base64');
      expect(expectedAccept).toBe('s3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
    });
  });

  describe('frame encoding', () => {
    it('should encode small payload (<126 bytes) with single-byte length', () => {
      const data = 'Hello';
      const frame = (wsm as any).createTextFrame(data);
      expect(frame[0]).toBe(0x81);
      expect(frame[1]).toBe(5);
      expect(frame.slice(2).toString()).toBe('Hello');
    });

    it('should encode medium payload (126-65535 bytes) with 2-byte extended length', () => {
      const data = 'x'.repeat(200);
      const frame = (wsm as any).createTextFrame(data);
      expect(frame[0]).toBe(0x81);
      expect(frame[1]).toBe(126);
      expect(frame.readUInt16BE(2)).toBe(200);
    });

    // Typed view into the private framing API (no `any` in new tests).
    const framing = () =>
      wsm as unknown as {
        createTextFrame(data: string): Buffer;
        createFrameHeader(opcode: number, length: number): Buffer;
      };

    it('should encode large payload (>65535 bytes) with an exact 8-byte extended length', () => {
      for (const size of [65536, 70000]) {
        const data = 'x'.repeat(size);
        const frame = framing().createTextFrame(data);
        expect(frame[0]).toBe(0x81);
        expect(frame[1]).toBe(127);
        // Decode the 8-byte extended length exactly. Buffer.readUIntBE caps at
        // 6 bytes, so sum the two 32-bit halves instead.
        const declared = frame.readUInt32BE(2) * 2 ** 32 + frame.readUInt32BE(6);
        expect(declared).toBe(size);
        // Header (10 bytes) must equal the frame minus the payload.
        expect(frame.length).toBe(size + 10);
      }
    });

    it('writes the exact 64-bit length for sizes adjacent to 2^32 and beyond', () => {
      // JS shift counts are mod 32: `(len >> 32)` aliases to `(len >> 0)`, so a
      // shift-based encoder corrupts the high half from 65536 up and degenerates
      // to 0 at 2^32. These sizes pin the arithmetic high/low split.
      for (const size of [4294967295, 4294967296, 4294967297, Number.MAX_SAFE_INTEGER]) {
        const header = framing().createFrameHeader(0x01, size);
        expect(header.length).toBe(10);
        expect(header[0]).toBe(0x81);
        expect(header[1]).toBe(127);
        const declared = header.readUInt32BE(2) * 2 ** 32 + header.readUInt32BE(6);
        expect(declared).toBe(size);
      }
    });
  });

  describe('frame decoding', () => {
    const MASK = Buffer.from([0x01, 0x02, 0x03, 0x04]);

    function maskedFrame(opcode: number, payload: Buffer): Buffer {
      const masked = Buffer.alloc(payload.length);
      for (let i = 0; i < payload.length; i++) {
        masked[i] = payload[i] ^ MASK[i % 4];
      }
      return Buffer.concat([Buffer.from([0x80 | opcode, 0x80 | payload.length, ...MASK]), masked]);
    }

    it('should decode a masked text frame', () => {
      const decoded = (wsm as any).tryParseFrame(maskedFrame(0x01, Buffer.from('Hello')));
      expect(decoded).not.toBeNull();
      expect(decoded.payload.toString()).toBe('Hello');
      expect(decoded.consumed).toBe('Hello'.length + 6);
    });

    it('should decode a masked frame with extended 16-bit length', () => {
      const payload = Buffer.from('x'.repeat(300), 'utf-8');
      const masked = Buffer.alloc(payload.length);
      for (let i = 0; i < payload.length; i++) {
        masked[i] = payload[i] ^ MASK[i % 4];
      }
      const header = Buffer.from([0x81, 0x80 | 126, (300 >> 8) & 0xff, 300 & 0xff, ...MASK]);
      const decoded = (wsm as any).tryParseFrame(Buffer.concat([header, masked]));
      expect(decoded).not.toBeNull();
      expect(decoded.payload.length).toBe(300);
    });

    it('should wait for more bytes when a frame is incomplete', () => {
      expect((wsm as any).tryParseFrame(Buffer.from([0x81]))).toBeNull();
      // Full header but missing mask + payload.
      expect((wsm as any).tryParseFrame(Buffer.from([0x81, 0x80 | 5]))).toBeNull();
    });

    it('should reject unmasked client frames (RFC 6455 §5.1)', () => {
      const payload = Buffer.from('no-mask', 'utf-8');
      const frame = Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
      expect(() => (wsm as any).tryParseFrame(frame)).toThrow(/masked/);
    });

    it('should reject unsupported opcodes instead of silently dropping them', () => {
      expect(() => (wsm as any).tryParseFrame(Buffer.from([0x82, 0x80]))).toThrow(/opcode/);
    });

    it('should reject oversized lengths before allocating payload memory', () => {
      const header = Buffer.alloc(10);
      header[0] = 0x81;
      header[1] = 0x80 | 127; // 64-bit extended length, masked
      header.writeBigUInt64BE(BigInt(MAX_WS_FRAME_SIZE) + 1n, 2);
      expect(() => (wsm as any).tryParseFrame(header)).toThrow(/size limit/);
    });

    it('should reject control frames with payload larger than 125 bytes (RFC 6455 §5.5)', () => {
      const header = Buffer.from([0x89, 0x80 | 126, 0, 200, 1, 2, 3, 4]);
      expect(() => (wsm as any).tryParseFrame(header)).toThrow(/125 bytes/);
    });

    it('should reassemble a frame delivered across many TCP chunks', () => {
      const client = { id: 'c1', send: vi.fn(), close: vi.fn(), filter: new Set<string>() };
      const socket = { write: vi.fn(), end: vi.fn() };
      const msg = Buffer.from(JSON.stringify({ filter: ['alpha', 'beta'] }), 'utf-8');
      const frame = maskedFrame(0x01, msg);
      for (const byte of frame) {
        (wsm as any).pushRx(socket, Buffer.from([byte]));
        (wsm as any).processFrames(client, socket);
      }
      expect(client.filter).toEqual(new Set(['alpha', 'beta']));
    });

    it('should handle several frames coalesced in one TCP chunk', () => {
      const client = { id: 'c2', send: vi.fn(), close: vi.fn(), filter: new Set<string>() };
      const socket = { write: vi.fn(), end: vi.fn() };
      const first = JSON.stringify({ filter: ['unused'] });
      const second = JSON.stringify({ filter: ['kept'] });
      const chunk = Buffer.concat([
        maskedFrame(0x01, Buffer.from(first, 'utf-8')),
        maskedFrame(0x01, Buffer.from(second, 'utf-8')),
      ]);
      (wsm as any).pushRx(socket, chunk);
      (wsm as any).processFrames(client, socket);
      expect(client.filter).toEqual(new Set(['kept']));
    });

    it('coalesces receive chunks so a fragmented trickle cannot retain thousands of Buffer objects', () => {
      const socket = { write: vi.fn(), end: vi.fn() };
      for (let i = 0; i < 500; i++) {
        (wsm as any).pushRx(socket, Buffer.alloc(1));
      }
      const buf = (wsm as any).rx.get(socket);
      expect(buf.length).toBe(500);
      expect(buf.chunks.length).toBeLessThanOrEqual(65);
    });

    it('answers ping frames with a pong carrying the same payload', () => {
      const client = { id: 'c1', send: vi.fn(), close: vi.fn(), filter: new Set<string>() };
      const socket = { write: vi.fn(), end: vi.fn() };
      const frame = maskedFrame(0x09, Buffer.from('hi'));
      (wsm as any).pushRx(socket, frame);
      (wsm as any).processFrames(client, socket);
      expect(socket.write).toHaveBeenCalled();
      const written = socket.write.mock.calls[0][0] as Buffer;
      expect(written[0] & 0x0f).toBe(0x0a); // pong opcode
      expect(written.subarray(2).toString()).toBe('hi');
    });
  });

  describe('broadcast', () => {
    it('should broadcast to all connected clients', () => {
      const client1 = { id: 'c1', send: vi.fn(), close: vi.fn() };
      const client2 = { id: 'c2', send: vi.fn(), close: vi.fn() };
      (wsm as any).clients.set('c1', client1);
      (wsm as any).clients.set('c2', client2);

      wsm.broadcast('test.event', { foo: 'bar' });

      expect(client1.send).toHaveBeenCalledTimes(1);
      expect(client2.send).toHaveBeenCalledTimes(1);
      const sentData = JSON.parse(client1.send.mock.calls[0][0]);
      expect(sentData.type).toBe('test.event');
      expect(sentData.payload).toEqual({ foo: 'bar' });
      expect(sentData.timestamp).toBeDefined();
    });

    it('should respect client event filters', () => {
      const client = {
        id: 'c1',
        send: vi.fn(),
        close: vi.fn(),
        filter: new Set(['allowed.event']),
      };
      (wsm as any).clients.set('c1', client);

      wsm.broadcast('allowed.event', { data: 1 });
      expect(client.send).toHaveBeenCalledTimes(1);

      wsm.broadcast('blocked.event', { data: 2 });
      expect(client.send).toHaveBeenCalledTimes(1);
    });

    it('should handle no clients gracefully', () => {
      expect(() => wsm.broadcast('event', {})).not.toThrow();
    });
  });

  describe('sendTo', () => {
    it('should send to a specific client by ID', () => {
      const client = { id: 'c1', send: vi.fn(), close: vi.fn() };
      (wsm as any).clients.set('c1', client);

      wsm.sendTo('c1', 'private.event', { secret: true });
      expect(client.send).toHaveBeenCalledTimes(1);
      const sentData = JSON.parse(client.send.mock.calls[0][0]);
      expect(sentData.type).toBe('private.event');
    });

    it('should silently ignore non-existent client IDs', () => {
      expect(() => wsm.sendTo('nonexistent', 'event', {})).not.toThrow();
    });
  });

  describe('detach', () => {
    it('should close all clients and clear the map', () => {
      const client = { id: 'c1', send: vi.fn(), close: vi.fn() };
      (wsm as any).clients.set('c1', client);

      wsm.detach();

      expect(client.close).toHaveBeenCalled();
      expect(wsm.connectionCount).toBe(0);
    });
  });
});
describe('attach lifecycle & fragmentation', () => {
  let wsm: WebSocketManager;

  beforeEach(() => {
    wsm = new WebSocketManager();
  });

  it('is idempotent: a second attach replaces the listener instead of adding', () => {
    const listeners: Record<string, ((...a: unknown[]) => void)[]> = {};
    const fakeServer = {
      on: (ev: string, fn: (...a: unknown[]) => void) => {
        (listeners[ev] ??= []).push(fn);
      },
      removeListener: (ev: string, fn: (...a: unknown[]) => void) => {
        listeners[ev] = (listeners[ev] ?? []).filter((f) => f !== fn);
      },
    } as unknown as import('node:http').Server;

    wsm.attach(fakeServer);
    wsm.attach(fakeServer);
    // A double attach must not register two upgrade handlers (each would
    // write its own 101 handshake and rip the socket in half).
    expect(listeners['upgrade']?.length).toBe(1);
  });

  it('rejects a non-FIN (fragmented) frame and tears the socket down coherently', () => {
    const listeners: Record<string, ((...a: unknown[]) => void)[]> = {};
    const fakeServer = {
      on: (ev: string, fn: (...a: unknown[]) => void) => {
        (listeners[ev] ??= []).push(fn);
      },
      removeListener: () => {},
    } as unknown as import('node:http').Server;
    wsm.attach(fakeServer);

    const writes: string[] = [];
    let destroyed = false;
    const socketHandlers: Record<string, ((...a: unknown[]) => void)[]> = {};
    const socket = {
      write: (d: string | Buffer) => {
        writes.push(typeof d === 'string' ? d : d.toString('utf-8'));
        return true;
      },
      destroy: () => {
        destroyed = true;
      },
      on: (ev: string, fn: (...a: unknown[]) => void) => {
        (socketHandlers[ev] ??= []).push(fn);
      },
      once: () => {},
    } as unknown as import('node:stream').Duplex;

    const upgrade = listeners['upgrade'][0];
    upgrade(
      {
        headers: { 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==' },
      } as unknown as import('node:http').IncomingMessage,
      socket,
      Buffer.alloc(0),
    );

    // A masked text frame with the FIN bit clear — the start of a fragmented
    // message. The manager must reject it outright (not accept the fragment
    // and then die on the mandatory continuation frame that follows).
    const payload = Buffer.from('{"filter":["a"]}');
    const key = Buffer.from([1, 2, 3, 4]);
    const masked = Buffer.alloc(2 + 4 + payload.length);
    masked[0] = 0x01; // FIN=0, opcode 0x1
    masked[1] = 0x80 | payload.length; // MASK bit + length
    key.copy(masked, 2);
    for (let i = 0; i < payload.length; i++) {
      masked[2 + 4 + i] = payload[i] ^ key[i % 4];
    }

    const dataCb = socketHandlers['data'][0];
    dataCb(masked);

    expect(writes.filter((w) => w.includes('101 Switching Protocols'))).toHaveLength(1);
    expect(destroyed).toBe(true);
    expect(wsm.connectionCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Origin policy (D5): empty allow-list = host-match, NOT "accept any Origin"
// ---------------------------------------------------------------------------
describe('origin policy (D5 CSWSH default)', () => {
  let wsm: WebSocketManager;

  beforeEach(() => {
    wsm = new WebSocketManager();
  });
  it('sameHostOrigin: absent Origin accepted (non-browser client)', () => {
    expect(sameHostOrigin(undefined, 'localhost:3002')).toBe(true);
    expect(sameHostOrigin('', 'localhost:3002')).toBe(true);
  });

  it('sameHostOrigin: matching hostname with a DIFFERENT port accepted', () => {
    // The documented deployment: GUI page on :3081 opens the hub on :3002.
    expect(sameHostOrigin('http://localhost:3081', 'localhost:3002')).toBe(true);
    expect(sameHostOrigin('http://127.0.0.1:3081', '127.0.0.1:3002')).toBe(true);
  });

  it('sameHostOrigin: foreign origin rejected', () => {
    // The regression this pins: evil.example previously passed the empty list.
    expect(sameHostOrigin('https://evil.example', 'localhost:3002')).toBe(false);
    expect(sameHostOrigin('http://localhost.evil.example:3081', 'localhost:3002')).toBe(false);
  });

  it('sameHostOrigin: browser traffic without a Host header rejected', () => {
    expect(sameHostOrigin('http://localhost:3081', undefined)).toBe(false);
    expect(sameHostOrigin('http://localhost:3081', '')).toBe(false);
  });

  it('sameHostOrigin: null / garbage origins rejected', () => {
    expect(sameHostOrigin('null', 'localhost:3002')).toBe(false);
    expect(sameHostOrigin('not a url', 'localhost:3002')).toBe(false);
  });

  it('sameHostOrigin: case-insensitive and IPv6 literals compare bracketed', () => {
    expect(sameHostOrigin('http://LOCALHOST:3081', 'localhost:3002')).toBe(true);
    expect(sameHostOrigin('http://[::1]:3081', '[::1]:3002')).toBe(true);
    expect(sameHostOrigin('http://[::1]:3081', '[::2]:3002')).toBe(false);
  });

  it('isUpgradeOriginAllowed: explicit list keeps exact-match semantics', () => {
    const list = ['https://gui.example'];
    expect(isUpgradeOriginAllowed('https://gui.example', 'localhost:3002', list)).toBe(true);
    expect(isUpgradeOriginAllowed('https://evil.example', 'localhost:3002', list)).toBe(false);
    // Same-host alone is NOT enough once an explicit list is configured:
    expect(isUpgradeOriginAllowed('http://localhost:9', 'localhost:3002', list)).toBe(false);
    // Non-browser traffic (no Origin) still passes an explicit list.
    expect(isUpgradeOriginAllowed(undefined, 'localhost:3002', list)).toBe(true);
  });

  it('isUpgradeOriginAllowed: empty list falls back to the host-match rule', () => {
    expect(isUpgradeOriginAllowed('http://localhost:3081', 'localhost:3002', [])).toBe(true);
    expect(isUpgradeOriginAllowed('https://evil.example', 'localhost:3002', [])).toBe(false);
    expect(isUpgradeOriginAllowed(undefined, 'localhost:3002', [])).toBe(true);
  });

  it('isUpgradeOriginAllowed: literal "*" opts upgrades into allow-any (REST parity)', () => {
    // Operators who set AETHER_CORS_ORIGINS='*' (remote/Docker GUI) must not
    // have their hub sockets rejected by the tightened empty-list default.
    expect(isUpgradeOriginAllowed('https://anywhere.example', 'localhost:3002', ['*'])).toBe(true);
    expect(isUpgradeOriginAllowed('http://localhost:3081', 'localhost:3002', ['*'])).toBe(true);
    expect(isUpgradeOriginAllowed(undefined, 'localhost:3002', ['*'])).toBe(true);
    // The opaque `null` origin stays denied (handleCors parity).
    expect(isUpgradeOriginAllowed('null', 'localhost:3002', ['*'])).toBe(false);
  });

  it('manager gate: default (empty list) rejects a cross-site upgrade, accepts same-host and Origin-less', () => {
    // Discriminates the D5 fix end-to-end inside WebSocketManager: with the
    // old `allowedOrigins.length === 0 → true` default, the evil.example
    // assertion below would fail.
    const evil = {
      headers: { origin: 'https://evil.example', host: 'localhost:3002' },
    } as unknown as import('node:http').IncomingMessage;
    // @ts-expect-error - accessing private method for test
    expect(wsm.isOriginAllowed(evil)).toBe(false);
    const sameHost = {
      headers: { origin: 'http://localhost:3081', host: 'localhost:3002' },
    } as unknown as import('node:http').IncomingMessage;
    // @ts-expect-error - accessing private method for test
    expect(wsm.isOriginAllowed(sameHost)).toBe(true);
    const noOrigin = {
      headers: { host: 'localhost:3002' },
    } as unknown as import('node:http').IncomingMessage;
    // @ts-expect-error - accessing private method for test
    expect(wsm.isOriginAllowed(noOrigin)).toBe(true);
  });

  it('manager gate: explicit allow-list keeps exact-match behavior', () => {
    wsm.setAllowedOrigins(['https://gui.example']);
    const listed = {
      headers: { origin: 'https://gui.example', host: 'localhost:3002' },
    } as unknown as import('node:http').IncomingMessage;
    // @ts-expect-error - accessing private method for test
    expect(wsm.isOriginAllowed(listed)).toBe(true);
    const unlisted = {
      headers: { origin: 'http://localhost:3081', host: 'localhost:3002' },
    } as unknown as import('node:http').IncomingMessage;
    // @ts-expect-error - accessing private method for test
    expect(wsm.isOriginAllowed(unlisted)).toBe(false);
  });
});
