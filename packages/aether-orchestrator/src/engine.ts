import type {
  OrchestrationConfig,
  WorkflowDefinition,
  WorkflowState,
} from "./types.js";
import type { CheckpointManager } from "./checkpoint.js";
import { InMemoryCheckpointManager } from "./checkpoint.js";

/**
 * OrchestrationEngine manages the lifecycle of hierarchical multi-agent
 * workflows. It wraps LangGraph concepts in an abstraction layer that
 * uses an internal state machine to drive graph execution, checkpointing,
 * and pause / resume semantics.
 */
export class OrchestrationEngine {
  private workflows: Map<string, WorkflowDefinition> = new Map();
  private activeRuns: Map<string, WorkflowState> = new Map();
  private checkpointManager: CheckpointManager;
  private config: OrchestrationConfig;

  constructor(
    config?: Partial<OrchestrationConfig>,
    checkpointManager?: CheckpointManager,
  ) {
    this.config = {
      maxParallel: 1,
      checkpointEnabled: true,
      defaultNodeTimeoutMs: 30_000,
      maxRetries: 2,
      ...config,
    };
    this.checkpointManager = checkpointManager ?? new InMemoryCheckpointManager();
  }

  /**
   * Register a graph (WorkflowDefinition) that can be executed later.
   */
  createGraph(id: string, definition: WorkflowDefinition): void {
    if (this.workflows.has(id)) {
      throw new Error(`Graph "${id}" already registered`);
    }
    this.workflows.set(id, definition);
  }

  /**
   * Execute a registered graph end-to-end.
   *
   * Walks the node chain from entryPoint to endPoint, feeding previous
   * node output to the next node's shared state.
   *
   * @param graphId - ID of the registered graph
   * @param initialState - Optional initial shared state values
   * @returns Final WorkflowState after execution completes
   */
  async runWorkflow(
    graphId: string,
    initialState?: Record<string, unknown>,
  ): Promise<WorkflowState> {
    const def = this.workflows.get(graphId);
    if (!def) throw new Error(`Graph "${graphId}" not found`);

    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const state: WorkflowState = {
      runId,
      status: "running",
      currentNode: def.entryPoint,
      nodeOutputs: {},
      sharedState: { ...initialState },
      stepCount: 0,
      startTime: Date.now(),
    };

    this.activeRuns.set(runId, state);

    try {
      // Build adjacency map for fast lookups
      const adjacency = new Map<string, string[]>();
      for (const edge of def.edges) {
        const targets = adjacency.get(edge.source) ?? [];
        targets.push(edge.target);
        adjacency.set(edge.source, targets);
      }

      let currentId: string | undefined = def.entryPoint;

      while (currentId && currentId !== def.endPoint) {
        state.currentNode = currentId;

        // Find the node definition
        const nodeDef = def.nodes.find((n) => n.id === currentId);
        if (!nodeDef) {
          throw new Error(`Node "${currentId}" not found in graph definition`);
        }

        // Simulate execution — collect output into nodeOutputs
        state.nodeOutputs[currentId] = await this.executeNode(nodeDef, state);
        state.stepCount++;

        // Checkpoint after each node step
        if (this.config.checkpointEnabled) {
          const pendingEdges = def.edges.filter((e) => e.source === currentId);
          await this.checkpointManager.save(state, pendingEdges);
        }

        // Determine next node via adjacency
        const nextTargets = adjacency.get(currentId);
        if (!nextTargets || nextTargets.length === 0) {
          break;
        }

        // Simple linear progression — use first edge
        currentId = nextTargets[0];
      }

      // Merge outputs into shared state
      state.sharedState = { ...state.sharedState, ...state.nodeOutputs };
      state.status = "completed";
      state.currentNode = def.endPoint;
    } catch (err) {
      state.status = "error";
      state.error = err instanceof Error ? err.message : String(err);
    }

    this.activeRuns.set(runId, state);
    return state;
  }

  /**
   * Pause an actively running workflow.
   *
   * A checkpoint is created so execution can be resumed later via
   * `resumeWorkflow`.
   */
  async pauseWorkflow(runId: string): Promise<WorkflowState> {
    const state = this.activeRuns.get(runId);
    if (!state) throw new Error(`No active run with id "${runId}"`);
    if (state.status !== "running") {
      throw new Error(`Run "${runId}" is not in "running" state`);
    }

    state.status = "paused";
    if (this.config.checkpointEnabled) {
      await this.checkpointManager.save(state, []);
    }
    return state;
  }

  /**
   * Resume a previously paused workflow.
   */
  async resumeWorkflow(runId: string): Promise<WorkflowState> {
    const state = this.activeRuns.get(runId);
    if (!state) throw new Error(`No active run with id "${runId}"`);
    if (state.status !== "paused") {
      throw new Error(`Run "${runId}" is not in "paused" state`);
    }

    state.status = "running";
    // In a real implementation this would re-enter the execution loop.
    // For the abstraction layer we simply return the state.
    return state;
  }

  /**
   * Get the current state of a workflow run.
   */
  getState(runId: string): WorkflowState | undefined {
    return this.activeRuns.get(runId);
  }

  /**
   * Retrieve checkpoint history for a run.
   */
  async getHistory(runId: string) {
    return this.checkpointManager.list(runId);
  }

  /**
   * Simulate node execution by returning the current shared state.
   *
   * In production this would invoke an agent, tool, or transform handler
   * via the LangGraph runtime.
   */
  private async executeNode(
    _nodeDef: WorkflowDefinition["nodes"][number],
    state: WorkflowState,
  ): Promise<Record<string, unknown>> {
    // Simulate a short async execution delay
    await new Promise((r) => setTimeout(r, 5));
    // Return a snapshot of the current shared state as "node output"
    return { ...state.sharedState };
  }
}
