/**
 * BunRealtimeHub — Bun-native WebSocket hub for engine events.
 *
 * The REST server runs on the hardened `node:http` AetherServer (works under
 * Node AND Bun). But Bun's node:http layer cannot drive WebSockets (raw 101
 * writes on the upgrade socket are not flushed, and there is no
 * `server.upgrade` on a node:http server), so live engine events (session
 * deltas, loop rounds, gate prompts) are served by this dedicated `Bun.serve`
 * WebSocket listener on `REALTIME_PORT`.
 *
 * The GUI reads the realtime port from `/health` and opens
 * `ws://<host>:<realtimePort>/` here; clients subscribe with a
 * `{ filter: ['engine'] }` frame exactly like the legacy WS manager.
 *
 * SECURITY (D2): the hub streams live engine frames and a health payload to
 * every accepted socket, so the upgrade is gated BEFORE `server.upgrade` by
 * `authorizeRealtimeUpgrade`: an Origin rule (`isOriginAllowed`, enforced even
 * when auth is disabled) and — when an API key is configured — a credential
 * presented via `Authorization: Bearer`, `X-API-Key`, `?apikey=` or a
 * single-use `?ticket=` (minted through POST /api/realtime-ticket, validated
 * delete-on-use via `validateTicket`). The `bun` module itself is imported
 * lazily inside `start()` so the node vitest suite can exercise the auth seam
 * without the Bun runtime (same boundary as engine-service.ts).
 */
import type { Server, ServerWebSocket } from 'bun';

export interface RealtimeFrame {
  type: string;
  payload: unknown;
  timestamp: string;
}

/**
 * Minimal structural request shape for the auth/origin seam. Bun's `Request`
 * satisfies it; tests build plain doubles (Node 22 has URL/Headers globals).
 * The same type is the option signature, so main.ts callbacks, the hub and
 * the tests share one shape.
 */
export interface HubRequestLike {
  url: string;
  headers: { get(name: string): string | null };
}

/** Upgrade gate verdict: proceed, or reject the handshake with this status. */
export type UpgradeVerdict = 'allow' | 401 | 403;

export interface BunRealtimeHubOptions {
  port?: number;
  /** Bind address passed to `Bun.serve` as `hostname` (default 0.0.0.0). */
  host?: string;
  /**
   * Credential check for browser/tool upgrades (Bearer / X-API-Key /
   * ?apikey= — see `extractRealtimeKey`). When UNSET, authentication is
   * disabled (open local dev) and every request passes the credential gate;
   * `isOriginAllowed` is still enforced when provided.
   */
  authenticate?: (req: HubRequestLike) => boolean;
  /** Origin gate; rejected upgrades get 403. Enforced even without auth. */
  isOriginAllowed?: (req: HubRequestLike) => boolean;
  /**
   * Single-use ticket validator for `?ticket=` (delete-on-use, TTL). Only
   * consulted when `authenticate` is set; a valid ticket substitutes for a
   * key so the long-lived API key never lands in a URL.
   */
  validateTicket?: (ticket: string) => boolean;
}

/** Read a query parameter from a request URL; null on malformed URLs. */
function queryParam(url: string, name: string): string | null {
  try {
    return new URL(url).searchParams.get(name);
  } catch {
    return null;
  }
}

/**
 * Extract the realtime credential: `Authorization: Bearer` (case-insensitive
 * scheme, mirroring AetherServer.extractApiKey), then `X-API-Key`, then the
 * `?apikey=` query param. Null when no credential is present.
 */
export function extractRealtimeKey(req: HubRequestLike): string | null {
  const auth = req.headers.get('authorization');
  if (auth && /^bearer[ \t]+/i.test(auth)) {
    const token = auth.replace(/^bearer[ \t]+/i, '').trim();
    if (token) return token;
  }
  const headerKey = req.headers.get('x-api-key');
  if (headerKey && headerKey.length > 0) return headerKey;
  return queryParam(req.url, 'apikey');
}

/**
 * The hub's whole upgrade authorization decision as a pure function (test
 * seam; `fetch` delegates here before touching `server.upgrade`):
 * - Origin gate FIRST (403) — applies even when auth is disabled;
 * - credential gate (401) only when `authenticate` is provided: a valid
 *   single-use `?ticket=` passes, otherwise `authenticate(req)` must.
 */
export function authorizeRealtimeUpgrade(
  req: HubRequestLike,
  opts: Pick<BunRealtimeHubOptions, 'authenticate' | 'isOriginAllowed' | 'validateTicket'> = {},
): UpgradeVerdict {
  if (opts.isOriginAllowed && !opts.isOriginAllowed(req)) return 403;
  if (opts.authenticate) {
    const ticket = queryParam(req.url, 'ticket');
    const ticketOk =
      ticket !== null && opts.validateTicket !== undefined && opts.validateTicket(ticket);
    if (!ticketOk && !opts.authenticate(req)) return 401;
  }
  return 'allow';
}

