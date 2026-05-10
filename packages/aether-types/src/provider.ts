// ─── Provider identity ───────────────────────────────────────────

export type ProviderId =
  | "openai"
  | "anthropic"
  | "google"
  | "openrouter"
  | "ollama"
  | "vllm"
  | "llamacpp"
  | "groq"
  | "together"
  | "deepseek"
  | "mistral"
  | "xai"
  | "custom";

/** Well-known provider metadata */
export const WELL_KNOWN_PROVIDERS: Record<ProviderId, WellKnownProvider> = {
  openai: {
    id: "openai",
    name: "OpenAI",
    defaultBaseUrl: "https://api.openai.com/v1",
    authType: "api-key",
    rateLimits: { rpm: 500, tpm: 200_000 },
    models: ["gpt-4o", "gpt-4o-mini", "o3", "o4-mini", "gpt-4.1", "gpt-4.1-mini"],
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    authType: "api-key",
    rateLimits: { rpm: 50, tpm: 40_000 },
    models: ["claude-sonnet-4", "claude-5-haiku"],
  },
  google: {
    id: "google",
    name: "Google AI",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    authType: "api-key",
    rateLimits: { rpm: 60, tpm: 100_000 },
    models: ["gemini-2.5-pro", "gemini-2.0-flash"],
  },
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    authType: "api-key",
    rateLimits: { rpm: 200, tpm: 100_000 },
    models: [],
  },
  ollama: {
    id: "ollama",
    name: "Ollama",
    defaultBaseUrl: "http://localhost:11434/v1",
    authType: "none",
    rateLimits: { rpm: 100, tpm: 200_000 },
    models: [],
  },
  vllm: {
    id: "vllm",
    name: "vLLM",
    defaultBaseUrl: "http://localhost:8000/v1",
    authType: "none",
    rateLimits: { rpm: 100, tpm: 200_000 },
    models: [],
  },
  llamacpp: {
    id: "llamacpp",
    name: "llama.cpp",
    defaultBaseUrl: "http://localhost:8080/v1",
    authType: "none",
    rateLimits: { rpm: 100, tpm: 200_000 },
    models: [],
  },
  groq: {
    id: "groq",
    name: "Groq",
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    authType: "api-key",
    rateLimits: { rpm: 30, tpm: 20_000 },
    models: ["llama-4-scout", "llama-4-maverick", "deepseek-r1-distill-llama-70b"],
  },
  together: {
    id: "together",
    name: "Together AI",
    defaultBaseUrl: "https://api.together.xyz/v1",
    authType: "api-key",
    rateLimits: { rpm: 60, tpm: 100_000 },
    models: [],
  },
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    authType: "api-key",
    rateLimits: { rpm: 100, tpm: 500_000 },
    models: ["deepseek-chat", "deepseek-reasoner"],
  },
  mistral: {
    id: "mistral",
    name: "Mistral AI",
    defaultBaseUrl: "https://api.mistral.ai/v1",
    authType: "api-key",
    rateLimits: { rpm: 50, tpm: 50_000 },
    models: ["mistral-large-2503", "mistral-small-2503"],
  },
  xai: {
    id: "xai",
    name: "xAI",
    defaultBaseUrl: "https://api.x.ai/v1",
    authType: "api-key",
    rateLimits: { rpm: 60, tpm: 100_000 },
    models: ["grok-3", "grok-3-mini"],
  },
  custom: {
    id: "custom",
    name: "Custom Provider",
    defaultBaseUrl: "",
    authType: "api-key",
    rateLimits: { rpm: 100, tpm: 100_000 },
    models: [],
  },
};

export interface RateLimitConfig {
  /** Requests per minute */
  rpm: number;
  /** Tokens per minute */
  tpm: number;
  /** Requests per day (optional) */
  rpd?: number;
  /** Concurrent request limit */
  maxConcurrency?: number;
}

