import { describe, it, expect, beforeEach, vi } from "vitest";
import { LifecycleManager } from "./lifecycle.js";

describe("LifecycleManager", () => {
  let lc: LifecycleManager;

  beforeEach(() => {
    lc = new LifecycleManager();
  });

  describe("initial state", () => {
    it("should start at init stage", () => {
      expect(lc.stage).toBe("init");
    });

    it("should not be running initially", () => {
      expect(lc.isRunning).toBe(false);
    });

    it("should not be stopped initially", () => {
      expect(lc.isStopped).toBe(false);
    });
  });

  describe("on()", () => {
    it("should register a hook that fires on transition", async () => {
      const hook = vi.fn();
      lc.on("ready", hook);
      await lc.transition("ready");
      expect(hook).toHaveBeenCalledTimes(1);
    });

    it("should return a cleanup function to remove the hook", async () => {
      const hook = vi.fn();
      const cleanup = lc.on("ready", hook);
      cleanup();
      await lc.transition("ready");
      expect(hook).not.toHaveBeenCalled();
    });

    it("should support multiple hooks for the same stage", async () => {
      const h1 = vi.fn();
      const h2 = vi.fn();
      lc.on("running", h1);
      lc.on("running", h2);
      await lc.transition("running");
      expect(h1).toHaveBeenCalledOnce();
      expect(h2).toHaveBeenCalledOnce();
    });
  });

  describe("start()", () => {
    it("should transition through init -> ready -> running", async () => {
      const stages: string[] = [];
      lc.on("init", () => { stages.push("init"); });
      lc.on("ready", () => { stages.push("ready"); });
      lc.on("running", () => { stages.push("running"); });

      await lc.start();

      expect(stages).toEqual(["init", "ready", "running"]);
      expect(lc.stage).toBe("running");
    });

    it("should set isRunning to true", async () => {
      await lc.start();
      expect(lc.isRunning).toBe(true);
    });
  });

  describe("stop()", () => {
    it("should transition through stopping -> stopped", async () => {
      await lc.start();

      const stages: string[] = [];
      lc.on("stopping", () => { stages.push("stopping"); });
      lc.on("stopped", () => { stages.push("stopped"); });

      await lc.stop();

      expect(stages).toEqual(["stopping", "stopped"]);
      expect(lc.stage).toBe("stopped");
    });

    it("should set isStopped to true", async () => {
      await lc.start();
      await lc.stop();
      expect(lc.isStopped).toBe(true);
      expect(lc.isRunning).toBe(false);
    });
  });

  describe("hook errors", () => {
    it("should not break lifecycle when a hook throws", async () => {
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      lc.on("ready", () => { throw new Error("hook failed"); });

      await lc.transition("ready");

      expect(lc.stage).toBe("ready");
      expect(lc.lastError).toBeDefined();
      expect(lc.lastError!.message).toBe("hook failed");

      errSpy.mockRestore();
    });

    it("should continue running other hooks after one fails", async () => {
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const goodHook = vi.fn();

      lc.on("ready", () => { throw new Error("bad"); });
      lc.on("ready", goodHook);

      await lc.transition("ready");

      expect(goodHook).toHaveBeenCalled();
      errSpy.mockRestore();
    });
  });

  describe("getters", () => {
    it("should track stage correctly through lifecycle", async () => {
      expect(lc.stage).toBe("init");
      await lc.transition("ready");
      expect(lc.stage).toBe("ready");
      await lc.transition("running");
      expect(lc.stage).toBe("running");
      await lc.transition("stopping");
      expect(lc.stage).toBe("stopping");
      await lc.transition("stopped");
      expect(lc.stage).toBe("stopped");
    });

    it("should return undefined lastError when no error occurred", () => {
      expect(lc.lastError).toBeUndefined();
    });
  });
});
