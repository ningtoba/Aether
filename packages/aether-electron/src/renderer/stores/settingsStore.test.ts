/**
 * settingsStore — sanitizer tests.
 *
 * Provider API keys and custom headers MUST NOT be persisted to
 * localStorage; `sanitizePersistedSettings` strips them from the
 * serialized slice while keeping every other setting.
 */
import { describe, it, expect } from 'vitest';
import {
  sanitizePersistedSettings,
  DEFAULT_SETTINGS,
  type AllAetherSettings,
  type ProviderSettings,
} from './settingsStore.js';

function makeSettings(overrides: Partial<ProviderSettings> = {}): AllAetherSettings {
  const providers: ProviderSettings = {
    ...DEFAULT_SETTINGS.providers,
    apiKeys: { openai: 'sk-super-secret', anthropic: 'sk-ant-secret' },
    customHeaders: { Authorization: 'Bearer sekrit' },
    ...overrides,
  };
  return { ...DEFAULT_SETTINGS, providers };
}

describe('sanitizePersistedSettings', () => {
  it('empties API keys and custom headers instead of persisting them', () => {
    const persisted = sanitizePersistedSettings({ settings: makeSettings() });
    expect(persisted.settings.providers.apiKeys).toEqual({});
    expect(persisted.settings.providers.customHeaders).toEqual({});
    // The serialized JSON must not contain the secrets.
    expect(JSON.stringify(persisted)).not.toContain('sk-');
  });

  it('keeps every non-secret setting', () => {
    const persisted = sanitizePersistedSettings({ settings: makeSettings() });
    expect(persisted.settings.providers.defaultProvider).toBe(
      DEFAULT_SETTINGS.providers.defaultProvider,
    );
    expect(persisted.settings.general.port).toBe(DEFAULT_SETTINGS.general.port);
    expect(persisted.settings.memory.chunkingStrategy).toBe(
      DEFAULT_SETTINGS.memory.chunkingStrategy,
    );
    expect(persisted.settings.deployment.cicdEnabled).toBe(DEFAULT_SETTINGS.deployment.cicdEnabled);
  });

  it('survives a shallow rehydrate merge without undefined secret fields', () => {
    // zustand persist uses a shallow top-level merge on rehydrate; the
    // sanitized slice replaces `settings`. Simulate that merge against the
    // default state and confirm the Settings page's Object.entries(...) over
    // providers.apiKeys cannot receive undefined.
    const sanitized = sanitizePersistedSettings({ settings: makeSettings() });
    const rehydrated = { ...{ settings: DEFAULT_SETTINGS }, ...sanitized };
    expect(rehydrated.settings.providers.apiKeys).toBeDefined();
    expect(rehydrated.settings.providers.customHeaders).toBeDefined();
    expect(Object.entries(rehydrated.settings.providers.apiKeys)).toEqual([]);
    expect(Object.entries(rehydrated.settings.providers.customHeaders)).toEqual([]);
  });

  it('does not mutate the in-memory settings object', () => {
    const source = makeSettings();
    sanitizePersistedSettings({ settings: source });
    expect(Object.keys(source.providers)).toContain('apiKeys');
    expect(source.providers.apiKeys.openai).toBe('sk-super-secret');
  });
});
