/**
 * Abstract provider interface for LLM providers
 */
export const VERSION = "0.1.0";

export { ProviderInterface } from "./provider-interface.js";
export type {
  CompletionRequest,
  CompletionResponse,
  Message,
  ToolDefinition,
  ToolCall,
  StreamEvent,
  TokenUsage,
  MessageRole,
  ContentBlock,
  TextBlock,
  ImageUrlBlock,
  ToolUseBlock,
  ToolResultBlock,
  Content,
  ProviderErrorCode,
  ProviderError,
  ProviderConfig,
  ModelCapabilities,
  Capability,
  ProviderName,
  EmbeddingRequest,
  EmbeddingResponse,
  FallbackConfig,
  RouteRule,
} from "./types.js";
