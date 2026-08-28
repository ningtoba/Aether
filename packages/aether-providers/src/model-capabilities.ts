import { Capability, ModelCapabilities } from './types.js';

/**
 * Central registry for model capabilities.
 *
 * Provides known-good capability metadata for popular models across all
 * providers. Allows dynamic registration of custom models. Falls back to
 * reasonable defaults when a model is unknown.
 */
export class ModelCapabilityRegistry {
  /** Known model capabilities keyed by model ID (lowercase) */
  private knownModels = new Map<string, ModelCapabilities>();

  /** Provider-level defaults (applied when model not individually known) */
  private providerDefaults = new Map<string, ModelCapabilities>();

  constructor() {
    this.registerKnownModels();
  }

  // ── Public API ──────────────────────────────────────────────────

  /** Register a single model's capabilities */
  register(model: string, caps: ModelCapabilities): void {
    this.knownModels.set(model.toLowerCase(), caps);
  }

  /** Register a batch of models */
  registerMany(models: Record<string, ModelCapabilities>): void {
    for (const [model, caps] of Object.entries(models)) {
      this.register(model, caps);
    }
  }

  /** Set default capabilities for a provider (applied when model unknown) */
  setProviderDefaults(provider: string, caps: ModelCapabilities): void {
    this.providerDefaults.set(provider.toLowerCase(), caps);
  }

  /** Get capabilities for a model, falling back to provider defaults */
  /** Return a defensive copy so callers cannot mutate stored registry state. */
  private cloneCaps(caps: ModelCapabilities): ModelCapabilities {
    const clone = Object.assign({}, caps, { supported: new Set(caps.supported) });
    return clone;
  }
  get(model: string, provider?: string): ModelCapabilities {
    const key = model.toLowerCase();

    // Exact match
    const exact = this.knownModels.get(key);
    if (exact) return this.cloneCaps(exact);

    // Longest-prefix match — the specific known id wins, so a dated leaf like
    // "gpt-4o-mini-2024-07-18" resolves to "gpt-4o-mini", not the pricier "gpt-4o".
    let best: ModelCapabilities | undefined;
    let bestKey: string | undefined;
    for (const [known, caps] of this.knownModels) {
      if (key.startsWith(known) && (bestKey === undefined || known.length > bestKey.length)) {
        best = caps;
        bestKey = known;
      }
    }
    if (best) return this.cloneCaps(best);

    // Provider default fallback
    if (provider) {
      const fallback = this.providerDefaults.get(provider.toLowerCase());
      if (fallback) return this.cloneCaps(fallback);
    }

    // Sensible default fallback
    return {
      contextWindow: 4096,
      maxOutputTokens: 1024,
      supported: new Set<Capability>([Capability.Enum.chat, Capability.Enum.streaming]),
    };
  }

  /** Check if a model supports a capability */
  hasCapability(model: string, capability: Capability, provider?: string): boolean {
    const caps = this.get(model, provider);
    return caps.supported.has(capability);
  }

  /** List all registered model IDs (filtered by capability, optionally) */
  listModels(capability?: Capability): string[] {
    const results: string[] = [];
    for (const [model, caps] of this.knownModels) {
      if (!capability || caps.supported.has(capability)) {
        results.push(model);
      }
    }
    return results.sort();
  }

  // ── Known model database ────────────────────────────────────────

