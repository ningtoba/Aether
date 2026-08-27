import { z } from 'zod';

// ── Provider identifiers ──────────────────────────────────────────

export const ProviderName = z.enum([
  'openai',
  'anthropic',
  'gemini',
  'ollama',
  'vllm',
  'llamacpp',
  'openrouter',
  'custom',
]);
export type ProviderName = z.infer<typeof ProviderName>;

// ── Model capabilities ────────────────────────────────────────────

export const Capability = z.enum([
  'chat',
  'completion',
  'embeddings',
  'function_calling',
  'streaming',
  'vision',
  'audio',
  'tool_use',
  'json_mode',
  'reasoning',
]);
export type Capability = z.infer<typeof Capability>;

export interface ModelCapabilities {
  /** Maximum context window in tokens */
  contextWindow: number;
  /** Maximum output tokens supported */
  maxOutputTokens: number;
  /** Which capabilities this model supports */
  supported: Set<Capability>;
  /** Optional per-model pricing info (per 1K tokens) */
  pricing?: {
    input: number;
    output: number;
  };
}

// ── Message types ─────────────────────────────────────────────────

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ContentBlock {
  type: 'text' | 'image_url' | 'tool_use' | 'tool_result';
}

export interface TextBlock extends ContentBlock {
  type: 'text';
  text: string;
}

export interface ImageUrlBlock extends ContentBlock {
  type: 'image_url';
  imageUrl: string;
  detail?: 'low' | 'high' | 'auto';
}

export interface ToolUseBlock extends ContentBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock extends ContentBlock {
  type: 'tool_result';
  toolUseId: string;
  content: string;
}

export type Content = string | (TextBlock | ImageUrlBlock | ToolUseBlock | ToolResultBlock)[];

export interface Message {
  role: MessageRole;
  content: Content;
  name?: string;
  /** Assistant tool calls (OpenAI-compatible tool_calls / Anthropic tool_use / Gemini functionCall). */
  toolCalls?: ToolCall[];
  /** For role 'tool' messages: the id of the tool call this result answers. */
  toolCallId?: string;
}

// ── Tool definitions ──────────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// ── Request / Response ────────────────────────────────────────────

export interface CompletionRequest {
  model: string;
  messages: Message[];
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stop?: string[];
  stream?: boolean;
  tools?: ToolDefinition[];
  toolChoice?:
    | 'auto'
    | 'any'
    | 'required'
    | 'none'
    | { type: 'function'; function: { name: string } };
  jsonMode?: boolean;
  reasoningEffort?: 'low' | 'medium' | 'high';
  /** Provider-specific options passed through */
  extra?: Record<string, unknown>;
}

export interface CompletionResponse {
  id: string;
  model: string;
  content: string | null;
  toolCalls?: ToolCall[];
  usage: TokenUsage;
  finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error';
  /** Raw provider response for debugging */
  raw?: unknown;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

// ── Streaming ─────────────────────────────────────────────────────

export type StreamEvent =
  | { type: 'delta'; content: string }
  | { type: 'tool_call_delta'; id: string; name: string; input: string }
  | { type: 'done'; response: CompletionResponse }
  | { type: 'error'; error: ProviderError };

// ── Embeddings ────────────────────────────────────────────────────

export interface EmbeddingRequest {
  model: string;
  input: string | string[];
}

export interface EmbeddingResponse {
  model: string;
  embeddings: number[][];
  usage: TokenUsage;
}

// ── Errors ────────────────────────────────────────────────────────

export enum ProviderErrorCode {
  Authentication = 'authentication',
  RateLimited = 'rate_limited',
  QuotaExceeded = 'quota_exceeded',
  ContextTooLong = 'context_too_long',
  ModelNotFound = 'model_not_found',
  ModelUnavailable = 'model_unavailable',
  BadRequest = 'bad_request',
  Timeout = 'timeout',
  Internal = 'internal',
  Network = 'network',
}

export class ProviderError extends Error {
  constructor(
    public readonly code: ProviderErrorCode,
    message: string,
    public readonly statusCode?: number,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

// ── Provider configuration ────────────────────────────────────────

export interface ProviderConfig {
  name: string;
  provider: ProviderName;
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
  models: string[];
  rateLimit?: {
    requestsPerMinute: number;
    tokensPerMinute: number;
  };
  timeout?: number; // ms
  maxRetries?: number;
  extra?: Record<string, unknown>;
}

// ── Fallback & routing ────────────────────────────────────────────

export interface FallbackConfig {
  providers: string[]; // ordered list of provider names to try
  strategy: 'sequential' | 'race';
}

export interface RouteRule {
  /** Pattern to match model name (glob-like: supports * wildcard) */
  modelPattern: string;
  /** Provider name(s) to route to */
  provider: string | string[];
  /** Minimum capabilities this route must satisfy */
  requires?: Capability[];
  /** Priority: higher wins when multiple rules match */
  priority?: number;
}
