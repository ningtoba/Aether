/**
 * Realtime event stream from the Aether backend.
 *
 * The backend exposes engine events (session deltas, loop rounds, gates) over
 * a Bun-native WebSocket hub on `REALTIME_PORT` (advertised in /health). This
 * module connects and dispatches typed frames to subscribers.
 */

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
    if (this.manualClose) return;
    try {
      this.ws = new WebSocket(this.url);
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