/**
 * Per-client outbound bound (bytes) for `broadcast()`. Parity with the legacy
 * manager's `MAX_WS_OUTBOUND_BACKLOG` (websocket.ts, 1 MB): that implementation
 * counted bytes stuck in a socket's write queue and `destroy()`ed the
 * connection past the cap so a peer that stops reading cannot make the server
 * buffer frames without limit. Bun queues per-socket instead, so the same cap
 * is measured with `getBufferedAmount()` after each send — without it, one
 * stalled consumer could grow Bun's per-socket send queue unboundedly.
 */
export const MAX_BUFFERED_BYTES = 1_000_000;

/**
 * The outbound-bound decision as a pure function (test seam — `broadcast()`
 * delegates here, so the policy is unit-testable under Node without
 * Bun.serve): true when a client's write queue has grown past the cap and the
 * connection must be dropped. Mirrors the legacy manager's strict `>`
 * comparison (`buffered > MAX_WS_OUTBOUND_BACKLOG`, websocket.ts): AT the cap
 * is still tolerated, only beyond it drops. Non-positive/NaN readings (no
 * queued bytes, or a runtime without `getBufferedAmount`) never evict.
 */
export function overBuffered(bufferedBytes: number, cap: number): boolean {
  if (!(bufferedBytes > 0)) return false;
  return bufferedBytes > cap;
}

/**
 * Structural view of the socket the backpressure path touches. Both methods
 * exist on modern Bun's `ServerWebSocket`, but the hub degrades gracefully
 * (keeps the client, never throws) when an older runtime lacks them — hence
 * optional-method probing instead of direct calls.
 */
interface BackpressureProbe {
  getBufferedAmount?(): number;
  terminate?(): void;
}

/** Socket type stored in `clients`, named once for the teardown helper below. */
type ClientSocket = ServerWebSocket<Record<string, unknown>>;

export class BunRealtimeHub {
  private server: Server<Record<string, unknown>> | null = null;
  private clients = new Set<ServerWebSocket<Record<string, unknown>>>();
  private port = 3002;
  private host = '0.0.0.0';
  private authenticate?: (req: HubRequestLike) => boolean;
  private isOriginAllowed?: (req: HubRequestLike) => boolean;
  private validateTicket?: (ticket: string) => boolean;
  private started = false;
  private startedAt = 0;

  /** Latest health snapshot emitted on open (port, engine availability). */
  private healthProvider: (() => Record<string, unknown>) | null = null;

  constructor(options: BunRealtimeHubOptions = {}) {
    this.port = options.port ?? 3002;
    this.host = options.host ?? '0.0.0.0';
    this.authenticate = options.authenticate;
    this.isOriginAllowed = options.isOriginAllowed;
    this.validateTicket = options.validateTicket;
  }

  /** Provide the health payload included in the first frame after a client opens. */
  setHealthProvider(fn: () => Record<string, unknown>): void {
    this.healthProvider = fn;
  }

  get isRunning(): boolean {
    return this.started;
  }

  get clientCount(): number {
    return this.clients.size;
  }

