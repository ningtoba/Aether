/**
 * @aether/types - Provider LLM interaction types (deprecated)
 *
 * Replaced by types/llm.ts. This file kept temporarily for backwards compatibility.
 */
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
} from "./llm.js";

