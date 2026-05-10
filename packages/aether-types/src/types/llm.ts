/**
 * @aether/types - LLM API interaction types
 *
 * Types for chat completions, embeddings, routing, and provider health checks.
 * These are distinct from the provider configuration types in provider.ts.
 */

// ─── Provider identification ───────────────────────────────

/** Provider identification string (for LLM API layer) */
export type LLMProviderId = string & { readonly __brand: "LLMProviderId" };

/** Supported LLM provider types */
export type ProviderType =
  | "openai-compatible"
  | "anthropic"
  | "gemini"
  | "ollama"
  | "vllm"
  | "llamacpp"
  | "openrouter"
  | "custom";

// ─── API rate limiting ─────────────────────────────────────

/** Rate limiting configuration for API calls */
export interface LLMRateLimitConfig {
  requestsPerMinute: number;
  tokensPerMinute: number;
  concurrentRequests: number;
}

/** Named capabilities a model or provider can support */
export type ModelCapability =
  | "chat"
  | "completion"
  | "embedding"
  | "function-calling"
  | "streaming"
  | "structured-output"
  | "vision"
  | "audio"
  | "rerank";

// ─── Model definitions ─────────────────────────────────────

/** Describes a specific model available through a provider */
export interface ModelInfo {
  id: string;
  name: string;
  provider: LLMProviderId;
  capabilities: ModelCapability[];
  contextWindow: number;
  maxOutputTokens: number;
  pricing?: PricingInfo;
}

/** Per-model pricing information */
export interface PricingInfo {
  inputPerMillionTokens: number;
  outputPerMillionTokens: number;
  currency: string;
}

// ─── Routing ───────────────────────────────────────────────

/** Routing rule that determines which model handles a request */
export interface ProviderRoutingRule {
  id: string;
  name: string;
  priority: number;
  modelId: string;
  condition?: RoutingCondition;
  fallbacks: string[];
}

/** Condition that triggers a routing rule */
export interface RoutingCondition {
  capability?: ModelCapability;
  maxTokens?: number;
  requireStreaming?: boolean;
  providerType?: ProviderType;
}

// ─── Chat completion types ─────────────────────────────────

/** Chat completion request */
export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  tools?: ToolDefinition[];
  toolChoice?: "auto" | "none" | { type: "function"; function: { name: string } };
  stop?: string[];
  frequencyPenalty?: number;
  presencePenalty?: number;
  topP?: number;
}

/** A single message in a chat conversation */
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: ToolCallDefinition[];
}

/** Tool definition for function calling */
export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** A tool call from the model */
export interface ToolCallDefinition {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

/** Streaming chunk from a chat completion */
export interface ChatCompletionChunk {
  id: string;
  choices: {
    delta: { content?: string; toolCalls?: ToolCallDefinition[] };
    finishReason?: string | null;
    index: number;
  }[];
  usage?: LLMTokenUsage;
}

/** Token usage statistics for LLM API calls */
export interface LLMTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

// ─── Embedding types ───────────────────────────────────────

/** Embedding request */
export interface EmbeddingRequest {
  model: string;
  input: string | string[];
}

/** Embedding response */
export interface EmbeddingResponse {
  data: { embedding: number[]; index: number }[];
  usage: LLMTokenUsage;
}

// ─── Provider health ───────────────────────────────────────

/** Provider health check result */
export interface ProviderHealth {
  providerId: LLMProviderId;
  status: "ok" | "degraded" | "down";
  latency: number;
  error?: string;
  modelsAvailable: number;
}

/** Create provider payload */
export interface CreateProviderPayload {
  name: string;
  type: ProviderType;
  apiKey?: string;
  baseUrl: string;
  models?: string[];
  defaultModel?: string;
  priority?: number;
  capabilities?: ModelCapability[];
  customHeaders?: Record<string, string>;
  rateLimit?: LLMRateLimitConfig;
}
