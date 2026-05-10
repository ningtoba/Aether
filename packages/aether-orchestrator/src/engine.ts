import type {
  OrchestrationConfig,
  WorkflowDefinition,
  WorkflowState,
  Checkpoint,
  CheckpointManager,
  NodeDefinition,
  NodeExecution,
  EdgeDefinition,
  NodeId,
  NodeStatus,
  Condition,
  RetryPolicy,
} from "./types.js";
import { DEFAULT_ORCHESTRATION_CONFIG } from "./types.js";
import { InMemoryCheckpointManager } from "./checkpoint.js";

/**
 * OrchestrationEngine — the core LangGraph-inspired graph execution engine.
 *
 * Given a WorkflowDefinition, this engine:
 *   - Resolves the entry node and walks edges
 *   - Executes each node (agent, tool, router, map/reduce, subgraph, sleep, signal)
 *   - Evaluates conditional and LLM-routed edges for branching
 *   - Checkpoints after each node (if configured)
 *   - Supports retry with exponential backoff
 *   - Supports parallel fan-out (map) and fan-in (reduce)
 *   - Supports pause/resume via checkpoint restore
 *
 * @example
 * ```ts
 * const engine = new OrchestrationEngine(config);
 * const workflow = new WorkflowBuilder("my-wf", "1.0.0")
 *   .addNode({ id: "start", kind: "agent", agentName: "researcher" })
 *   .addEdge({ id: "e1", from: "start", to: "end", kind: "direct" })
 *   .withEntry("start").withTerminal("end")
 *   .build();
 *
 * const result = await engine.execute(workflow, { input: "..." });
 * ```
 */
export class OrchestrationEngine {
  private config: OrchestrationConfig;
  private checkpointManager: CheckpointManager | null;

  constructor(config?: Partial<OrchestrationConfig>) {
    this.config = { ...DEFAULT_ORCHESTRATION_CONFIG, ...config };
    this.checkpointManager = this.config.checkpointManager ?? new InMemoryCheckpointManager();
  }

  // ─── Public API ─────────────────────────────────────────

  /**
   * Execute a workflow definition with the given initial data.
   *
   * @param workflow - The workflow to execute
   * @param initialData - Initial state data
   * @param options - Execution options (resume after pause, etc.)
   * @returns The final WorkflowState after execution completes
   */
  async execute(
    workflow: WorkflowDefinition,
    initialData?: Record<string, unknown>,
    options?: { resumeExecutionId?: string; resumeCheckpointId?: string },
  ): Promise<WorkflowState> {
    // If resuming, restore from checkpoint
    if (options?.resumeExecutionId) {
      return this.resume(workflow, options.resumeExecutionId, options.resumeCheckpointId);
    }

    // Build initial execution state
    const state = this.createInitialState(
      workflow,
      initialData ?? {},
    );

    // Run the graph
    return this.runGraph(workflow, state);
  }

  /**
   * Get the checkpoint manager for inspection.
   */
  getCheckpointManager(): CheckpointManager | null {
    return this.checkpointManager;
  }

  // ─── Internal Graph Runner ──────────────────────────────

