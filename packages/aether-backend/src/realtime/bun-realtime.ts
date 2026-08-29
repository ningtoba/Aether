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
 */
import { type ServerWebSocket, type Server, serve } from 'bun';

export interface RealtimeFrame {
  type: string;
  payload: unknown;
  timestamp: string;
}

export class BunRealtimeHub {
  private server: Server<Record<string, unknown>> | null = null;
  private clients = new Set<ServerWebSocket<Record<string, unknown>>>();
  private port = 3002;
  private started = false;
  private startedAt = 0;

  /** Latest health snapshot emitted on open (port, engine availability). */
  private healthProvider: (() => Record<string, unknown>) | null = null;

  constructor(port = 3002) {
    this.port = port;
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
  start(): Promise<number> {
    if (this.started) return Promise.resolve(this.port);
    return new Promise((resolve, reject) => {
      try {
        this.server = serve({
          port: this.port,
          fetch: (req, server) => {
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
        console.log(`[RealtimeHub] listening on ws://127.0.0.1:${this.port}`);
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
