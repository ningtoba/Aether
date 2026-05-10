/**
 * Core types for the Aether LangGraph orchestration layer.
 *
 * These types represent the workflow graph structure, node definitions,
 * checkpointing, retry policies, and branch conditions that LangGraph
 * operates on.
 *
 * @module @aether/orchestrator
 */

// ─── Graph Node Types ────────────────────────────────────────

/** Unique node identifier within a workflow graph */
export type NodeId = string;

/** The kind of execution a graph node performs */
export type NodeKind =
  | "agent"       // LLM agent execution (wraps AetherAgent)
  | "tool"        // Function tool execution
  | "router"      // Conditional branching (LLM-as-router)
  | "map"         // Parallel fan-out (map-reduce pattern)
  | "reduce"      // Fan-in merge
  | "subgraph"    // Nested sub-workflow
  | "sleep"       // Timer / delay
  | "signal";     // Wait for external signal (webhook, human input)

/** Runtime policy for errors on a node */
export type NodeErrorPolicy = "fail" | "retry" | "skip" | "fallback";

/** Configuration for retrying a node on failure */
export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffFactor: number;      // exponential: delay *= backoffFactor
  retryableErrors: string[];  // error name substrings to retry on
}

/** A single node (step) inside a workflow graph */
export interface NodeDefinition {
  id: NodeId;
  kind: NodeKind;
  label?: string;
  description?: string;

  /** Agent name (when kind === "agent") – references an AetherAgent name */
  agentName?: string;

  /** Tool name (when kind === "tool") – references a registered ToolDefinition name */
  toolName?: string;

  /** Sub-workflow id (when kind === "subgraph") */
  subgraphId?: string;

  /** Input mapping: how to derive this node's input from the workflow state */
  inputMapping?: Record<string, string>;

  /** Output mapping: how to project this node's output back into state */
  outputMapping?: Record<string, string>;

  /** Error handling policy */
  onError?: NodeErrorPolicy;
  retry?: RetryPolicy;
  fallbackOutput?: unknown;

  /** Node-level timeout in ms */
  timeout?: number;

  /** Tags for observability / filtering */
  tags?: string[];
}

// ─── Edge Types ──────────────────────────────────────────────

/** Defines the kind of routing an edge uses */
export type EdgeKind =
  | "direct"        // Always follow, no condition
  | "conditional"   // Follow based on a condition expression
  | "llm-route";    // Let an LLM router decide the next node

/** A condition expression for conditional edges */
export interface Condition {
  /** Field path in state to evaluate (dot notation, e.g. "result.status") */
  field: string;
  /** Operator */
  operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "exists" | "matches";
  /** Value to compare against */
  value: unknown;
}

/** A single edge in the workflow graph */
export interface EdgeDefinition {
  id: string;
  from: NodeId;
  to: NodeId;
  kind: EdgeKind;
  label?: string;

  /** Conditions for conditional edges (ALL must match) */
  conditions?: Condition[];

  /** LLM routing prompt (when kind === "llm-route") */
  routePrompt?: string;

  /** Priority for branch ordering (lower = evaluated first) */
  priority?: number;
}

// ─── Workflow Graph ──────────────────────────────────────────

/** Complete definition of a workflow graph */
export interface WorkflowDefinition {
  id: string;
  name: string;
  description?: string;
  version: string;           // semver

  nodes: NodeDefinition[];
  edges: EdgeDefinition[];

  /** Id of the entry node (workflow execution starts here) */
  entryNode: NodeId;

  /** Ids of terminal nodes (execution ends when any of these is reached) */
  terminalNodes: NodeId[];

  /** Initial state schema field declarations */
  initialState: Record<string, { type: string; required?: boolean; default?: unknown }>;

  /** Tags for discovery / filtering */
  tags?: string[];
}

// ─── Execution State ─────────────────────────────────────────

/** Runtime status of a single node in the current execution */
export type NodeStatus = "pending" | "running" | "completed" | "failed" | "skipped";

/** Snapshot of a node's execution state */
export interface NodeExecution {
  nodeId: NodeId;
  status: NodeStatus;
  startedAt?: number;
  completedAt?: number;
  attempt: number;
  error?: string;
  output?: unknown;
}

/** Full workflow execution state, checkpointed at each step */
export interface WorkflowState {
  /** Unique execution id */
  executionId: string;
  /** The workflow definition id */
  workflowId: string;
  /** Current graph node that is / was executing */
  currentNode: NodeId | null;
  /** History of all nodes (ordered by execution order) */
  nodeHistory: NodeExecution[];
  /** Accumulated state bag (JSON-serialisable) shared across nodes */
  data: Record<string, unknown>;
  /** Status of the overall execution */
  status: "pending" | "running" | "completed" | "failed" | "paused" | "cancelled";
  /** Error message if status === "failed" */
  error?: string;
  /** ISO timestamp when execution started */
  startedAt: string;
  /** ISO timestamp when execution last checkpointed */
  lastCheckpointAt?: string;
  /** Version counter incremented on each state mutation */
  version: number;
}

// ─── Checkpointing ───────────────────────────────────────────

/** A single checkpoint — a frozen snapshot of WorkflowState at a point in time */
export interface Checkpoint {
  id: string;
  executionId: string;
  state: WorkflowState;
  createdAt: string;
  /** Human label for the checkpoint (e.g. "after validation step") */
  label?: string;
}

/** Interface for checkpoint persistence backends */
export interface CheckpointManager {
  save(checkpoint: Checkpoint): Promise<void>;
  get(executionId: string, checkpointId: string): Promise<Checkpoint | undefined>;
  list(executionId: string): Promise<Checkpoint[]>;
  delete(executionId: string, checkpointId: string): Promise<boolean>;
  clearExecution?(executionId: string): void;
  clear?(): void;
  size?: number;
}

// ─── Orchestration Config ────────────────────────────────────

/** Top-level orchestration engine configuration */
export interface OrchestrationConfig {
  /** Default retry policy applied to all nodes unless overridden */
  defaultRetry?: RetryPolicy;
  /** Default node timeout in ms */
  defaultTimeout: number;
  /** Maximum parallel branches for map nodes */
  maxParallelism: number;
  /** Whether to auto-checkpoint after each node execution */
  autoCheckpoint: boolean;
  /** Checkpoint manager implementation */
  checkpointManager?: CheckpointManager;
  /** Maximum execution runtime in ms before forced cancellation */
  maxExecutionTime: number;
  /** Event bus reference (string name for DI) */
  eventBus?: string;
  /** Empty interval for while loops / polling (ms) */
  pollingInterval: number;
}

/** Default configuration values */
export const DEFAULT_ORCHESTRATION_CONFIG: OrchestrationConfig = {
  defaultTimeout: 300_000,          // 5 min
  maxParallelism: 8,
  autoCheckpoint: true,
  maxExecutionTime: 3_600_000,      // 1 hour
  pollingInterval: 500,
};