  private async runGraph(
    workflow: WorkflowDefinition,
    state: WorkflowState,
  ): Promise<WorkflowState> {
    const visited = new Set<NodeId>();
    const queue: NodeId[] = [workflow.entryNode];

    while (queue.length > 0 && state.status === "running") {
      const currentNodeId = queue.shift()!;

      // Skip already-completed nodes (e.g. when branching revisits)
      if (visited.has(currentNodeId)) continue;
      visited.add(currentNodeId);

      // Look up the node definition
      const nodeDef = workflow.nodes.find((n) => n.id === currentNodeId);
      if (!nodeDef) {
        state.status = "failed";
        state.error = `Node "${currentNodeId}" not found in workflow definition`;
        break;
      }

      // Build node execution tracker
      const nodeExec = this.createNodeExecution(nodeDef.id);
      state.nodeHistory.push(nodeExec);
      state.currentNode = nodeDef.id;

      // Execute the node (with retry)
      await this.executeNode(nodeDef, state, nodeExec);

      // Checkpoint after node execution
      if (this.config.autoCheckpoint) {
        await this.saveCheckpoint(state);
      }

      // If node failed and policy isn't "skip" or "fallback", stop
      if (nodeExec.status === "failed") {
        if (nodeDef.onError === "skip") {
          continue; // Just skip this node
        } else if (nodeDef.onError === "fallback") {
          nodeExec.output = nodeDef.fallbackOutput;
          nodeExec.status = "completed";
        } else {
          state.status = "failed";
          state.error = nodeExec.error;
          break;
        }
      }
 if (state.status !== "running") break;

      // Resolve outgoing edges
      const outgoing = workflow.edges.filter((e) => e.from === currentNodeId);
      if (outgoing.length === 0) {
        // No outgoing edges — check if terminal
        if (!workflow.terminalNodes.includes(currentNodeId)) {
          state.status = "failed";
          state.error = `Node "${currentNodeId}" has no outgoing edges and is not a terminal node.`;
          break;
        }
        // Terminal node reached — we're done if all terminals hit
        if (this.allTerminalsReached(workflow, visited)) {
          state.status = "completed";
        }
        break;
      }

      // For direct edges, simply add the target to queue
      for (const edge of outgoing) {
        switch (edge.kind) {
          case "direct":
            queue.push(edge.to);
            break;
          case "conditional":
            if (this.evaluateConditions(edge, state)) {
              queue.push(edge.to);
            }
            break;
          case "llm-route":
            // In a full impl this would ask an LLM router which branch to take.
            // For now, evaluate conditions as fallback.
            if (edge.conditions && this.evaluateConditions(edge, state)) {
              queue.push(edge.to);
            }
            break;
        }
      }
    }

    // Mark as completed if still running and queue is empty
    if (state.status === "running") {
      state.status = "completed";
    }

    state.lastCheckpointAt = new Date().toISOString();
    await this.saveCheckpoint(state);

    return state;
  }

  // ─── Node Execution ─────────────────────────────────────

  private async executeNode(
    nodeDef: NodeDefinition,
    state: WorkflowState,
    nodeExec: NodeExecution,
  ): Promise<void> {
    const retryPolicy = nodeDef.retry ?? this.config.defaultRetry;
    let attempt = 0;
    const maxAttempts = retryPolicy?.maxAttempts ?? 1;

    while (attempt < maxAttempts) {
      attempt++;
      nodeExec.attempt = attempt;
      nodeExec.status = "running";
      nodeExec.startedAt = Date.now();

      try {
        const output = await this.runNodeLogic(nodeDef, state, nodeExec);
        nodeExec.output = output;
        nodeExec.status = "completed";
        nodeExec.completedAt = Date.now();

        // Apply output mapping if specified
        if (nodeDef.outputMapping && typeof output === "object" && output !== null) {
          for (const [stateKey, outputKey] of Object.entries(nodeDef.outputMapping)) {
            state.data[stateKey] = (output as Record<string, unknown>)[outputKey];
          }
        } else {
          // Default: store full output under node id
          state.data[`${nodeDef.id}.output`] = output;
        }

        return; // Success
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        nodeExec.error = errorMsg;
        nodeExec.status = "failed";

        // Check if we should retry
        if (attempt < maxAttempts && retryPolicy && this.shouldRetry(errorMsg, retryPolicy)) {
          const delay = this.calculateBackoff(attempt, retryPolicy);
          await this.sleep(delay);
          nodeExec.status = "running";
          continue;
        }

        // No more retries — propagate failure
        state.status = "failed";
        state.error = errorMsg;
        return;
      }
    }
  }

