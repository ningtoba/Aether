export type EventHandler<T = unknown> = (event: T) => void | Promise<void>;

export interface EventBusOptions {
  maxListeners: number;
  asyncDelivery: boolean;
  retryFailed: boolean;
}

/** A typed event bus for publish-subscribe communication */
export class EventBus {
  private listeners = new Map<string, Set<EventHandler>>();
  private onceListeners = new Map<string, Set<EventHandler>>();
  private options: EventBusOptions;

  constructor(options: Partial<EventBusOptions> = {}) {
    this.options = {
      maxListeners: options.maxListeners ?? 100,
      asyncDelivery: options.asyncDelivery ?? false,
      retryFailed: options.retryFailed ?? false,
    };
  }

  /** Subscribe to an event type */
  subscribe<T = unknown>(event: string, handler: EventHandler<T>): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    const handlers = this.listeners.get(event)!;
    if (handlers.size >= this.options.maxListeners) {
      console.warn(
        `EventBus: max listeners (${this.options.maxListeners}) reached for event "${event}"`,
      );
    }
    handlers.add(handler as EventHandler);
    return () => {
      handlers.delete(handler as EventHandler);
    };
  }

  /** Subscribe to a single occurrence of an event */
  once<T = unknown>(event: string, handler: EventHandler<T>): void {
    if (!this.onceListeners.has(event)) this.onceListeners.set(event, new Set());
    this.onceListeners.get(event)!.add(handler as EventHandler);
  }

  /**
   * Publish an event to all subscribers.
   *
   * Delivery is isolated per subscriber: a handler that throws/rejects never
   * prevents the remaining subscribers from receiving the event. With
   * `retryFailed` the failures are logged and swallowed; without it the first
   * failure is surfaced once every subscriber has had its turn. In
   * `asyncDelivery` mode handlers run concurrently and the documented
   * deliver-all-then-resolve contract is kept (a rejection is confined to that
   * subscriber; with `retryFailed` it is also logged).
   */
  async publish<T = unknown>(event: string, data: T): Promise<void> {
    const allHandlers = [
      ...(this.listeners.get(event) ?? []),
      ...(this.onceListeners.get(event) ?? []),
    ];
    this.onceListeners.delete(event);

    if (this.options.asyncDelivery) {
      const results = await Promise.allSettled(
        allHandlers.map((h) => this.invokeHandler(h, event, data)),
      );
      if (this.options.retryFailed) {
        for (const result of results) {
          if (result.status === 'rejected') {
            console.error(`EventBus: handler failed for "${event}":`, result.reason);
          }
        }
      }
      return;
    }

    let firstError: unknown = null;
    for (const handler of allHandlers) {
      try {
        await this.invokeHandler(handler, event, data);
      } catch (err) {
        if (this.options.retryFailed) {
          console.error(`EventBus: handler failed for "${event}":`, err);
        } else if (firstError === null) {
          firstError = err;
        }
      }
    }
    if (firstError !== null) throw firstError;
  }

  /** Remove all listeners for an event */
  clear(event?: string): void {
    if (event) {
      this.listeners.delete(event);
      this.onceListeners.delete(event);
    } else {
      this.listeners.clear();
      this.onceListeners.clear();
    }
  }

  /** Get count of listeners for an event */
  listenerCount(event: string): number {
    return (this.listeners.get(event)?.size ?? 0) + (this.onceListeners.get(event)?.size ?? 0);
  }

  private async invokeHandler(handler: EventHandler, event: string, data: unknown): Promise<void> {
    const result = handler(data);
    if (result instanceof Promise) await result;
  }
}
