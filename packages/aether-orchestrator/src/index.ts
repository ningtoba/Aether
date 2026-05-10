/**
 * @aether/orchestrator — LangGraph orchestration engine wrapper.
 *
 * Provides tools for defining hierarchical multi-agent workflows,
 * executing them via an internal state machine, checkpointing for
 * pause/resume, and constructing workflow graphs fluently.
 *
 * @module @aether/orchestrator
 */

export { OrchestrationEngine } from "./engine.js";
export { WorkflowBuilder } from "./workflow.js";
export { InMemoryCheckpointManager } from "./checkpoint.js";
export type { CheckpointManager } from "./checkpoint.js";

export type {
  OrchestrationConfig,
  WorkflowDefinition,
  NodeDefinition,
  EdgeDefinition,
  WorkflowState,
  Checkpoint,
} from "./types.js";
