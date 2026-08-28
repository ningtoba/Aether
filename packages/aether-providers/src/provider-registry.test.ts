import { describe, it, expect, vi } from 'vitest';
import { ProviderRegistry } from './provider-registry.js';
import type { ProviderInterface } from './provider-interface.js';
import type { ProviderConfig } from './types.js';
import { ModelCapabilityRegistry } from './model-capabilities.js';

function makeConfig(name: string): ProviderConfig {
  return {
    name,
    provider: 'openai',
    apiKey: 'test',
    baseUrl: 'http://localhost:9/v1',
    models: [],
  };
}

function stubProvider(overrides: Partial<ProviderInterface> = {}): ProviderInterface {
  return {
    async complete() {
      return {
        id: 'x',
        model: 'm',
        choices: [],
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    },
    async *completeStream() {},
    async embed() {
      return { embeddings: [], usage: { promptTokens: 0, totalTokens: 0 } };
    },
    async initialize() {},
    async dispose() {},
    getConfig() {
      return makeConfig('x');
    },
    getCapabilities() {
      return {
        supportsStreaming: true,
        supportsEmbeddings: false,
        supportsTools: false,
        maxContextTokens: 0,
      };
    },
    ...overrides,
  } as unknown as ProviderInterface;
}

describe('ProviderRegistry lazy init', () => {
  it('clears a provider whose initialize() failed so the next get() retries fresh', async () => {
    const registry = new ProviderRegistry(new ModelCapabilityRegistry());
    const ctor = vi.fn((_config: ProviderConfig) =>
      stubProvider({
        async initialize() {
          throw new Error('auth failed');
        },
      }),
    );
    registry.registerCustom('broken', makeConfig('broken'), ctor as any);

    await expect(registry.get('broken')).rejects.toThrow('auth failed');
    // Instance must not stay cached as ready; a second get must re-initialize.
    await expect(registry.get('broken')).rejects.toThrow('auth failed');
    expect(ctor).toHaveBeenCalledTimes(2);
  });

  it('shares a single initialization across concurrent get() calls', async () => {
    const registry = new ProviderRegistry(new ModelCapabilityRegistry());
    let initializeCount = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ctor = vi.fn((_config: ProviderConfig) =>
      stubProvider({
        async initialize() {
          initializeCount += 1;
          await gate;
        },
      }),
    );
    registry.registerCustom('slow', makeConfig('slow'), ctor as any);

    const first = registry.get('slow');
    const second = registry.get('slow');
    release();
    await Promise.all([first, second]);

    expect(ctor).toHaveBeenCalledTimes(1);
    expect(initializeCount).toBe(1);
  });
});
describe('ProviderRegistry type resolution', () => {
  it('throws a clear error when registering an unregistered provider type', () => {
    const registry = new ProviderRegistry(new ModelCapabilityRegistry());
    expect(() =>
      registry.register({ name: 'typo', provider: 'not-a-real-type' as any, models: [] }),
    ).toThrow(/No provider type "not-a-real-type" is registered/);
  });

  it('throws via create() instead of silently building an OpenAI-compatible provider', () => {
    expect(() =>
      ProviderRegistry.create(
        { name: 'x', provider: 'bogus' as any, models: [] },
        new ModelCapabilityRegistry(),
      ),
    ).toThrow(/No provider type "bogus" is registered/);
  });

  it('resolves every built-in provider type without throwing', () => {
    const registry = new ProviderRegistry(new ModelCapabilityRegistry());
    const builtins = [
      'openai',
      'openai_compatible',
      'anthropic',
      'gemini',
      'ollama',
      'vllm',
      'llamacpp',
      'openrouter',
    ];
    for (const provider of builtins) {
      expect(() =>
        registry.register({ name: `p-${provider}`, provider: provider as any, models: [] }),
      ).not.toThrow();
    }
  });
});
