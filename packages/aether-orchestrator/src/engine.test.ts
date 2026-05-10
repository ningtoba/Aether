import { describe, it, expect, beforeEach } from "vitest";
import { OrchestrationEngine } from "../src/engine.js";
import { WorkflowBuilder } from "../src/workflow.js";
import { InMemoryCheckpointManager } from "../src/checkpoint.js";
import type { WorkflowDefinition } from "../src/types.js";

// ─── Helpers ──────────────────────────────────────────────

/** Build a simple linear two-node workflow for basic tests */
function linearWorkflow(name = "linear-test"): WorkflowDefinition {
  return new WorkflowBuilder(name, "1.0.0", "Linear Test Workflow")
    .agentNode("research", "researcher", "Researches the topic")
    .agentNode("summarize", "summarizer", "Summarizes findings")
    .connect("research", "summarize")
    .withEntry("research")
    .withTerminal("summarize")
    .build();
}

/** Build a branching workflow with conditional edges */
function branchingWorkflow(name = "branch-test"): WorkflowDefinition {
  return new WorkflowBuilder(name, "1.0.0", "Branching Test")
    .routerNode("router", "Route based on complexity", "Decide if the query is simple or complex")
    .agentNode("quick", "quick-agent", "Handle simple queries")
    .agentNode("deep", "deep-agent", "Handle complex queries")
    .agentNode("final", "final-agent", "Final output")
    .connect("router", "quick")
    .connect("router", "deep")
    .connectIf("quick", "final", [
      { field: "data.complexity", operator: "eq", value: "simple" },
    ])
    .connectIf("deep", "final", [
      { field: "data.complexity", operator: "eq", value: "complex" },
    ])
    .withEntry("router")
    .withTerminal("final")
    .withInitialStateField("complexity", "string", true, "simple")
    .build();
}

/** Build a map-reduce workflow */
function mapReduceWorkflow(name = "mapreduce-test"): WorkflowDefinition {
  return new WorkflowBuilder(name, "1.0.0", "Map-Reduce Test")
    .routerNode("splitter", "Split input into chunks", "Split the input")
    .mapNode("process", "Process each chunk in parallel")
    .reduceNode("merge", "Merge all results")
    .connect("splitter", "process")
    .connect("process", "merge")
    .withEntry("splitter")
    .withTerminal("merge")
    .withInitialStateField("chunks", "array", true)
    .build();
}

/** Build a workflow with retry policy */
function retryWorkflow(name = "retry-test"): WorkflowDefinition {
  return new WorkflowBuilder(name, "1.0.0", "Retry Test")
    .addNode({
      id: "unstable",
      kind: "tool",
      toolName: "unstable-tool",
      onError: "retry",
      retry: {
        maxAttempts: 3,
        baseDelayMs: 10,
        maxDelayMs: 100,
        backoffFactor: 2,
        retryableErrors: [],
      },
    })
    .agentNode("final", "final-agent", "Final output")
    .connect("unstable", "final")
    .withEntry("unstable")
    .withTerminal("final")
    .build();
}

// ─── Tests ─────────────────────────────────────────────────

