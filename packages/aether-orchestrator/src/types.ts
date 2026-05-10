import type { Metadata } from "@aether/types";

/**
 * Configuration for the orchestration engine.
 */
export interface OrchestrationConfig {
  /** Maximum number of parallel node executions */
  maxParallel: number;
  /** Whether checkpoints are enabled for workflow resumption */
  checkpointEnabled: boolean;
  /** Default timeout per node in milliseconds */
  defaultNodeTimeoutMs: number;
  /** Maximum number of retry attempts for failed nodes */
  maxRetries: number;
  /** Additional metadata attached to the orchestration */
  metadata?: Metadata;
}

/**
 * A complete workflow definition describing a directed graph of nodes and edges.
 */
export interface WorkflowDefinition {
  /** Human-readable workflow name */
  name: string;
  /** Workflow description */
  description: string;
  /** Ordered list of nodes in the workflow */
  nodes: NodeDefinition[];
  /** Ordered list of edges connecting nodes */
  edges: EdgeDefinition[];
  /** ID of the entry-point node */
  entryPoint: string;
  /** ID of the terminal / end node */
  endPoint: string;
  /** JSON Schema-like shape of the shared workflow state */
  stateSchema: Record<string, unknown>;
}

/**
 * A single node within a workflow graph.
 */
export interface NodeDefinition {
  /** Unique node identifier */
  id: string;
  /** Human-readable display name */
  name: string;
  /** Node type categorisation */
  type: "agent" | "tool" | "router" | "transform" | "endpoint";
  /** Arbitrary configuration passed to the node handler */
  config: Record<string, unknown>;
}

/**
 * A directed edge connecting two nodes.
 */
export interface EdgeDefinition {
  /** Source node id */
  source: string;
  /** Target node id */
  target: string;
  /** Optional condition label (for conditional routing) */
  condition?: string;
  /** Optional display label */
  label?: string;
}

/**
 * Runtime workflow execution state passed between nodes.
 */
export interface WorkflowState {
  /** Unique execution / run identifier */
  runId: string;
  /** Current phase of execution */
  status: "idle" | "running" | "paused" | "completed" | "error";
  /** ID of the node currently executing (empty when idle) */
  currentNode: string;
  /** Per-node output data keyed by node id */
  nodeOutputs: Record<string, unknown>;
  /** Shared state accumulated across the workflow */
  sharedState: Record<string, unknown>;
  /** Error message if status is "error" */
  error?: string;
  /** Total steps executed so far */
  stepCount: number;
  /** Unix timestamp (ms) when execution started */
  startTime: number;
  /** ID of the most recent checkpoint, if any */
  checkpointId?: string;
}

/**
 * A checkpoint capturing a snapshot of workflow state for resumption.
 */
export interface Checkpoint {
  /** Unique checkpoint identifier */
  id: string;
  /** Run identifier this checkpoint belongs to */
  runId: string;
  /** Snapshot of the workflow state at checkpoint time */
  state: WorkflowState;
  /** Edges that were pending at the time of checkpoint */
  pendingEdges: EdgeDefinition[];
  /** Unix timestamp (ms) when the checkpoint was created */
  timestamp: number;
  /** Optional metadata */
  metadata: Metadata;
}
