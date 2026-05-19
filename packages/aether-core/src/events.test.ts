import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { EventBus } from "./events.js";

describe("EventBus", () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  afterEach(() => {
    bus.clear();
  });

  describe("subscribe", () => {
    it("should subscribe to an event and receive published data", async () => {
      const handler = vi.fn();
      bus.subscribe("test:event", handler);

      await bus.publish("test:event", { foo: "bar" });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({ foo: "bar" });
    });

    it("should support multiple subscribers on the same event", async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      bus.subscribe("multi", handler1);
      bus.subscribe("multi", handler2);

      await bus.publish("multi", "data");

      expect(handler1).toHaveBeenCalledWith("data");
      expect(handler2).toHaveBeenCalledWith("data");
    });

    it("should return a cleanup function that unsubscribes", async () => {
      const handler = vi.fn();
      const cleanup = bus.subscribe("cleanup", handler);

      cleanup();
      await bus.publish("cleanup", "data");

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("once", () => {
    it("should fire only once", async () => {
      const handler = vi.fn();
      bus.once("single-fire", handler);

      await bus.publish("single-fire", 1);
      await bus.publish("single-fire", 2);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(1);
    });

    it("should work alongside regular subscribers", async () => {
      const regular = vi.fn();
      const onceHandler = vi.fn();
      bus.subscribe("mixed", regular);
      bus.once("mixed", onceHandler);

      await bus.publish("mixed", "first");
      await bus.publish("mixed", "second");

      expect(regular).toHaveBeenCalledTimes(2);
      expect(onceHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe("async delivery mode", () => {
    it("should deliver all handlers even if some reject", async () => {
      const asyncBus = new EventBus({ asyncDelivery: true });
      const good = vi.fn();
      const bad = vi.fn().mockRejectedValue(new Error("oops"));
      const good2 = vi.fn();

      asyncBus.subscribe("async-test", good);
      asyncBus.subscribe("async-test", bad);
      asyncBus.subscribe("async-test", good2);

      await asyncBus.publish("async-test", "data");

      expect(good).toHaveBeenCalled();
      expect(bad).toHaveBeenCalled();
      expect(good2).toHaveBeenCalled();
    });
  });

  describe("max listeners", () => {
    it("should warn when max listeners is reached", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const bus = new EventBus({ maxListeners: 2 });

      bus.subscribe("capped", vi.fn());
      bus.subscribe("capped", vi.fn());
      bus.subscribe("capped", vi.fn());

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("max listeners (2) reached"),
      );
      warnSpy.mockRestore();
    });
  });

  describe("clear", () => {
    it("should clear a specific event", async () => {
      const handler = vi.fn();
      bus.subscribe("specific", handler);
      bus.clear("specific");

      await bus.publish("specific", "data");
      expect(handler).not.toHaveBeenCalled();
    });

    it("should clear all events when no argument given", async () => {
      const h1 = vi.fn();
      const h2 = vi.fn();
      bus.subscribe("evt1", h1);
      bus.subscribe("evt2", h2);
      bus.clear();

      await bus.publish("evt1", "data");
      await bus.publish("evt2", "data");
      expect(h1).not.toHaveBeenCalled();
      expect(h2).not.toHaveBeenCalled();
    });

    it("should also clear once listeners", async () => {
      const handler = vi.fn();
      bus.once("once-clear", handler);
      bus.clear("once-clear");

      await bus.publish("once-clear", "data");
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("listenerCount", () => {
    it("should return the correct count", () => {
      bus.subscribe("counted", vi.fn());
      bus.subscribe("counted", vi.fn());
      bus.once("counted", vi.fn());

      expect(bus.listenerCount("counted")).toBe(3);
    });

    it("should return 0 for unknown events", () => {
      expect(bus.listenerCount("nonexistent")).toBe(0);
    });
  });

  describe("error handling", () => {
    it("should not throw when retryFailed is true", async () => {
      const safeBus = new EventBus({ retryFailed: true });
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      safeBus.subscribe("safe", () => {
        throw new Error("handler error");
      });

      await safeBus.publish("safe", "data");
      expect(errSpy).toHaveBeenCalled();

      errSpy.mockRestore();
    });

    it("should throw when retryFailed is false and handler throws", async () => {
      bus.subscribe("unsafe", () => {
        throw new Error("handler error");
      });

      await expect(bus.publish("unsafe", "data")).rejects.toThrow("handler error");
    });
  });

  describe("publish", () => {
    it("should handle no subscribers gracefully", async () => {
      await expect(bus.publish("no-one", "data")).resolves.toBeUndefined();
    });

    it("should support async handlers in synchronous delivery mode", async () => {
      const handler = vi.fn().mockResolvedValue("done");
      bus.subscribe("async-h", handler);
      await bus.publish("async-h", "data");
      expect(handler).toHaveBeenCalledWith("data");
    });
  });
});
