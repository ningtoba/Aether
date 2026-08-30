/**
 * Realtime event stream from the Aether backend.
 *
 * The backend exposes engine events (session deltas, loop rounds, gates) over
 * a Bun-native WebSocket hub on the port advertised in /health. This module
 * owns ONE process-wide client: pages subscribe for frames and register
 * onReconnect callbacks; nobody constructs clients or threads ports anymore.
 * (Per-mount `new RealtimeClient` used to orphan a live socket + reconnect
 * timer on every page unmount — the subscriptions unsubscribed, the client
 * kept reconnecting forever.)
 *
 * When the backend enforces auth, each connection attempt (including
 * reconnects) first mints a fresh single-use ticket via
 * POST /api/realtime-ticket.
 */

import { getApiKey } from './api';

export interface RealtimeFrame {
  type: string;
  payload: {
    namespace: 'session' | 'loop' | 'hub';
    sessionId?: string;
    event: Record<string, unknown> & { kind?: string };
  };
  timestamp: string;
}

export type RealtimeHandler = (frame: RealtimeFrame) => void;

/** Reconnect ladder: 1s → 2s → 4s … capped at 30s; reset on every open. */
const BACKOFF_INITIAL_MS = 1_000;
const BACKOFF_CAP_MS = 30_000;

export class RealtimeClient {
  private ws: WebSocket | null = null;
  private handlers = new Set<RealtimeHandler>();
  private reconnectCallbacks = new Set<() => void>();
  // NodeJS.Timeout, not number: vite/client pulls Node timer typings into
  // this DOM-lib project, so bare setTimeout hands back a Node Timeout.
  private reconnectTimer: NodeJS.Timeout | undefined;
  private backoffMs = BACKOFF_INITIAL_MS;
  private manualClose = false;
  private bootstrapping = false;
  /** Distinguishes the first open (nothing missed) from reconnects (frames
   *  were dropped — subscribers must refetch). */
  private everOpened = false;

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  subscribe(handler: RealtimeHandler): () => void {
    this.handlers.add(handler);
    this.connect();
    return () => {
      this.handlers.delete(handler);
    };
  }

  /**
   * Call `cb` after every successful (re)connect AFTER the first. Frames
   * emitted while disconnected are gone forever, so pages use this to refetch
   * the state they missed (open session transcript, loop list/progress).
   */
  onReconnect(cb: () => void): () => void {
    this.reconnectCallbacks.add(cb);
    return () => {
      this.reconnectCallbacks.delete(cb);
    };
  }

  /**
   * Connect if not already connecting/open. Port discovery is the class's
   * own job (it fetches /health), which is what makes the singleton usable
   * from any page without a port handshake. Public so the factory can
   * self-bootstrap: callers never supply a port.
   */
  connect(): void {
    if (this.manualClose || this.bootstrapping) return;
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    )
      return;
    this.bootstrapping = true;
    void (async () => {
      const port = await this.discoverPort();
      // Tickets are single-use with a short TTL: fetch a fresh one on every
      // attempt, reconnects included.
      const ticket = port === null ? null : await this.fetchTicket();
      this.bootstrapping = false;
      if (this.manualClose) return;
      if (port === null) {
        // /health unreachable — walk the same backoff ladder a socket failure uses.
        this.scheduleReconnect();
        return;
      }
      this.open(port, ticket);
    })();
  }

  private async discoverPort(): Promise<number | null> {
    try {
      const res = await fetch('/health');
      if (!res.ok) return null;
      const h = (await res.json()) as { realtime?: { port?: number } };
      return typeof h.realtime?.port === 'number' ? h.realtime.port : null;
    } catch {
      return null;
    }
  }

  /**
   * Exchange the API key for a single-use realtime ticket
   * (POST /api/realtime-ticket → { ticket: string | null }).
   * A null result means "connect uncredentialed": either the backend has
   * auth disabled (ticket: null) or the endpoint is missing/unreachable
   * (older backend) — the backend decides either way, keeping the auth-off
   * dev flow alive.
   */
  private async fetchTicket(): Promise<string | null> {
    try {
      const key = getApiKey();
      const res = await fetch('/api/realtime-ticket', {
        method: 'POST',
        ...(key ? { headers: { authorization: `Bearer ${key}` } } : {}),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { ticket?: string | null };
      return typeof body.ticket === 'string' && body.ticket.length > 0 ? body.ticket : null;
    } catch {
      return null;
    }
  }

  private scheduleReconnect(): void {
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, BACKOFF_CAP_MS);
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private open(port: number, ticket: string | null): void {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const base = `${protocol}://${window.location.hostname}:${port}/`;
    const url = ticket ? `${base}?ticket=${encodeURIComponent(ticket)}` : base;
    try {
      this.ws = new WebSocket(url);
      this.ws.onopen = () => {
        this.backoffMs = BACKOFF_INITIAL_MS;
        this.ws?.send(JSON.stringify({ filter: ['engine'] }));
        if (this.everOpened) {
          // Snapshot: a callback may unsubscribe during the fan-out.
          for (const cb of [...this.reconnectCallbacks]) cb();
        } else {
          this.everOpened = true;
        }
      };
      this.ws.onmessage = (m) => {
        try {
          const frame = JSON.parse(String(m.data)) as RealtimeFrame;
          this.handlers.forEach((h) => h(frame));
        } catch {
          /* ignore malformed frames */
        }
      };
      this.ws.onclose = () => {
        this.ws = null;
        if (!this.manualClose) this.scheduleReconnect();
      };
      this.ws.onerror = () => {
        try {
          this.ws?.close();
        } catch {
          /* ignore */
        }
      };
    } catch {
      /* WebSocket unsupported in this browser — nothing to retry against */
    }
  }

  /** Tear the client down for good (manualClose survives future subscribes).
   *  Not used by pages — the singleton lives for the tab's lifetime — but the
   *  class must offer a real shutdown for its async guards to be honest. */
  close(): void {
    this.manualClose = true;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
    this.handlers.clear();
    this.reconnectCallbacks.clear();
  }
}

/* ── Process-wide singleton ─────────────────────────────────────────── */

let singleton: RealtimeClient | null = null;

/**
 * The one realtime client. Self-bootstrapping (port discovery via /health
 * happens inside the class), same instance on every call. Creating one per
 * page-mount leaked an uncloseable socket + reconnect timer each time a page
 * unmounted — pages now only subscribe.
 */
export function getRealtimeClient(): RealtimeClient {
  if (!singleton) {
    singleton = new RealtimeClient();
    // Eager bootstrap: the Sessions header pill reports a real socket state
    // from mount on, exactly like the old per-page clients did.
    singleton.connect();
  }
  return singleton;
}
