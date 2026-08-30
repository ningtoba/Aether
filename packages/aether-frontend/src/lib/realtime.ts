/**
 * Realtime event stream from the Aether backend.
 *
 * The backend exposes engine events (session deltas, loop rounds, gates) over
 * a Bun-native WebSocket hub on `REALTIME_PORT` (advertised in /health). This
 * module connects and dispatches typed frames to subscribers. When the backend
 * enforces auth, each connection attempt (including reconnects) first mints a
 * fresh single-use ticket via POST /api/realtime-ticket.
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

export class RealtimeClient {
  private ws: WebSocket | null = null;
  private handlers = new Set<RealtimeHandler>();
  private url: string;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private manualClose = false;
  private connecting = false;

  constructor(port: number) {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const host = window.location.hostname;
    this.url = `${protocol}://${host}:${port}/`;
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  subscribe(handler: RealtimeHandler): () => void {
    this.handlers.add(handler);
    this.ensure();
    return () => this.handlers.delete(handler);
  }

  private ensure(): void {
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    )
      return;
    if (this.manualClose || this.connecting) return;
    this.connecting = true;
    // Tickets are single-use with a short TTL: fetch a fresh one on every
    // attempt, reconnects included.
    void this.fetchTicket().then((ticket) => {
      this.connecting = false;
      if (this.manualClose) return;
      this.open(ticket);
    });
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

  private open(ticket: string | null): void {
    const url = ticket ? `${this.url}?ticket=${encodeURIComponent(ticket)}` : this.url;
    try {
      this.ws = new WebSocket(url);
      this.ws.onopen = () => {
        this.ws?.send(JSON.stringify({ filter: ['engine'] }));
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
        if (!this.manualClose) {
          this.reconnectTimer = setTimeout(() => this.ensure(), 1500);
        }
      };
      this.ws.onerror = () => {
        try {
          this.ws?.close();
        } catch {
          /* ignore */
        }
      };
    } catch {
      /* websocket unsupported */
    }
  }

  close(): void {
    this.manualClose = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
    this.handlers.clear();
  }
}