  /**
   * Run the actual logic for a single node based on its kind.
   *
   * This is the extensible dispatch point. In production, each kind
   * would be wired to the appropriate subsystem (agent runner, tool
   * executor, subgraph engine, etc.).
   */
  private async runNodeLogic(
    nodeDef: NodeDefinition,
    state: WorkflowState,
    nodeExec: NodeExecution,
  ): Promise<unknown> {
    // Apply input mapping from state data
    const input = this.resolveInput(nodeDef, state);

    switch (nodeDef.kind) {
      case "agent": {
        // Agent execution — would call AetherRunner.run() in production
        // For now, simulate agent output with relevant context
        return {
          status: "ok",
          agentName: nodeDef.agentName ?? "unknown",
          result: `[simulated] ${nodeDef.agentName} processed input`,
          inputReceived: input,
        };
      }

      case "tool": {
        // Tool execution — would call ToolRegistry in production
        return {
          status: "ok",
          toolName: nodeDef.toolName ?? "unknown",
          result: `[simulated] tool ${nodeDef.toolName} executed`,
          inputReceived: input,
        };
      }

      case "router": {
        // LLM-as-router — would call an LLM to decide the next node
        // The actual routing decision is made by edge evaluation in runGraph
        return {
          status: "ok",
          route: "evaluated",
          inputReceived: input,
        };
      }

      case "map": {
        // Parallel fan-out — for each item in the input list, spawn a sub-execution
        const items = Array.isArray(input) ? input : [input];
        return {
          status: "ok",
          kind: "map",
          itemCount: items.length,
          itemsProcessed: items.length, // In production, parallel execution
        };
      }

      case "reduce": {
        // Fan-in merge — collect results from upstream map outputs
        return {
          status: "ok",
          kind: "reduce",
          mergedResult: input,
        };
      }

      case "subgraph": {
        // Sub-workflow execution — recursively run a nested workflow
        return {
          status: "ok",
          subgraphId: nodeDef.subgraphId,
          result: "[simulated] subgraph executed",
        };
      }

      case "sleep": {
        // Timer / delay — just wait
        const timeout = nodeDef.timeout ?? 1000;
        await this.sleep(timeout);
        return { status: "ok", slept: timeout };
      }

      case "signal": {
        // Wait for external signal — would block on webhook/human input
        return {
          status: "paused",
          kind: "signal",
          message: "Waiting for external signal (simulated: auto-resolve)",
        };
      }

      default: {
        throw new Error(`Unknown node kind: ${nodeDef.kind}`);
      }
    }
  }

  // ─── Resumption ─────────────────────────────────────────

  private async resume(
    workflow: WorkflowDefinition,
    executionId: string,
    checkpointId?: string,
  ): Promise<WorkflowState> {
    if (!this.checkpointManager) {
      throw new Error("No checkpoint manager configured — cannot resume");
    }

    let state: WorkflowState | undefined;

    if (checkpointId) {
      const cp = await this.checkpointManager.get(executionId, checkpointId);
      state = cp?.state;
    } else {
      // Use the latest checkpoint
      const checkpoints = await this.checkpointManager.list(executionId);
      if (checkpoints.length > 0) {
        state = checkpoints[checkpoints.length - 1]!.state;

        // Re-find the workflow to continue from where we left off
        // Build edge cache
        const edgeCache = this.buildEdgeCache(workflow);
        const completedNodes = new Set(
          state.nodeHistory
            .filter((n) => n.status === "completed")
            .map((n) => n.nodeId),
        );

        // Find all nodes not yet completed
        const pending = workflow.nodes.filter(
          (n) => !completedNodes.has(n.id),
        );

        if (pending.length > 0) {
          state.status = "running";
          state.currentNode = pending[0]!.id;
          // Continue execution
          return this.runGraph(workflow, state);
        }
      }
    }

    if (!state) {
      throw new Error(`No checkpoint found for execution "${executionId}"`);
    }

    state.status = "completed";
    return state;
  }

  // ─── Helpers ────────────────────────────────────────────