  /** Start the hub. No-op when already running. */
  async start(): Promise<number> {
    if (this.started) return this.port;
    // The node vitest suite never imports Bun-only modules: `serve` is
    // loaded lazily so importing this file (and the auth seam above) works
    // under plain Node; only start() requires the Bun runtime.
    const { serve } = await import('bun');
    return new Promise((resolve, reject) => {
      try {
        this.server = serve({
          port: this.port,
          // D3: bind EXACTLY the configured host (Bun.serve would otherwise
          // silently default to 0.0.0.0 while the log claimed loopback).
          hostname: this.host,
          fetch: (req, server) => {
            const verdict = authorizeRealtimeUpgrade(req, {
              authenticate: this.authenticate,
              isOriginAllowed: this.isOriginAllowed,
              validateTicket: this.validateTicket,
            });
            if (verdict !== 'allow') {
              // Reject BEFORE any upgrade: an unauthenticated socket here
              // would stream live engine frames and the health payload (D2).
              const text = verdict === 403 ? 'Forbidden origin' : 'Unauthorized';
              return new Response(`Aether realtime hub — ${text}`, { status: verdict });
            }
            // WebSocket upgrade → hand the socket to the hub.
            const data: Record<string, unknown> = {};
            if (server.upgrade(req, { data })) return undefined;
            return new Response('Aether realtime hub — connect with a WebSocket', { status: 404 });
          },
          websocket: {
            open: (ws) => {
              this.clients.add(ws);
              if (this.healthProvider) {
                ws.send(
                  JSON.stringify({
                    type: 'engine',
                    payload: {
                      namespace: 'hub',
                      event: { kind: 'hub:open', ...this.healthProvider() },
                    },
                    timestamp: new Date().toISOString(),
                  } as RealtimeFrame),
                );
              }
            },
            message: (ws, raw) => {
              // Support `{ filter: [...] }` subscription frames (mirrors the
              // legacy WS manager's filter contract).
              try {
                const parsed = JSON.parse(String(raw)) as { filter?: string[] };
                if (!Array.isArray(parsed?.filter)) return;
                ws.data.filter = new Set(parsed.filter);
              } catch {
                /* non-JSON control frame → ignore */
              }
            },
            close: (ws) => {
              this.clients.delete(ws);
            },
          },
        });
        this.started = true;
        this.startedAt = Date.now();
        // Log the ACTUAL bind host/port from the server, never a literal
        // (D3: the old line printed a false 127.0.0.1 for a 0.0.0.0 bind).
        console.log(
          `[RealtimeHub] listening on ws://${this.server.hostname}:${this.server.port}`,
          `(auth: ${this.authenticate ? 'on' : 'off'})`,
        );
        resolve(this.port);
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Broadcast a frame to every connected client (honoring their filter).
   *
   * Outbound bound (parity with the legacy manager's writeFrame, websocket.ts,
   * which destroys a socket once > MAX_WS_OUTBOUND_BACKLOG bytes sit in its
   * write queue): after each send the socket's queued bytes are measured and
   * the client terminated past MAX_BUFFERED_BYTES — otherwise one stalled
   * consumer grows Bun's per-socket send queue without bound.
   */
  broadcast(type: string, payload: unknown): void {
    if (!this.started) return;
    const frame = JSON.stringify({
      type,
      payload,
      timestamp: new Date().toISOString(),
    } satisfies RealtimeFrame);
    for (const client of this.clients) {
      const filter = client.data?.filter as Set<string> | undefined;
      if (filter && !filter.has(type)) continue;
      try {
        const status = client.send(frame);
        // Pinned bun-types docs (websockets.mdx, "Backpressure"): -1 means
        // enqueued-but-backpressured (KEEP — exactly the slow reader the byte
        // bound below exists for), 0 means dropped due to a connection issue,
        // 1+ bytes written. Only 0 is fatal.
        if (status === 0) {
          this.dropClient(client, 'send dropped (connection issue)');
          continue;
        }
        // Byte bound: getBufferedAmount() is the real per-socket queue depth.
        // A runtime without the method reads 0 → client kept (graceful
        // degradation; the bound silently offloads to the runtime's own queue).
        const probe: BackpressureProbe = client;
        const buffered = probe.getBufferedAmount?.() ?? 0;
        if (overBuffered(buffered, MAX_BUFFERED_BYTES)) {
          this.dropClient(client, `outbound backlog ${buffered}B`);
        }
      } catch {
        // Dead socket: evict now. The old comment claimed "drop dead client"
        // but only waited for a close event that may never fire, leaving the
        // hub to re-touch it on every broadcast.
        this.dropClient(client, 'send threw');
      }
    }
  }

  /**
   * Evict + tear down one client. The log line carries only the socket-level
   * reason (byte count / status) — never frame contents — so a drop burst
   * cannot leak live engine payloads into logs. The set removal happens
   * before the teardown so nothing more is ever queued for this client, even
   * if the close callback is late.
   */
  private dropClient(client: ClientSocket, reason: string): void {
    this.clients.delete(client);
    console.warn(`[RealtimeHub] dropped client (${reason})`);
    const probe: BackpressureProbe = client;
    try {
      // terminate() is the abrupt teardown — a close handshake would queue
      // behind the very window that stalled the peer. Fallbacks: 1011
      // (server-error close), then nothing if the runtime exposes neither;
      // the set removal alone already bounds the hub.
      if (typeof probe.terminate === 'function') probe.terminate();
      else client.close(1011);
    } catch {
      /* socket already fully gone */
    }
  }

  /** Stop the hub. */
  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    // Close all client sockets, then the server.
    for (const client of this.clients) {
      try {
        client.close();
      } catch {
        /* ignore */
      }
    }
    this.clients.clear();
    try {
      this.server?.stop(true);
    } catch {
      /* ignore */
    }
    this.server = null;
  }

  get uptimeMs(): number {
    return this.started ? Date.now() - this.startedAt : 0;
  }
}
