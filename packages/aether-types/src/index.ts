/**
 * @aether/types — barrel export
 *
 * All public types are re-exported from this file.
 * Import from "@aether/types" to access any of these types.
 */

// ─── Provider configuration & storage types ────────────────
export type {
  ProviderId,
  WellKnownProvider,
  RateLimitConfig,
  ModelConfig,
  ProviderSettings,
  ProviderConfig,
  ModelOverride,
  EndpointConfig,
  TokenUsage,
  StoredSession,
  ConfigStoreSchema,
  ConfigKV,
} from "./provider.js";
export { WELL_KNOWN_PROVIDERS, estimateCost } from "./provider.js";
export const VERSION = "0.1.0";

// ─── LLM API interaction types (chat, embedding, routing) ──
// Re-exported via the deprecated types/provider.ts shim
export type {
  LLMProviderId,
  ProviderType,
  LLMRateLimitConfig,
  ModelCapability,
  ModelInfo,
  PricingInfo,
  ProviderRoutingRule,
  RoutingCondition,
  ChatCompletionRequest,
  ChatMessage,
  ToolDefinition,
  ToolCallDefinition,
  ChatCompletionChunk,
  LLMTokenUsage,
  EmbeddingRequest,
  EmbeddingResponse,
  ProviderHealth,
  CreateProviderPayload,
} from "./types/llm.js";

// ─── Sandbox / execution environment types ─────────────────
export type {
  SandboxLimits,
  SandboxProfile,
} from "./sandbox.js";
export {
  DEFAULT_LIMITS,
  SANDBOX_PROFILES,
} from "./sandbox.js";

// ─── Execution result types ────────────────────────────────
export type {
  ExecResult,
  SandboxFile,
  BaseExecOptions,
  EnvStatus,
} from "./execution.js";

// ─── Base / foundational types ─────────────────────────────
export type {
  UUID,
  SemVer,
  Timestamp,
  JSONValue,
  JSONObject,
  Metadata,
  UsageMetrics,
  LogEntry,
  ErrorDetails,
  PaginationParams,
  PaginatedResult,
} from "./types/base.js";
export {
  LogLevel,
  Status,
  ErrorCategory,
} from "./types/base.js";

// ─── Agent types ───────────────────────────────────────────
export type {
  AgentId,
  AgentStatus,
  AgentConfig,
  AgentExecutionState,
  AgentRole,
  AgentRegistration,
} from "./types/agent.js";

// ─── Execution plan types ──────────────────────────────────
export type {
  ExecutionId,
  ExecutionPlan,
  ExecutionStep,
  ExecutionResult,
  StepResult,
  ExecutionQueueItem,
  ExecutionConfig,
} from "./types/execution.js";

// ─── Graph / orchestration types ───────────────────────────
export type {
  GraphId,
  GraphNode,
  GraphEdge,
  GraphDefinition,
  RetryPolicy,
  GraphExecutionState,
  GraphCheckpoint,
  NodeResult,
} from "./types/graph.js";

// ─── Memory / vector store types ───────────────────────────
export type {
  MemoryId,
  MemoryType,
  MemoryEntry,
  MemoryQuery,
  MemorySearchResult,
  VectorStoreConfig,
  MemoryStats,
  ChunkingConfig,
  SummarizationRequest,
  RAGConfig,
  EmbeddingConfig,
} from "./types/memory.js";

// ─── Settings types ────────────────────────────────────────
export type {
  AppSettings,
  GUISettings,
  AllSettings,
} from "./types/settings.js";

// ─── Tool / MCP types ──────────────────────────────────────
export type {
  ToolId,
  ToolType,
  ToolDefinition as ToolDefinitionConfig,
  ToolCall,
  ToolResult,
  ToolParameter,
  ToolExecutionContext,
  ToolPermission,
  MCPServerConfig,
} from "./types/tool.js";
