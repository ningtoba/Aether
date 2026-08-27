/**
 * Re-exported types from @openai/agents-core that the bridge uses.
 *
 * These are re-declared here to avoid a direct dependency on @openai/agents-core
 * (which is a transitive dependency of @openai/agents). Consuming code imports
 * from "@aether/sdk" and gets the same types via the barrel export in index.ts.
 *
 * @module @aether/sdk
 */

// ── Usage ──────────────────────────────────────────────────────────

export { Usage } from '@openai/agents';

// ── Core model types ───────────────────────────────────────────────

export type {
  Model,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ModelSettings,
  ModelRetryAdvice,
  ModelRetryAdviceRequest,
} from '@openai/agents';

// ── Stream events ──────────────────────────────────────────────────

export type {
  StreamEvent,
  StreamEventTextStream,
  StreamEventResponseCompleted,
} from '@openai/agents';

// ── Agent types ────────────────────────────────────────────────────

export type {
  AgentInputItem,
  AgentOutputItem,
  FunctionCallItem,
  FunctionCallResultItem,
  UserMessageItem,
  AssistantMessageItem,
  SystemMessageItem,
} from '@openai/agents';

// ── Runner types ───────────────────────────────────────────────────

export type {
  RunConfig as SdkRunConfig,
  IndividualRunOptions,
  NonStreamRunOptions,
  StreamRunOptions,
  RunResult as SdkRunResult,
  StreamedRunResult,
} from '@openai/agents';

// ── Handoff ────────────────────────────────────────────────────────

export type { Handoff, HandoffInputData } from '@openai/agents';
export { handoff, getHandoff } from '@openai/agents';

// ── Tool types ─────────────────────────────────────────────────────

export type { FunctionTool, Tool, ToolExecuteArgument } from '@openai/agents';
export { tool as sdkTool } from '@openai/agents';

// ── Agent ──────────────────────────────────────────────────────────

export { Agent, Runner } from '@openai/agents';

// ── Tracing ────────────────────────────────────────────────────────

export type { TracingConfig } from '@openai/agents';
export {
  addTraceProcessor,
  setTraceProcessors,
  setTracingDisabled,
  getCurrentSpan,
  getCurrentTrace,
} from '@openai/agents';

// ── Session/Memory ─────────────────────────────────────────────────

export type { Session, SessionInputCallback } from '@openai/agents';
export { MemorySession } from '@openai/agents';
