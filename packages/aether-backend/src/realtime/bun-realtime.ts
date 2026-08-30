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

  /** Broadcast a frame to every connected client (honoring their filter). */
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
        client.send(frame);
      } catch {
        /* drop dead client */
      }
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
