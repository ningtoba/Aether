/** Execution identification */
export type ExecutionId = string & { readonly __brand: "ExecutionId" };

/** An execution plan consisting of ordered steps */
export interface ExecutionPlan {
  id: ExecutionId;
  goal: string;
  steps: ExecutionStep[];
  priority: number;
  maxRuntime: number;
  createdAt: number;
}

/** A single step within an execution plan */
export interface ExecutionStep {
  id: string;
  description: string;
  agentId?: string;
  toolId?: string;
  dependsOn: string[];
  timeout: number;
  retryPolicy?: import("./graph").RetryPolicy;
}

/** Overall execution result */
export interface ExecutionResult {
  id: ExecutionId;
  status: "idle" | "running" | "completed" | "failed" | "cancelled";
  steps: StepResult[];
  summary?: string;
  error?: string;
  totalTokens: number;
  duration: number;
}

/** Result of a single step within an execution */
export interface StepResult {
  id: string;
  status: "pending" | "running" | "completed" | "failed";
  output?: string;
  error?: string;
  duration: number;
  tokenCount: number;
}

/** Queued execution item */
export interface ExecutionQueueItem {
  id: ExecutionId;
  plan: ExecutionPlan;
  enqueuedAt: number;
  startedAt?: number;
  status: "queued" | "running" | "completed" | "failed";
  priority: number;
}

/** Execution configuration options */
export interface ExecutionConfig {
  maxConcurrent: number;
  defaultTimeout: number;
  maxRetries: number;
  checkpointInterval: number;
  enableParallelSteps: boolean;
  resourceLimits: {
    maxMemory: number;
    maxCpu: number;
    maxDisk: number;
  };
}
