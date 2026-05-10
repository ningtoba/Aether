/** Graph identification */
export type GraphId = string & { readonly __brand: "GraphId" };

/** A node in an orchestration graph */
export interface GraphNode {
  id: string;
  name: string;
  type: "agent" | "tool" | "router" | "transform" | "endpoint";
  config: Record<string, unknown>;
}

/** A directed edge between two graph nodes */
export interface GraphEdge {
  source: string;
  target: string;
  condition?: string;
  label?: string;
}

/** Complete graph definition for LangGraph orchestration */
export interface GraphDefinition {
  id: GraphId;
  name: string;
  description: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  entryPoint: string;
  endPoint: string;
  stateSchema: Record<string, unknown>;
  checkpointEnabled: boolean;
  maxParallel: number;
  retryPolicy?: RetryPolicy;
}

/** Retry policy for failed graph nodes */
export interface RetryPolicy {
  maxAttempts: number;
  backoff: "fixed" | "exponential" | "linear";
  initialDelay: number;
  maxDelay: number;
  retryableErrors: string[];
}

/** Runtime state of graph execution */
export interface GraphExecutionState {
  graphId: GraphId;
  status: "idle" | "running" | "error" | "completed" | "paused";
  currentNode: string;
  nodeStates: Record<string, unknown>;
  error?: string;
  stepCount: number;
  startTime: number;
  checkpoint?: string;
}

/** Graph checkpoint for resumability */
export interface GraphCheckpoint {
  id: string;
  graphId: GraphId;
  state: Record<string, unknown>;
  currentNode: string;
  pendingEdges: GraphEdge[];
  timestamp: number;
  metadata: Record<string, unknown>;
}

/** Node execution result */
export interface NodeResult {
  nodeId: string;
  status: "success" | "error" | "skipped";
  output: Record<string, unknown>;
  error?: string;
  duration: number;
  retryAttempt: number;
}
