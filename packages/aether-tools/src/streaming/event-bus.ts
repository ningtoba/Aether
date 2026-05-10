import { ToolEvent, ToolEventType } from '../types/index.js';

type EventHandler = (event: ToolEvent) => void;

export class EventBus {
  private listeners: Map<ToolEventType, Set<EventHandler>> = new Map();
  private wildcardListeners: Set<EventHandler> = new Set();

  on(type: ToolEventType, handler: EventHandler): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(handler);
    return () => this.listeners.get(type)?.delete(handler);
  }

  onAny(handler: EventHandler): () => void {
    this.wildcardListeners.add(handler);
    return () => this.wildcardListeners.delete(handler);
  }

  once(type: ToolEventType, handler: EventHandler): void {
    const wrapper: EventHandler = (event) => {
      handler(event);
      this.listeners.get(type)?.delete(wrapper);
    };
    this.on(type, wrapper);
  }

  emit(event: ToolEvent): void {
    const handlers = this.listeners.get(event.type);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(event);
        } catch {
          // swallow handler errors
        }
      }
    }
    for (const handler of this.wildcardListeners) {
      try {
        handler(event);
      } catch {
        // swallow handler errors
      }
    }
  }

  removeAllListeners(): void {
    this.listeners.clear();
    this.wildcardListeners.clear();
  }

  listenerCount(type?: ToolEventType): number {
    if (type) {
      return this.listeners.get(type)?.size ?? 0;
    }
    let count = this.wildcardListeners.size;
    for (const set of this.listeners.values()) {
      count += set.size;
    }
    return count;
  }
}

// ─── Stream Channel ─────────────────────────────────────────────────────────

export class StreamChannel {
  private buffer: Buffer[] = [];
  private sequence = 0;

  constructor(
    private onChunk: (chunk: { type: 'stdout' | 'stderr' | 'data' | 'error' | 'done'; data: string | Uint8Array; timestamp: number; sequence: number }) => void,
  ) {}

  write(chunk: string | Uint8Array, type: 'stdout' | 'stderr' = 'stdout'): void {
    const data = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk);
    this.buffer.push(data);
    this.onChunk({
      type,
      data: chunk,
      timestamp: Date.now(),
      sequence: this.sequence++,
    });
  }

  emitData(data: unknown): void {
    this.onChunk({
      type: 'data',
      data: JSON.stringify(data),
      timestamp: Date.now(),
      sequence: this.sequence++,
    });
  }

  error(message: string): void {
    this.onChunk({
      type: 'error',
      data: message,
      timestamp: Date.now(),
      sequence: this.sequence++,
    });
  }

  done(): void {
    this.onChunk({
      type: 'done',
      data: '',
      timestamp: Date.now(),
      sequence: this.sequence++,
    });
  }

  getOutput(): string {
    return Buffer.concat(this.buffer).toString('utf-8');
  }

  get size(): number {
    return this.buffer.reduce((acc, b) => acc + b.length, 0);
  }
}
