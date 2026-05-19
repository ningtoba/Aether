import { describe, it, expect, beforeEach } from "vitest";
import { Router } from "./router.js";
import type { IncomingMessage, ServerResponse } from "node:http";

function mockReq(method: string, url: string): Partial<IncomingMessage> {
  return { method, url };
}

function mockRes(): Partial<ServerResponse> {
  return {
    writeHead: vi.fn() as any,
    end: vi.fn() as any,
    setHeader: vi.fn() as any,
  };
}

import { vi } from "vitest";

describe("Router", () => {
  let router: Router;

  beforeEach(() => {
    router = new Router();
  });

  describe("route registration", () => {
    it("should register a GET route", () => {
      const handler = () => {};
      router.get("/test", handler);
      const match = router.match("GET", "/test");
      expect(match).not.toBeNull();
      expect(match!.handler).toBe(handler);
    });

    it("should register a POST route", () => {
      const handler = () => {};
      router.post("/test", handler);
      expect(router.match("POST", "/test")).not.toBeNull();
    });

    it("should register a PUT route", () => {
      const handler = () => {};
      router.put("/test", handler);
      expect(router.match("PUT", "/test")).not.toBeNull();
    });

    it("should register a DELETE route", () => {
      const handler = () => {};
      router.delete("/test", handler);
      expect(router.match("DELETE", "/test")).not.toBeNull();
    });
  });

  describe("pattern matching", () => {
    it("should match static paths exactly", () => {
      router.get("/api/agents", () => {});
      expect(router.match("GET", "/api/agents")).not.toBeNull();
      expect(router.match("GET", "/api/agents/")).toBeNull();
    });

    it("should match routes with :param placeholders", () => {
      router.get("/api/agents/:id", () => {});
      const match = router.match("GET", "/api/agents/agent-123");
      expect(match).not.toBeNull();
      expect(match!.params.id).toBe("agent-123");
    });

    it("should extract multiple params from a path", () => {
      router.get("/api/:resource/:id", () => {});
      const match = router.match("GET", "/api/agents/42");
      expect(match).not.toBeNull();
      expect(match!.params.resource).toBe("agents");
      expect(match!.params.id).toBe("42");
    });

    it("should match route with trailing query string", () => {
      router.get("/api/agents", () => {});
      const match = router.match("GET", "/api/agents?page=1&limit=10");
      expect(match).not.toBeNull();
    });

    it("should return null for unmatched routes (404)", () => {
      router.get("/api/agents", () => {});
      const match = router.match("GET", "/api/nonexistent");
      expect(match).toBeNull();
    });

    it("should return null for wrong HTTP method", () => {
      router.get("/api/agents", () => {});
      expect(router.match("POST", "/api/agents")).toBeNull();
      expect(router.match("DELETE", "/api/agents")).toBeNull();
    });

    it("should handle URL-encoded params", () => {
      router.get("/items/:name", () => {});
      const match = router.match("GET", "/items/hello%20world");
      expect(match).not.toBeNull();
      expect(match!.params.name).toBe("hello world");
    });
  });

  describe("multiple routes", () => {
    it("should match the correct route among many", () => {
      let called = "";
      router.get("/api/agents", () => { called = "list"; });
      router.get("/api/agents/:id", () => { called = "detail"; });

      const match = router.match("GET", "/api/agents")!;
      match.handler(mockReq("GET", "/api/agents") as IncomingMessage, mockRes() as ServerResponse, {});
      expect(called).toBe("list");
    });
  });
});
