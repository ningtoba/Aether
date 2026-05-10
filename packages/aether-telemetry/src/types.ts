/**
 * Telemetry-specific types for Aether's observability system
 */

import type { Span } from "@opentelemetry/api";
import type { LevelWithSilent } from "pino";

/** Severity levels for telemetry events */
export type TelemetryLevel = "debug" | "info" | "warn" | "error" | "fatal";

/** Maps TelemetryLevel to Pino-compatible numeric level */
export const levelMap: Record<TelemetryLevel, number> = {
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

/** Semantic conventions for Aether span/attribute names */
export const SemanticAttributes = {
  /** Agent/session identifiers */
  AGENT_ID: "aether.agent.id",
  AGENT_NAME: "aether.agent.name",
  SESSION_ID: "aether.session.id",
  EXECUTION_ID: "aether.execution.id",

  /** Step/task tracking */
  STEP_ID: "aether.step.id",
  STEP_TYPE: "aether.step.type",
  STEP_INPUT: "aether.step.input",
  STEP_OUTPUT_HASH: "aether.step.output.hash",
  PARENT_STEP_ID: "aether.step.parent_id",
  TOOL_NAME: "aether.tool.name",
  TOOL_ARGS_HASH: "aether.tool.args.hash",
  TOOL_RESULT: "aether.tool.result",

  /** Provider/model tracking */
  PROVIDER: "aether.provider",
  MODEL: "aether.model",
  MODEL_INPUT_TOKENS: "aether.model.input_tokens",
  MODEL_OUTPUT_TOKENS: "aether.model.output_tokens",
  MODEL_TOTAL_TOKENS: "aether.model.total_tokens",
  MODEL_LATENCY_MS: "aether.model.latency_ms",

  /** Error context */
  ERROR_TYPE: "aether.error.type",
  ERROR_MESSAGE: "aether.error.message",
  ERROR_CODE: "aether.error.code",

  /** Performance */
  DURATION_MS: "aether.duration_ms",
  MEMORY_USAGE_MB: "aether.memory.mb",
  CPU_USAGE_PERCENT: "aether.cpu.percent",
} as const;

/** Semantic span names for Aether */
export const SemanticSpanNames = {
  /** Agent lifecycle */
  AGENT_INIT: "aether.agent.init",
  AGENT_RUN: "aether.agent.run",
  AGENT_STEP: "aether.agent.step",
  AGENT_COMPLETE: "aether.agent.complete",

  /** Tool execution */
  TOOL_EXECUTE: "aether.tool.execute",
  TOOL_LLM_CALL: "aether.tool.llm_call",

  /** Provider */
  PROVIDER_REQUEST: "aether.provider.request",
  PROVIDER_RESPONSE: "aether.provider.response",

  /** Memory operations */
  MEMORY_READ: "aether.memory.read",
  MEMORY_WRITE: "aether.memory.write",
  MEMORY_SEARCH: "aether.memory.search",
  MEMORY_DELETE: "aether.memory.delete",

  /** Orchestration */
  ORCHESTRATOR_PLAN: "aether.orchestrator.plan",
  ORCHESTRATOR_EXECUTE: "aether.orchestrator.execute",
  ORCHESTRATOR_DELEGATE: "aether.orchestrator.delegate",

  /** System */
  SYSTEM_STARTUP: "aether.system.startup",
  SYSTEM_SHUTDOWN: "aether.system.shutdown",
  SYSTEM_HEARTBEAT: "aether.system.heartbeat",
} as const;

/** A serializable execution trace for replay/analysis */
export interface ExecutionTrace {
  /** Unique trace ID */
  traceId: string;
  /** Session/execution identifier */
  executionId: string;
  /** Agent identifier */
  agentId: string;
  /** ISO timestamp of trace start */
  startTime: string;
  /** ISO timestamp of trace end */
  endTime?: string;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Status of the execution */
  status: "running" | "completed" | "failed" | "cancelled";
  /** Error information if failed */
  error?: {
    type: string;
    message: string;
    code?: string;
  };
  /** Nested steps within this execution */
  steps: ExecutionStep[];
  /** Custom attributes */
  attributes?: Record<string, unknown>;
}

/** A single step within an execution trace */
export interface ExecutionStep {
  /** Unique step ID */
  stepId: string;
  /** ID of parent step, if nested */
  parentStepId?: string;
  /** Type of step (e.g., "tool_call", "llm_request", "agent_think") */
  stepType: string;
  /** ISO timestamp */
  startTime: string;
  /** ISO timestamp */
  endTime?: string;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Step status */
  status: "running" | "completed" | "failed" | "skipped";
  /** Input to this step */
  input?: unknown;
  /** Output/results from this step */
  output?: unknown;
  /** Error if step failed */
  error?: {
    type: string;
    message: string;
  };
}

/** Configuration for the telemetry system */
export interface TelemetryConfig {
  /** Service name for resource attribution */
  serviceName: string;
  /** Service version */
  serviceVersion?: string;
  /** Environment (e.g., "development", "production") */
  environment?: string;
  /** OTLP exporter endpoint */
  otlpEndpoint?: string;
  /** Enable console exporter (default: true in dev) */
  consoleExporter?: boolean;
  /** Enable file exporter */
  fileExporter?: {
    path: string;
    maxSizeMb?: number;
  };
  /** Sampling rate for traces (0.0 - 1.0) */
  samplingRate?: number;
  /** Default log level */
  logLevel?: TelemetryLevel;
  /** Pretty-print logs in console */
  prettyPrint?: boolean;
}

/** Span context for injection into logs */
export interface SpanLogContext {
  traceId: string;
  spanId: string;
  traceFlags: number;
}

/** Global telemetry instance handle */
export interface TelemetryHandle {
  shutdown: () => Promise<void>;
  flush: () => Promise<void>;
}

// ─── Metrics Types ─────────────────────────────────────────────────────

/** Key-value attributes for labeling metrics */
export type TelemetryAttributes = Record<string, string | number | boolean>;

/** Supported metric types */
export type MetricType = 'counter' | 'gauge' | 'histogram';

/** Metric definition metadata */
export interface MetricDef {
  name: string;
  type: MetricType;
  description: string;
  unit?: string;
}

/** A single data point recording of a metric */
export interface MetricPoint {
  name: string;
  type: MetricType;
  value: number;
  labels: TelemetryAttributes;
  timestamp: number;
}

/** Replay-specific types for replaying execution traces */
export type ReplayEventType =
  | "agent_init"
  | "agent_step_start"
  | "agent_step_end"
  | "tool_call_start"
  | "tool_call_end"
  | "llm_request_start"
  | "llm_request_end"
  | "memory_access"
  | "agent_complete"
  | "error";

export interface ReplayEvent {
  timestamp: string;
  type: ReplayEventType;
  data: Record<string, unknown>;
}

export interface ReplaySession {
  metadata: {
    sessionId: string;
    agentId: string;
    startedAt: string;
    completedAt?: string;
  };
  events: ReplayEvent[];
}
