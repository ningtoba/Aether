import type {
  OrchestrationConfig,
  WorkflowDefinition,
  WorkflowState,
  CheckpointManager,
} from "./types.js";
import { InMemoryCheckpointManager } from "./checkpoint.js";
import { DEFAULT_ORCHESTRATION_CONFIG } from "./types.js";

export class OrchestrationEngine {
  private workflows: Map<string, WorkflowDefinition> = new Map();
  private activeRuns: Map<string, WorkflowState> = new Map();
  private checkpointManager: CheckpointManager;
  private config: OrchestrationConfig;

  constructor(
    config?: Partial<OrchestrationConfig>,
    checkpointManager?: CheckpointManager,
  ) {
    this.config = { ...DEFAULT_ORCHESTRATION_CONFIG, ...config };
    this.checkpointManager = checkpointManager ?? new InMemoryCheckpointManager();
  }

  createGraph(id: string, definition: WorkflowDefinition): void {
    if (this.workflows.has(id)) throw new Error(`Graph "${id}" already registered`);
    this.workflows.set(id, definition);
  }

  async runWorkflow(
    graphId: string,
    initialState?: Record<string, unknown>,
  ): Promise<WorkflowState> {
    const def = this.workflows.get(graphId);
    if (!def) throw new Error(`Graph "${graphId}" not found`);

    const executionId = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const state: WorkflowState = {
      executionId,
      workflowId: def.id,
      status: "running",
      currentNode: def.entryNode,
      nodeHistory: [],
      data: { ...initialState },
      startedAt: new Date().toISOString(),
      version: 1,
    };

    this.activeRuns.set(executionId, state);

    try {
      const adjacency = new Map<string, string[]>();
      for (const edge of def.edges) {
        const targets = adjacency.get(edge.from) ?? [];
        targets.push(edge.to);
        adjacency.set(edge.from, targets);
      }

      let currentId: string | undefined = def.entryNode;
      const terminalSet = new Set(def.terminalNodes);

      while (currentId && !terminalSet.has(currentId)) {
        state.currentNode = currentId;

        const nodeDef = def.nodes.find((n) => n.id === currentId);
        if (!nodeDef) throw new Error(`Node "${currentId}" not found`);

        const output = await this.executeNode(nodeDef, state);
        state.nodeHistory.push({
          nodeId: currentId,
          status: "completed",
          attempt: 1,
          completedAt: Date.now(),
          output,
        });
        state.version++;

        if (this.config.autoCheckpoint) {
          await this.checkpointManager.save({
            id: `cp-${executionId}-${state.version}`,
            executionId,
            state: structuredClone(state),
            createdAt: new Date().toISOString(),
          });
        }

        const nextTargets = adjacency.get(currentId);
        if (!nextTargets || nextTargets.length === 0) break;
        currentId = nextTargets[0];
      }

      state.status = "completed";
      state.currentNode = null;
    } catch (err) {
      state.status = "failed";
      state.error = err instanceof Error ? err.message : String(err);
    }

    this.activeRuns.set(executionId, state);
    return state;
  }

  async pauseWorkflow(executionId: string): Promise<WorkflowState> {
    const state = this.activeRuns.get(executionId);
    if (!state) throw new Error(`No execution "${executionId}"`);
    if (state.status !== "running") throw new Error(`Execution "${executionId}" not running`);

    state.status = "paused";
    if (this.config.autoCheckpoint) {
      await this.checkpointManager.save({
        id: `cp-${executionId}-paused`,
        executionId,
        state: structuredClone(state),
        createdAt: new Date().toISOString(),
        label: "paused",
      });
    }
    return state;
  }

  async resumeWorkflow(executionId: string): Promise<WorkflowState> {
    const state = this.activeRuns.get(executionId);
    if (!state) throw new Error(`No execution "${executionId}"`);
    if (state.status !== "paused") throw new Error(`Execution "${executionId}" not paused`);
    state.status = "running";
    return state;
  }

  getState(executionId: string): WorkflowState | undefined {
    return this.activeRuns.get(executionId);
  }

  async getHistory(executionId: string): Promise<import("./types.js").Checkpoint[]> {
    return this.checkpointManager.list(executionId);
  }

  private async executeNode(
    _nodeDef: WorkflowDefinition["nodes"][number],
    state: WorkflowState,
  ): Promise<Record<string, unknown>> {
    await new Promise((r) => setTimeout(r, 5));
    return { ...state.data };
  }
}
