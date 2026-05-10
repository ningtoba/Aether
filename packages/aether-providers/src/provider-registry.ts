import { ProviderInterface } from "./provider-interface.js";
import {
  ProviderConfig,
  ProviderName,
} from "./types.js";
import { OpenAICompatibleProvider } from "./providers/openai-compatible.js";
import { AnthropicProvider } from "./providers/anthropic.js";
import { GeminiProvider } from "./providers/gemini.js";
import { OllamaProvider } from "./providers/ollama.js";
import { VLLMProvider } from "./providers/vllm.js";
import { LlamaCppProvider } from "./providers/llamacpp.js";
import { OpenRouterProvider } from "./providers/openrouter.js";
import { ModelCapabilityRegistry } from "./model-capabilities.js";

/**
 * Type for a provider constructor — allows dynamic registration of
 * custom provider types beyond the built-in ones.
 */
export type ProviderConstructor = new (
  config: ProviderConfig,
  registry: ModelCapabilityRegistry,
  ...args: unknown[]
) => ProviderInterface;

export interface RegisteredProvider {
  /** Provider instance (lazily initialized) */
  instance: ProviderInterface | null;
  /** The config used to create this provider */
  config: ProviderConfig;
  /** The provider constructor for lazy instantiation */
  ctor: ProviderConstructor;
  /** Extra constructor args passed through */
  args: unknown[];
}

/**
 * ProviderRegistry
 *
 * Central registry for all AI model providers. Handles:
 * - Dynamic registration of provider types
 * - Factory-style creation from config
 * - Lazy initialization (providers are constructed on first get())
 * - Lifecycle management (initialize/dispose all)
 */
export class ProviderRegistry {
  /** Registered providers keyed by name */
  private providers = new Map<string, RegisteredProvider>();

  /** Built-in provider type → constructor mapping */
  private static readonly BUILTIN_PROVIDERS: Record<
    string,
    ProviderConstructor
  > = {
    openai: OpenAICompatibleProvider,
    openai_compatible: OpenAICompatibleProvider,
    anthropic: AnthropicProvider,
    gemini: GeminiProvider,
    ollama: OllamaProvider,
    vllm: VLLMProvider,
    llamacpp: LlamaCppProvider,
    openrouter: OpenRouterProvider,
  };

  /**
   * User-registered custom providers, merged with built-ins at resolve time.
   * Key is the provider type string (e.g. "custom", "my-provider").
   */
  private static customConstructors = new Map<string, ProviderConstructor>(
    Object.entries(ProviderRegistry.BUILTIN_PROVIDERS),
  );

  constructor(
    protected registry: ModelCapabilityRegistry,
  ) {}

  // ── Static registration (type-level) ──────────────────────────────

  /**
   * Register a custom provider type globally.
   * Use this to add support for proprietary providers at import time.
   */
  static registerProviderType(type: string, ctor: ProviderConstructor): void {
    ProviderRegistry.customConstructors.set(type, ctor);
  }

  /**
   * Unregister a provider type. Returns true if it was removed.
   */
  static unregisterProviderType(type: string): boolean {
    return ProviderRegistry.customConstructors.delete(type);
  }

  /**
   * Check if a provider type is registered.
   */
  static hasProviderType(type: string): boolean {
    return ProviderRegistry.customConstructors.has(type);
  }

  /**
   * Get the constructor for a provider type.
   */
  static getProviderConstructor(type: string): ProviderConstructor | undefined {
    return ProviderRegistry.customConstructors.get(type);
  }

  // ── Instance registration ────────────────────────────────────────

  /**
   * Register a single provider from config.
   * The provider is lazily constructed on first get().
   */
  register(config: ProviderConfig, ...args: unknown[]): this {
    const type = config.provider;
    const ctor =
      ProviderRegistry.customConstructors.get(type) ??
      ProviderRegistry.customConstructors.get("openai_compatible")!;

    this.providers.set(config.name, {
      instance: null,
      config,
      ctor,
      args,
    });
    return this;
  }

  /**
   * Register multiple providers from configs.
   */
  registerMany(configs: ProviderConfig[], ...args: unknown[]): this {
    for (const config of configs) {
      this.register(config, ...args);
    }
    return this;
  }

  /**
   * Create and register a provider with explicit constructor + args.
   * Useful for providers needing extra dependencies.
   */
  registerCustom(
    name: string,
    config: ProviderConfig,
    ctor: ProviderConstructor,
    ...args: unknown[]
  ): this {
    this.providers.set(name, {
      instance: null,
      config,
      ctor,
      args,
    });
    return this;
  }

  /**
   * Remove a registered provider by name.
   * Disposes the instance if it was initialized.
   */
  async deregister(name: string): Promise<boolean> {
    const entry = this.providers.get(name);
    if (!entry) return false;

    if (entry.instance) {
      await entry.instance.dispose();
    }
    this.providers.delete(name);
    return true;
  }

  /**
   * Remove all registered providers.
   */
  async clear(): Promise<void> {
    for (const [name] of this.providers) {
      await this.deregister(name);
    }
  }

  // ── Access ───────────────────────────────────────────────────────

  /**
   * Get a provider instance by name.
   * Lazily constructs and initializes the provider on first access.
   */
  async get(name: string): Promise<ProviderInterface> {
    const entry = this.providers.get(name);
    if (!entry) {
      throw new Error(`Provider "${name}" is not registered`);
    }

    if (!entry.instance) {
      entry.instance = new entry.ctor(entry.config, this.registry, ...entry.args);
      await entry.instance.initialize();
    }

    return entry.instance;
  }

  /**
   * Synchronously check if a provider is registered (without constructing it).
   */
  has(name: string): boolean {
    return this.providers.has(name);
  }

  /**
   * List all registered provider names.
   */
  list(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Get metadata for all registered providers.
   */
  listWithConfig(): { name: string; config: ProviderConfig; initialized: boolean }[] {
    return Array.from(this.providers.entries()).map(([name, entry]) => ({
      name,
      config: entry.config,
      initialized: entry.instance !== null,
    }));
  }

  /**
   * Get the raw ProviderConfig for a registered provider.
   */
  getConfig(name: string): ProviderConfig | undefined {
    return this.providers.get(name)?.config;
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  /**
   * Initialize all registered providers that haven't been initialized yet.
   */
  async initializeAll(): Promise<void> {
    const errors: { name: string; error: Error }[] = [];

    for (const [name] of this.providers) {
      try {
        await this.get(name);
      } catch (err) {
        errors.push({ name, error: err as Error });
      }
    }

    if (errors.length > 0) {
      const messages = errors.map((e) => `${e.name}: ${e.error.message}`).join("; ");
      throw new Error(`Failed to initialize providers: ${messages}`);
    }
  }

  /**
   * Dispose all providers and clean up resources.
   */
  async disposeAll(): Promise<void> {
    for (const [, entry] of this.providers) {
      if (entry.instance) {
        try {
          await entry.instance.dispose();
        } catch {
          // Swallow dispose errors — we're shutting down
        }
      }
    }
    this.providers.clear();
  }

  // ── Factory convenience ──────────────────────────────────────────

  /**
   * Create a provider directly from config without registering it.
   * Useful for one-off provider instances.
   */
  static create(
    config: ProviderConfig,
    registry: ModelCapabilityRegistry,
    ...args: unknown[]
  ): ProviderInterface {
    const type = config.provider;
    const ctor =
      ProviderRegistry.customConstructors.get(type) ??
      ProviderRegistry.customConstructors.get("openai_compatible")!;
    return new ctor(config, registry, ...args);
  }
}