export interface ModelConfig {
  /** Model identifier, e.g. "gpt-4o" */
  id: string;
  /** Display name */
  name?: string;
  /** Provider this model belongs to */
  provider: ProviderId;
  /** Cost per 1M input tokens (USD) */
  inputCostPer1M?: number;
  /** Cost per 1M output tokens (USD) */
  outputCostPer1M?: number;
  /** Max context length in tokens */
  maxContextTokens?: number;
  /** Max output tokens */
  maxOutputTokens?: number;
  /** Whether this model supports streaming */
  supportsStreaming?: boolean;
  /** Whether this model supports structured output (JSON) */
  supportsStructuredOutput?: boolean;
  /** Whether this model supports vision */
  supportsVision?: boolean;
  /** Whether this model supports function/tool calling */
  supportsFunctions?: boolean;
  /** Whether this model is the default for its provider */
  isDefault?: boolean;
  /** Token limits for rate limiting */
  rateLimits?: RateLimitConfig;
}

export interface ProviderSettings {
  /** Unique provider identifier */
  id: ProviderId;
  /** User-friendly label */
  label?: string;
  /** Base URL override (defaults to well-known) */
  baseUrl?: string;
  /** API key (stored encrypted via keytar, never in plaintext here) */
  apiKeyRef?: string;
  /** -- OR -- auth token (for Bearer auth) */
  authTokenRef?: string;
  /** Priority order (lower = higher priority, used for fallback) */
  priority: number;
  /** Whether this provider is enabled */
  enabled: boolean;
  /** Model overrides / additions for this provider */
  models?: ModelConfig[];
  /** Custom rate limits (override well-known defaults) */
  rateLimits?: RateLimitConfig;
  /** Additional HTTP headers to send */
  headers?: Record<string, string>;
  /** Organization ID (for OpenAI org-based billing) */
  organizationId?: string;
  /** Extra provider-specific config (passed to adapter) */
  extra?: Record<string, unknown>;
}

export interface ProviderConfig {
  /** Schema version for migrations */
  version: number;
  /** All configured providers */
  providers: ProviderSettings[];
  /** Default provider used when none is specified */
  defaultProvider: ProviderId;
  /** Provider priority order for fallback (list of IDs) */
  priorityOrder: ProviderId[];
  /** Global model mappings: model name -> provider+model overrides */
  modelMappings?: Record<string, ModelOverride>;
  /** Global rate limit settings */
  globalRateLimits?: {
    /** Max requests per minute across all providers */
    rpm?: number;
    /** Max tokens per minute across all providers */
    tpm?: number;
  };
  /** Endpoint-level configs */
  endpoints?: Record<string, EndpointConfig>;
  /** Default model selection strategy */
  selectionStrategy?: "priority" | "round-robin" | "latency" | "cost";
}

export interface ModelOverride {
  provider: ProviderId;
  modelId: string;
  baseUrl?: string;
  inputCostPer1M?: number;
  outputCostPer1M?: number;
  maxContextTokens?: number;
}

export interface EndpointConfig {
  url: string;
  providerId: ProviderId;
  modelId?: string;
  headers?: Record<string, string>;
  rateLimits?: RateLimitConfig;
}

export interface WellKnownProvider {
  id: ProviderId;
  name: string;
  defaultBaseUrl: string;
  authType: "api-key" | "oauth" | "none";
  rateLimits: RateLimitConfig;
  models: string[];
}

// ─── Token usage / costing ───────────────────────────────────────

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
}

export function estimateCost(usage: TokenUsage, model: ModelConfig): number {
  const input = (usage.inputTokens / 1_000_000) * (model.inputCostPer1M ?? 0);
  const output = (usage.outputTokens / 1_000_000) * (model.outputCostPer1M ?? 0);
  return input + output;
}

// ─── Session / config storage types ──────────────────────────────

export interface StoredSession {
  id: string;
  name: string;
  providerId: ProviderId;
  modelId: string;
  createdAt: number;
  updatedAt: number;
  /** Reference to encrypted API key in vault */
  apiKeyRef?: string;
  metadata?: Record<string, unknown>;
}

export interface ConfigStoreSchema {
  kv: ConfigKV;
  sessions: StoredSession[];
}

export interface ConfigKV {
  /** Current provider config JSON */
  providerConfig: ProviderConfig;
  /** Active session ID */
  activeSessionId?: string;
  /** Last used model per provider */
  lastModels?: Record<string, string>;
}
