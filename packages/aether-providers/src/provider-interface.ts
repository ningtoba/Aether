import {
  CompletionRequest,
  CompletionResponse,
  EmbeddingRequest,
  EmbeddingResponse,
  ProviderConfig,
  ModelCapabilities,
  Capability,
  StreamEvent,
} from './types.js';

/**
 * Abstract provider interface that all AI model providers must implement.
 *
 * Every provider is an OpenAI-compatible base — differences (Anthropic's
 * message format, Gemini's safety settings, etc.) are normalized inside
 * each implementation so consumers get a uniform interface.
 */
export abstract class ProviderInterface {
  /** Human-readable provider name (e.g. "OpenAI", "Ollama local") */
  public readonly name: string;
  /** Provider type identifier */
  public readonly type: string;
  /** Configuration this provider was initialized with */
  protected config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.name = config.name;
    this.type = config.provider;
    this.config = config;
  }

  // ── Core API ──────────────────────────────────────────────────

  /** Send a chat completion request (blocking) */
  abstract complete(request: CompletionRequest): Promise<CompletionResponse>;

  /** Send a chat completion request (streaming) */
  abstract completeStream(request: CompletionRequest): AsyncIterableIterator<StreamEvent>;

  /** Generate embeddings */
  abstract embed(request: EmbeddingRequest): Promise<EmbeddingResponse>;

  // ── Model introspection ───────────────────────────────────────

  /** List models this provider has access to */
  abstract listModels(): Promise<string[]>;

  /** Get capabilities for a specific model */
  abstract getModelCapabilities(model: string): Promise<ModelCapabilities>;

  /** Check if a specific model supports a given capability */
  async supportsCapability(model: string, capability: Capability): Promise<boolean> {
    const caps = await this.getModelCapabilities(model);
    return caps.supported.has(capability);
  }

  // ── Lifecycle ─────────────────────────────────────────────────

  /** Called once after construction. Use for connection checks, API validation, etc. */
  async initialize(): Promise<void> {
    // Default: no-op. Subclasses override for auth validation.
  }

  /** Clean up resources (close connections, abort pending requests) */
  async dispose(): Promise<void> {
    // Default: no-op.
  }

  // ── Helpers ───────────────────────────────────────────────────

  /** Build the base URL from config, resolving relative paths */
  protected resolveUrl(path: string): string {
    const base = this.config.baseUrl ?? 'https://api.openai.com/v1';
    return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
  }

  /** Build common fetch headers */
  protected buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }
    return headers;
  }

  /** Apply rate limiting delay if configured */
  protected async applyRateLimit(): Promise<void> {
    if (!this.config.rateLimit) return;
    // Default implementation: no-op. Providers override with actual rate-limiting logic.
  }

  /** Retry wrapper with exponential backoff */
  protected async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    const maxRetries = this.config.maxRetries ?? 0;
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        if (attempt < maxRetries) {
          const delay = Math.min(1000 * 2 ** attempt, 10_000);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }
    throw lastError;
  }
}