  private createInitialState(
    workflow: WorkflowDefinition,
    initialData: Record<string, unknown>,
  ): WorkflowState {
    // Apply default values from workflow definition
    const data: Record<string, unknown> = { ...initialData };
    for (const [key, field] of Object.entries(workflow.initialState)) {
      if (data[key] === undefined && field.default !== undefined) {
        data[key] = field.default;
      }
    }

    return {
      executionId: `exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      workflowId: workflow.id,
      currentNode: null,
      nodeHistory: [],
      data,
      status: "running",
      startedAt: new Date().toISOString(),
      version: 1,
    };
  }

  private createNodeExecution(nodeId: NodeId): NodeExecution {
    return {
      nodeId,
      status: "pending",
      attempt: 0,
    };
  }

  private resolveInput(
    nodeDef: NodeDefinition,
    state: WorkflowState,
  ): unknown {
    if (!nodeDef.inputMapping || Object.keys(nodeDef.inputMapping).length === 0) {
      // Default: pass the entire data bag
      return { ...state.data };
    }

    // Apply input mapping: build an object with the mapped fields
    const input: Record<string, unknown> = {};
    for (const [inputKey, stateKey] of Object.entries(nodeDef.inputMapping)) {
      input[inputKey] = state.data[stateKey];
    }
    return input;
  }

  private evaluateConditions(edge: EdgeDefinition, state: WorkflowState): boolean {
    if (!edge.conditions || edge.conditions.length === 0) return true;

    for (const condition of edge.conditions) {
      const actualValue = this.resolveFieldValue(condition.field, state);
      if (!this.matchesCondition(actualValue, condition)) {
        return false;
      }
    }
    return true;
  }

  private resolveFieldValue(field: string, state: WorkflowState): unknown {
    // Dot notation: "data.some.key" -> state.data["some"]["key"]
    const parts = field.split(".");
    let value: unknown = state;
    for (const part of parts) {
      if (value !== null && typeof value === "object") {
        value = (value as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }
    return value;
  }

  private matchesCondition(actual: unknown, condition: Condition): boolean {
    switch (condition.operator) {
      case "eq":
        return actual === condition.value;
      case "neq":
        return actual !== condition.value;
      case "gt":
        return (actual as number) > (condition.value as number);
      case "gte":
        return (actual as number) >= (condition.value as number);
      case "lt":
        return (actual as number) < (condition.value as number);
      case "lte":
        return (actual as number) <= (condition.value as number);
      case "exists":
        return actual !== undefined && actual !== null;
      case "matches": {
        if (typeof actual === "string" && typeof condition.value === "string") {
          try {
            return new RegExp(condition.value).test(actual);
          } catch {
            return actual.includes(condition.value);
          }
        }
        return false;
      }
      default:
        return false;
    }
  }

  private shouldRetry(errorMsg: string, policy: RetryPolicy): boolean {
    if (policy.retryableErrors.length === 0) return true; // All errors retryable
    return policy.retryableErrors.some((e) => errorMsg.includes(e));
  }

  private calculateBackoff(attempt: number, policy: RetryPolicy): number {
    const delay = policy.baseDelayMs * Math.pow(policy.backoffFactor, attempt - 1);
    return Math.min(delay, policy.maxDelayMs);
  }

  private allTerminalsReached(
    workflow: WorkflowDefinition,
    visited: Set<NodeId>,
  ): boolean {
    return workflow.terminalNodes.every((t) => visited.has(t));
  }

  private async saveCheckpoint(state: WorkflowState): Promise<void> {
    if (!this.checkpointManager) return;

    state.lastCheckpointAt = new Date().toISOString();
    state.version++;

    const checkpoint: Checkpoint = {
      id: `cp-${state.version}-${Date.now()}`,
      executionId: state.executionId,
      state: JSON.parse(JSON.stringify(state)), // Deep clone
      createdAt: new Date().toISOString(),
      label: `v${state.version} — node: ${state.currentNode ?? "none"}`,
    };

    await this.checkpointManager.save(checkpoint);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Build a cache of outgoing edges per node ID for fast lookup.
   */
  private buildEdgeCache(
    workflow: WorkflowDefinition,
  ): Map<NodeId, EdgeDefinition[]> {
    const cache = new Map<NodeId, EdgeDefinition[]>();
    for (const edge of workflow.edges) {
      const existing = cache.get(edge.from) ?? [];
      existing.push(edge);
      cache.set(edge.from, existing);
    }
    return cache;
  }
}
