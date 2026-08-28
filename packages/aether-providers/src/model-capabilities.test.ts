import { describe, it, expect } from 'vitest';
import { ModelCapabilityRegistry } from './model-capabilities.js';
import { Capability } from './types.js';

describe('ModelCapabilityRegistry', () => {
  it('resolves strict prefix matches to the longest known model id', () => {
    const registry = new ModelCapabilityRegistry();
    // "gpt-4o-mini-2024-07-18" shares the "gpt-4o" prefix, but it is a
    // gpt-4o-mini: it must NOT resolve to the higher-priced "gpt-4o".
    const caps = registry.get('gpt-4o-mini-2024-07-18', 'openai');
    expect(caps.pricing?.input).toBe(0.15);
    expect(caps.pricing?.output).toBe(0.6);
    expect(caps.contextWindow).toBe(128_000);
  });

  it('still resolves exact ids exactly', () => {
    const registry = new ModelCapabilityRegistry();
    expect(registry.get('gpt-4o', 'openai').pricing?.input).toBe(2.5);
  });

  it('applies provider defaults to unknown models instead of the minimal default', () => {
    const registry = new ModelCapabilityRegistry();
    // Anthropic ids like "claude-3-5-haiku-latest" are not registered, so they
    // must fall back to the Anthropic provider default — not the 4096-token
    // generic fallback that lacks tool use.
    const anthropic = registry.get('claude-3-5-haiku-latest', 'anthropic');
    expect(anthropic.contextWindow).toBeGreaterThan(4096);
    expect(anthropic.supported.has(Capability.Enum.tool_use)).toBe(true);

    const openai = registry.get('gpt-3.5-turbo', 'openai');
    expect(openai.supported.has(Capability.Enum.function_calling)).toBe(true);
  });

  it('never lets a caller mutate the registry through a returned capability object', () => {
    const registry = new ModelCapabilityRegistry();
    const first = registry.get('gpt-4o', 'openai');
    first.supported.add(Capability.Enum.audio);
    first.contextWindow = 0;
    first.pricing = { input: 99, output: 99 };

    const second = registry.get('gpt-4o', 'openai');
    expect(second.supported.has(Capability.Enum.audio)).toBe(false);
    expect(second.contextWindow).toBe(128_000);
    expect(second.pricing?.input).toBe(2.5);
  });

  it('resolves capabilities through the longest-prefix lookup', () => {
    const registry = new ModelCapabilityRegistry();
    expect(registry.hasCapability('gpt-4o-mini-2024-07-18', Capability.Enum.vision, 'openai')).toBe(
      true,
    );
  });
});
