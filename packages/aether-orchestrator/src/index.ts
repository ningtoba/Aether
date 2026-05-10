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

export type {
  OrchestrationConfig,
  WorkflowDefinition,
  NodeDefinition,
  NodeDefinition as NodeSpec,
  EdgeDefinition,
  WorkflowState,
  Checkpoint,
  CheckpointManager,
  NodeId,
  NodeKind,
  NodeStatus,
  NodeExecution,
  EdgeKind,
  Condition,
  RetryPolicy,
  NodeErrorPolicy,
} from "./types.js";

export { DEFAULT_ORCHESTRATION_CONFIG } from "./types.js";
