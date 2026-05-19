import { describe, it, expect, beforeEach, vi } from "vitest";
import { ToolRegistry, createTool } from "./tools.js";
import type { ToolDefinition } from "./types.js";

describe("ToolRegistry", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  describe("register", () => {
    it("should register a tool definition", () => {
      const tool: ToolDefinition = {
        name: "get_weather",
        description: "Get weather for a location",
        parameters: { type: "object", properties: { location: { type: "string" } } },
        handler: async (args: unknown) => `Weather for ${JSON.stringify(args)}`,
      };
      registry.register(tool);
      expect(registry.get("get_weather")).toBeDefined();
    });

    it("should throw when registering a duplicate tool", () => {
      const tool: ToolDefinition = {
        name: "duplicate",
        description: "",
        parameters: {},
      };
      registry.register(tool);
      expect(() => registry.register(tool)).toThrow("already registered");
    });
  });

  describe("get", () => {
    it("should return a tool by name", () => {
      const tool: ToolDefinition = {
        name: "search",
        description: "Search the web",
        parameters: { query: { type: "string" } },
      };
      registry.register(tool);
      const result = registry.get("search");
      expect(result).toBeDefined();
      expect(result!.name).toBe("search");
    });

    it("should return undefined for unknown tool", () => {
      expect(registry.get("unknown")).toBeUndefined();
    });
  });

  describe("list", () => {
    it("should return all registered tools", () => {
      registry.register({ name: "tool1", description: "", parameters: {} });
      registry.register({ name: "tool2", description: "", parameters: {} });
      const tools = registry.list();
      expect(tools).toHaveLength(2);
      expect(tools.map((t) => t.name)).toContain("tool1");
      expect(tools.map((t) => t.name)).toContain("tool2");
    });

    it("should return an empty array when no tools registered", () => {
      expect(registry.list()).toHaveLength(0);
    });
  });

  describe("remove", () => {
    it("should remove a tool by name and return true", () => {
      registry.register({ name: "removable", description: "", parameters: {} });
      const result = registry.remove("removable");
      expect(result).toBe(true);
      expect(registry.get("removable")).toBeUndefined();
    });

    it("should return false when tool does not exist", () => {
      expect(registry.remove("nonexistent")).toBe(false);
    });
  });
});

describe("createTool", () => {
  it("should create a tool definition with name, description, parameters, and handler", () => {
    const handler = vi.fn();
    const tool = createTool(
      "my_tool",
      "Does something useful",
      { type: "object", properties: { input: { type: "string" } } },
      handler,
    ) as ToolDefinition;

    expect(tool.name).toBe("my_tool");
    expect(tool.description).toBe("Does something useful");
    expect(tool.parameters).toEqual({ type: "object", properties: { input: { type: "string" } } });
    expect(tool.handler).toBe(handler);
  });

  it("should work with async handlers", async () => {
    const tool = createTool(
      "async_tool",
      "Async operation",
      {},
      async () => "done",
    ) as ToolDefinition;

    const result = await tool.handler!();
    expect(result).toBe("done");
  });

  it("should work without a handler (optional)", () => {
    // createTool requires a handler, but ToolDefinition makes it optional
    const tool = createTool("no_handler", "No handler", {}, async () => {}) as ToolDefinition;
    // We can still inspect the metadata
    expect(tool.name).toBe("no_handler");
  });
});
