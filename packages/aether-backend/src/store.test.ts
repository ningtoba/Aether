import { describe, it, expect, beforeEach } from "vitest";
import * as store from "./store.js";
import type { AgentId } from "./store.js";

describe("Agent Store", () => {
  beforeEach(() => {
    // Since store uses a module-level Map, we need to clear it.
    // These tests assume the store functions are stateless per-test.
    // We use deleteAgent for any agents we create.
  });

  describe("createAgent", () => {
    it("should create an agent with the given name", () => {
      const agent = store.createAgent({ name: "test-agent" });
      expect(agent.name).toBe("test-agent");
      expect(agent.status).toBe("idle");
      expect(agent.id).toBeDefined();
      expect(agent.createdAt).toBeDefined();
      expect(agent.updatedAt).toBeDefined();
    });

    it("should create an agent with optional config", () => {
      const agent = store.createAgent({
        name: "configured-agent",
        config: { model: "gpt-4o", temperature: 0.7 },
      });
      expect(agent.config.model).toBe("gpt-4o");
      expect(agent.config.temperature).toBe(0.7);
    });

    it("should assign unique IDs to each agent", () => {
      const a1 = store.createAgent({ name: "agent-1" });
      const a2 = store.createAgent({ name: "agent-2" });
      expect(a1.id).not.toBe(a2.id);
    });
  });

  describe("getAgent", () => {
    it("should return an agent by ID", () => {
      const created = store.createAgent({ name: "fetch-me" });
      const fetched = store.getAgent(created.id);
      expect(fetched).toBeDefined();
      expect(fetched!.name).toBe("fetch-me");
    });

    it("should return undefined for non-existent agent", () => {
      expect(store.getAgent("nonexistent" as AgentId)).toBeUndefined();
    });
  });

  describe("listAgents", () => {
    it("should return all agents", () => {
      store.createAgent({ name: "a1" });
      store.createAgent({ name: "a2" });
      const agents = store.listAgents();
      expect(agents.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("updateAgent", () => {
    it("should update agent fields", () => {
      const agent = store.createAgent({ name: "updatable" });
      const updated = store.updateAgent(agent.id, { name: "updated-name", status: "running" });
      expect(updated).toBeDefined();
      expect(updated!.name).toBe("updated-name");
      expect(updated!.status).toBe("running");
    });

    it("should preserve id and createdAt on update", () => {
      const agent = store.createAgent({ name: "preserve-test" });
      const updated = store.updateAgent(agent.id, { name: "new-name" });
      expect(updated!.id).toBe(agent.id);
      expect(updated!.createdAt).toBe(agent.createdAt);
    });

    it("should return undefined for non-existent agent", () => {
      const result = store.updateAgent("nonexistent" as AgentId, { name: "nope" });
      expect(result).toBeUndefined();
    });
  });

  describe("deleteAgent", () => {
    it("should delete an existing agent and return true", () => {
      const agent = store.createAgent({ name: "delete-me" });
      const result = store.deleteAgent(agent.id);
      expect(result).toBe(true);
      expect(store.getAgent(agent.id)).toBeUndefined();
    });

    it("should return false for non-existent agent", () => {
      expect(store.deleteAgent("nonexistent" as AgentId)).toBe(false);
    });
  });
});