  private registerKnownModels(): void {
    const cap = (...c: Capability[]) => new Set(c);

    // ── OpenAI ────────────────────────────────────────────────
    const openai: Record<string, ModelCapabilities> = {
      'gpt-4.1': {
        contextWindow: 1_000_000,
        maxOutputTokens: 16_384,
        supported: cap('chat', 'streaming', 'function_calling', 'tool_use', 'json_mode', 'vision'),
        pricing: { input: 2, output: 8 },
      },
      'gpt-4o': {
        contextWindow: 128_000,
        maxOutputTokens: 16_384,
        supported: cap('chat', 'streaming', 'function_calling', 'tool_use', 'json_mode', 'vision'),
        pricing: { input: 2.5, output: 10 },
      },
      'gpt-4o-mini': {
        contextWindow: 128_000,
        maxOutputTokens: 16_384,
        supported: cap('chat', 'streaming', 'function_calling', 'tool_use', 'json_mode', 'vision'),
        pricing: { input: 0.15, output: 0.6 },
      },
      'gpt-4-turbo': {
        contextWindow: 128_000,
        maxOutputTokens: 4_096,
        supported: cap('chat', 'streaming', 'function_calling', 'tool_use', 'json_mode', 'vision'),
        pricing: { input: 10, output: 30 },
      },
      'o3-mini': {
        contextWindow: 200_000,
        maxOutputTokens: 100_000,
        supported: cap('chat', 'streaming', 'function_calling', 'tool_use', 'reasoning'),
        pricing: { input: 1.1, output: 4.4 },
      },
      'o4-mini': {
        contextWindow: 200_000,
        maxOutputTokens: 100_000,
        supported: cap('chat', 'streaming', 'function_calling', 'tool_use', 'reasoning'),
        pricing: { input: 1.1, output: 4.4 },
      },
      'text-embedding-3-small': {
        contextWindow: 8_191,
        maxOutputTokens: 0,
        supported: cap('embeddings'),
        pricing: { input: 0.02, output: 0 },
      },
      'text-embedding-3-large': {
        contextWindow: 8_191,
        maxOutputTokens: 0,
        supported: cap('embeddings'),
        pricing: { input: 0.13, output: 0 },
      },
    };
    this.registerMany(openai);

    // ── Anthropic ─────────────────────────────────────────────
    const anthropic: Record<string, ModelCapabilities> = {
      'claude-sonnet-4': {
        contextWindow: 200_000,
        maxOutputTokens: 8_192,
        supported: cap('chat', 'streaming', 'function_calling', 'tool_use', 'json_mode', 'vision'),
        pricing: { input: 3, output: 15 },
      },
      'claude-haiku-3-5': {
        contextWindow: 200_000,
        maxOutputTokens: 8_192,
        supported: cap('chat', 'streaming', 'function_calling', 'tool_use', 'json_mode', 'vision'),
        pricing: { input: 0.8, output: 4 },
      },
      'claude-opus-4': {
        contextWindow: 200_000,
        maxOutputTokens: 8_192,
        supported: cap(
          'chat',
          'streaming',
          'function_calling',
          'tool_use',
          'json_mode',
          'vision',
          'reasoning',
        ),
        pricing: { input: 15, output: 75 },
      },
    };
    this.registerMany(anthropic);

    // ── Gemini ────────────────────────────────────────────────
    const gemini: Record<string, ModelCapabilities> = {
      'gemini-2.5-pro': {
        contextWindow: 1_000_000,
        maxOutputTokens: 8_192,
        supported: cap(
          'chat',
          'streaming',
          'function_calling',
          'tool_use',
          'json_mode',
          'vision',
          'audio',
        ),
        pricing: { input: 1.25, output: 10 },
      },
      'gemini-2.5-flash': {
        contextWindow: 1_000_000,
        maxOutputTokens: 8_192,
        supported: cap(
          'chat',
          'streaming',
          'function_calling',
          'tool_use',
          'json_mode',
          'vision',
          'audio',
        ),
        pricing: { input: 0.15, output: 0.6 },
      },
      'gemini-2.0-flash': {
        contextWindow: 1_000_000,
        maxOutputTokens: 8_192,
        supported: cap('chat', 'streaming', 'function_calling', 'tool_use', 'json_mode', 'vision'),
        pricing: { input: 0.1, output: 0.4 },
      },
      'text-embedding-004': {
        contextWindow: 2_048,
        maxOutputTokens: 0,
        supported: cap('embeddings'),
        pricing: { input: 0.1, output: 0 },
      },
    };
    this.registerMany(gemini);

    // ── OpenAI ────────────────────────────────────────────────
    this.setProviderDefaults('openai', {
      contextWindow: 128_000,
      maxOutputTokens: 16_384,
      supported: cap('chat', 'streaming', 'function_calling', 'tool_use', 'json_mode', 'vision'),
    });

    // ── Anthropic ─────────────────────────────────────────────
    this.setProviderDefaults('anthropic', {
      contextWindow: 200_000,
      maxOutputTokens: 8_192,
      supported: cap('chat', 'streaming', 'function_calling', 'tool_use', 'json_mode', 'vision'),
    });

    // ── Gemini ────────────────────────────────────────────────
    this.setProviderDefaults('gemini', {
      contextWindow: 1_000_000,
      maxOutputTokens: 8_192,
      supported: cap(
        'chat',
        'streaming',
        'function_calling',
        'tool_use',
        'json_mode',
        'vision',
        'audio',
      ),
    });

    // ── OpenRouter ────────────────────────────────────────────
    // OpenRouter mirrors provider model capabilities; set a generous default.
    this.setProviderDefaults('openrouter', {
      contextWindow: 128_000,
      maxOutputTokens: 16_384,
      supported: cap('chat', 'streaming', 'function_calling', 'tool_use', 'json_mode', 'vision'),
      pricing: { input: 1, output: 5 },
    });

    // ── Local providers ───────────────────────────────────────
    this.setProviderDefaults('ollama', {
      contextWindow: 32_768,
      maxOutputTokens: 4_096,
      supported: cap(
        'chat',
        'streaming',
        'function_calling',
        'tool_use',
        'json_mode',
        'embeddings',
      ),
    });

    this.setProviderDefaults('vllm', {
      contextWindow: 32_768,
      maxOutputTokens: 4_096,
      supported: cap(
        'chat',
        'streaming',
        'function_calling',
        'tool_use',
        'json_mode',
        'embeddings',
      ),
    });

    this.setProviderDefaults('llamacpp', {
      contextWindow: 32_768,
      maxOutputTokens: 4_096,
      supported: cap('chat', 'streaming', 'completion', 'embeddings'),
    });
  }
}