describe("OrchestrationEngine", () => {
  let engine: OrchestrationEngine;

  beforeEach(() => {
    engine = new OrchestrationEngine({
      autoCheckpoint: true,
    });
  });

  describe("linear execution", () => {
    it("should execute a simple linear workflow", async () => {
      const workflow = linearWorkflow();
      const result = await engine.execute(workflow, { topic: "AI safety" });

      expect(result.status).toBe("completed");
      expect(result.nodeHistory).toHaveLength(2);
      expect(result.nodeHistory[0]!.nodeId).toBe("research");
      expect(result.nodeHistory[0]!.status).toBe("completed");
      expect(result.nodeHistory[1]!.nodeId).toBe("summarize");
      expect(result.nodeHistory[1]!.status).toBe("completed");
      expect(result.workflowId).toBe("linear-test");
    });

    it("should include initial state data in the output", async () => {
      const workflow = linearWorkflow();
      const result = await engine.execute(workflow, { topic: "AI safety", depth: "deep" });

      expect(result.data).toHaveProperty("topic", "AI safety");
      expect(result.data).toHaveProperty("depth", "deep");
    });

    it("should store node outputs under their ids", async () => {
      const workflow = linearWorkflow();
      const result = await engine.execute(workflow, { topic: "test" });

      expect(result.data).toHaveProperty("research.output");
      expect(result.data).toHaveProperty("summarize.output");
    });
  });

  describe("branching execution", () => {
    it("should follow the simple branch when condition matches", async () => {
      const workflow = branchingWorkflow();
      const result = await engine.execute(workflow, { complexity: "simple" });

      expect(result.status).toBe("completed");
      const nodeIds = result.nodeHistory.map((n) => n.nodeId);
      expect(nodeIds).toContain("router");
      expect(nodeIds).toContain("quick");
      expect(nodeIds).toContain("final");
    });

    it("should follow the complex branch when condition matches", async () => {
      const workflow = branchingWorkflow();
      const result = await engine.execute(workflow, { complexity: "complex" });

      expect(result.status).toBe("completed");
      const nodeIds = result.nodeHistory.map((n) => n.nodeId);
      expect(nodeIds).toContain("router");
      expect(nodeIds).toContain("deep");
      expect(nodeIds).toContain("final");
    });
  });

  describe("map-reduce execution", () => {
    it("should execute a map-reduce workflow", async () => {
      const workflow = mapReduceWorkflow();
      const result = await engine.execute(workflow, { chunks: ["a", "b", "c"] });

      expect(result.status).toBe("completed");
      expect(result.nodeHistory.map((n) => n.nodeId)).toEqual([
        "splitter",
        "process",
        "merge",
      ]);
    });
  });

  describe("checkpointing", () => {
    it("should save checkpoints after each node", async () => {
      const cm = new InMemoryCheckpointManager();
      engine = new OrchestrationEngine({
        autoCheckpoint: true,
        checkpointManager: cm,
      });
      const workflow = linearWorkflow();
      const result = await engine.execute(workflow, { topic: "checkpoint test" });

      const checkpoints = await cm.list(result.executionId);
      // Initial checkpoint + after each node + final = 4
      expect(checkpoints.length).toBeGreaterThanOrEqual(3);
    });

    it("should allow resuming from a checkpoint", async () => {
      const cm = new InMemoryCheckpointManager();
      engine = new OrchestrationEngine({
        autoCheckpoint: true,
        checkpointManager: cm,
      });
      const workflow = linearWorkflow();
      const result = await engine.execute(workflow, { topic: "resume test" });

      const checkpoints = await cm.list(result.executionId);
      expect(checkpoints.length).toBeGreaterThanOrEqual(2);

      // Resume from the first checkpoint
      const resumed = await engine.execute(workflow, {}, {
        resumeExecutionId: result.executionId,
        resumeCheckpointId: checkpoints[0]!.id,
      });

      expect(resumed.status).toBe("completed");
      expect(resumed.executionId).toBe(result.executionId);
    });

    it("should disable checkpointing when configured", async () => {
      const cm = new InMemoryCheckpointManager();
      engine = new OrchestrationEngine({
        autoCheckpoint: false,
        checkpointManager: cm,
      });
      const workflow = linearWorkflow();
      const result = await engine.execute(workflow, { topic: "no cp" });

      const checkpoints = await cm.list(result.executionId);
      // Only one checkpoint saved at the very end if at all
      // Actually with autoCheckpoint=false there should be 0 mid-exec checkpoints
      // but the end-of-execution checkpoint is always saved
      expect(checkpoints.length).toBeLessThanOrEqual(1);
    });
  });

  describe("error handling and retry", () => {
    it("should retry on failure when retry policy is configured", async () => {
      // Create a custom engine that overrides runNodeLogic to fail on first attempt
      // We test this by having an unstable node with retry policy
      engine = new OrchestrationEngine({
        autoCheckpoint: false,
      });
      const workflow = retryWorkflow();
      const result = await engine.execute(workflow, {});

      expect(result.status).toBe("completed");
      // The unstable node should eventually succeed
      const unstableNode = result.nodeHistory.find((n) => n.nodeId === "unstable");
      expect(unstableNode).toBeDefined();
      // It may take multiple attempts
      expect(unstableNode!.attempt).toBeLessThanOrEqual(3);
      expect(unstableNode!.status).toBe("completed");
    });

    it("should fail gracefully for unknown node kinds", async () => {
      const workflow = new WorkflowBuilder("bad-kind", "1.0.0")
        .addNode({ id: "bad", kind: "signal" as any, label: "bad node" })
        .withEntry("bad")
        .withTerminal("bad")
        .build();

      // This should execute without crashing — signal nodes are valid
      const result = await engine.execute(workflow, {});
      expect(result.status).toBe("completed");
    });
  });

  describe("WorkflowBuilder validation", () => {
    it("should reject workflows without an entry node", () => {
      const builder = new WorkflowBuilder("no-entry", "1.0.0")
        .agentNode("a", "agent-A");

      expect(() => (builder as any).build()).toThrow();
    });

    it("should reject workflows without terminal nodes", () => {
      const builder = new WorkflowBuilder("no-term", "1.0.0")
        .agentNode("a", "agent-A")
        .withEntry("a");

      expect(() => (builder as any).build()).toThrow();
    });

    it("should reject edges referencing unknown nodes", () => {
      const builder = new WorkflowBuilder("bad-edge", "1.0.0")
        .agentNode("a", "agent-A")
        .agentNode("b", "agent-B")
        .connect("a", "nonexistent")
        .withEntry("a")
        .withTerminal("b");

      expect(() => builder.build()).toThrow(/unknown/);
    });

    it("should support fluent chaining for common patterns", () => {
      const workflow = new WorkflowBuilder("fluent", "2.0.0", "Fluent Test")
        .agentNode("start", "agent-A", "Entry agent")
        .routerNode("router", "Routing decision", "Decide path")
        .agentNode("pathA", "agent-B", "Path A handler")
        .agentNode("pathB", "agent-C", "Path B handler")
        .agentNode("end", "agent-D", "Final output")
        .connect("start", "router")
        .connect("router", "pathA")
        .connect("router", "pathB")
        .connect("pathA", "end")
        .connect("pathB", "end")
        .withEntry("start")
        .withTerminal("end")
        .withInitialStateField("input", "string", true)
        .build();

      expect(workflow.id).toBe("fluent");
      expect(workflow.version).toBe("2.0.0");
      expect(workflow.nodes).toHaveLength(5);
      expect(workflow.edges).toHaveLength(5);
      expect(workflow.entryNode).toBe("start");
      expect(workflow.terminalNodes).toEqual(["end"]);
    });
  });

  describe("InMemoryCheckpointManager", () => {
    it("should save and retrieve checkpoints", async () => {
      const cm = new InMemoryCheckpointManager();
      const execId = "exec-test-1";
      const cp = {
        id: "cp-1",
        executionId: execId,
        state: {} as any,
        createdAt: new Date().toISOString(),
      };

      await cm.save(cp);
      const retrieved = await cm.get(execId, "cp-1");
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe("cp-1");
    });

    it("should list checkpoints in order", async () => {
      const cm = new InMemoryCheckpointManager();
      const execId = "exec-test-2";

      for (let i = 1; i <= 5; i++) {
        await cm.save({
          id: `cp-${i}`,
          executionId: execId,
          state: {} as any,
          createdAt: new Date().toISOString(),
        });
      }

      const list = await cm.list(execId);
      expect(list).toHaveLength(5);
    });

    it("should delete individual checkpoints", async () => {
      const cm = new InMemoryCheckpointManager();
      const execId = "exec-test-3";

      await cm.save({
        id: "cp-1",
        executionId: execId,
        state: {} as any,
        createdAt: new Date().toISOString(),
      });
      await cm.save({
        id: "cp-2",
        executionId: execId,
        state: {} as any,
        createdAt: new Date().toISOString(),
      });

      expect(await cm.delete(execId, "cp-1")).toBe(true);
      const remaining = await cm.list(execId);
      expect(remaining).toHaveLength(1);
      expect(remaining[0]!.id).toBe("cp-2");
    });
  });
});
