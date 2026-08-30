/**
 * providers-store — the contract matrix for the provider control plane's
 * pure half, plus the atomic store round-trip. The codec is INJECTED (JSON
 * here, bun-YAML + stringifyYamlConfig in production): this file importing
 * the module under plain Node is itself the guard that no bun/YAML machinery
 * leaked into it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MAX_MODELS_PER_PROVIDER,
  MAX_PROVIDERS,
  ModelsYamlStore,
  mergeNewProvider,
  mergeRemovedProvider,
  providerEntryIn,
  providerNamesIn,
  validateApiKeyInput,
  type YamlCodecs,
} from './providers-store.js';

const KEY = 'sk-store-SUPERSECRET-123';

/** Deterministic injected codec — proves nothing downstream assumes YAML/bun. */
const jsonCodecs: YamlCodecs = {
  parse: (text) => JSON.parse(text),
  stringify: (value) => JSON.stringify(value, null, 2),
};

/** A config with an UNRELATED top-level key and a SECOND provider entry —
 *  both must survive every merge untouched (contract: preserve unrelated
 *  models.yml keys). */
function baseConfig(): Record<string, unknown> {
  return {
    theme: 'dark',
    providers: {
      'legacy-one': { baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'sk-other-KEEPME' },
    },
  };
}

const GOOD_CREATE = {
  name: 'mylocal',
  baseUrl: 'http://10.0.0.2:8000/v1',
  apiKey: KEY,
  models: [{ id: 'm1', contextWindow: 8192, maxTokens: 1024 }],
};

describe('validateApiKeyInput', () => {
  it('trims and accepts a normal key', () => {
    const r = validateApiKeyInput(`  ${KEY}  `);
    expect(r.ok && r.key).toBe(KEY);
  });

  it('accepts exactly 4096 characters, rejects 4097', () => {
    expect(validateApiKeyInput('k'.repeat(4096)).ok).toBe(true);
    expect(validateApiKeyInput('k'.repeat(4097)).ok).toBe(false);
  });

  it('rejects empty, whitespace-only and non-strings with ONE fixed message', () => {
    const cases: unknown[] = ['', '   ', undefined, null, 42, { key: 'x' }];
    const messages = new Set<string>();
    for (const value of cases) {
      const r = validateApiKeyInput(value);
      expect(r.ok).toBe(false);
      if (!r.ok) messages.add(r.error);
    }
    // Single fixed message: the 400 oracle reveals nothing about which rule hit.
    expect(messages.size).toBe(1);
  });
});

describe('mergeNewProvider — accepts', () => {
  it('builds the entry with trimmed key and the defaulted api', () => {
    const r = mergeNewProvider(baseConfig(), { ...GOOD_CREATE, apiKey: `  ${KEY}  ` });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.name).toBe('mylocal');
    expect(r.value.entry).toEqual({
      baseUrl: 'http://10.0.0.2:8000/v1',
      apiKey: KEY,
      api: 'openai-completions',
      models: [{ id: 'm1', contextWindow: 8192, maxTokens: 1024 }],
    });
  });

  it('preserves the second provider and the unknown top-level key verbatim', () => {
    const original = baseConfig();
    const r = mergeNewProvider(original, GOOD_CREATE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.config.theme).toBe('dark');
    expect(r.value.config.providers).toEqual({
      'legacy-one': { baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'sk-other-KEEPME' },
      mylocal: r.value.entry,
    });
    // Input config object is NEVER mutated.
    expect(original).toEqual(baseConfig());
  });

  it('accepts keyless auth:none with models and records auth on the entry', () => {
    const r = mergeNewProvider(baseConfig(), {
      name: 'ollama2',
      baseUrl: 'http://localhost:11434',
      auth: 'none',
      models: [{ id: 'llama3' }, { id: 'qwen' }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.entry.apiKey).toBeUndefined();
    expect(r.value.entry.auth).toBe('none');
  });

  it('honours an explicit api identifier', () => {
    const r = mergeNewProvider(baseConfig(), {
      name: 'p1',
      baseUrl: 'https://api.example.com',
      api: 'anthropic-messages',
    });
    expect(r.ok && r.value.entry.api).toBe('anthropic-messages');
  });

  it('omits an empty models array from the entry (no key required)', () => {
    const r = mergeNewProvider(baseConfig(), { name: 'p2', baseUrl: 'http://x.test', models: [] });
    expect(r.ok && !('models' in r.value.entry) && !('apiKey' in r.value.entry)).toBe(true);
  });
});

describe('mergeNewProvider — rejects (fixed messages, correct status)', () => {
  const bad = (name: string, patch: Record<string, unknown>) =>
    mergeNewProvider(baseConfig(), { ...GOOD_CREATE, name, ...patch });

  it('400s every invalid name shape', () => {
    for (const name of ['', '   ', 'Bad_Name', '-leading', '_leading', 'a'.repeat(65), 'x y']) {
      const r = bad(name, {});
      expect(r.ok, name).toBe(false);
      if (!r.ok) expect([r.status, r.error]).toEqual([400, expect.stringContaining('name')]);
    }
  });

  it('400s a baseUrl that is missing or not an http(s) URL', () => {
    for (const baseUrl of [undefined, '', 'not a url', 'ftp://files.test', '://broken']) {
      const r = bad('okname', { baseUrl });
      expect(r.ok, String(baseUrl)).toBe(false);
      if (!r.ok) expect(r.status).toBe(400);
    }
  });

  it('400s an apiKey over 4096 chars and an empty/whitespace key', () => {
    for (const apiKey of ['k'.repeat(4097), '', '   ']) {
      const r = bad('okname', { apiKey });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe(400);
    }
  });

  it('400s models declared WITHOUT a key (and passes once auth:none)', () => {
    const noKey = bad('okname', { apiKey: undefined });
    expect(noKey.ok).toBe(false);
    if (!noKey.ok) expect(noKey.status).toBe(400);
    expect(bad('okname', { apiKey: undefined, auth: 'none' }).ok).toBe(true);
  });

  it('400s model lists past the cap, empty ids, non-positive windows/tokens', () => {
    const many = Array.from({ length: MAX_MODELS_PER_PROVIDER + 1 }, (_, i) => ({ id: `m${i}` }));
    expect(bad('okname', { models: many }).ok).toBe(false);
    expect(bad('okname', { models: [{ id: '' }] }).ok).toBe(false);
    expect(bad('okname', { models: [{ id: 'm', contextWindow: 0 }] }).ok).toBe(false);
    expect(bad('okname', { models: [{ id: 'm', contextWindow: -5 }] }).ok).toBe(false);
    expect(bad('okname', { models: [{ id: 'm', maxTokens: 1.5 }] }).ok).toBe(false);
    expect(bad('okname', { models: [{ id: 'm', maxTokens: '4k' }] }).ok).toBe(false);
    expect(bad('okname', { models: 'nope' }).ok).toBe(false);
  });

  it('400s an auth value other than none', () => {
    const r = bad('okname', { auth: 'oauth' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it('409s a name already present in the models.yml providers map', () => {
    const r = mergeNewProvider(baseConfig(), { ...GOOD_CREATE, name: 'legacy-one' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(409);
  });

  it('409s once models.yml already holds MAX_PROVIDERS entries', () => {
    const providers: Record<string, unknown> = {};
    for (let i = 0; i < MAX_PROVIDERS; i++) providers[`p${i}`] = { baseUrl: 'http://x.test' };
    const r = mergeNewProvider({ providers }, { ...GOOD_CREATE, name: 'overflow' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(409);
  });
});

describe('mergeRemovedProvider', () => {
  it('removes exactly the target entry, keeping every other key', () => {
    const original = {
      theme: 'dark',
      providers: { a: { baseUrl: 'http://a' }, b: { baseUrl: 'http://b' } },
    };
    const r = mergeRemovedProvider(original, 'a');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({ theme: 'dark', providers: { b: { baseUrl: 'http://b' } } });
    expect(original.providers).toHaveProperty('a'); // no mutation
  });

  it('400s a bundled (not-models.yml) id with the contract message verbatim', () => {
    const r = mergeRemovedProvider(baseConfig(), 'openai');
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect([r.status, r.error]).toEqual([
        400,
        'built-in providers cannot be deleted; remove their key instead',
      ]);
  });

  it('400s a non-object entry the same way (never trusts arbitrary YAML)', () => {
    const r = mergeRemovedProvider({ providers: { x: 'just-a-string' } }, 'x');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });
});

describe('config accessors', () => {
  it('are defensive over hostile/parsed shapes', () => {
    expect(providerNamesIn(null)).toEqual([]);
    expect(providerNamesIn([])).toEqual([]);
    expect(providerNamesIn({ providers: 'nope' })).toEqual([]);
    expect(providerEntryIn({ providers: { a: 42 } }, 'a')).toBeUndefined();
    expect(providerEntryIn({ providers: { a: { baseUrl: 'u' } } }, 'a')).toEqual({ baseUrl: 'u' });
  });
});

describe('ModelsYamlStore (injected codecs, atomic write)', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'aether-store-'));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function freshStore(): ModelsYamlStore {
    // Unique file per test — isolation without shared state.
    const path = join(dir, `models-${Math.random().toString(36).slice(2)}.yml`);
    return new ModelsYamlStore(path, jsonCodecs);
  }

  it('treats a missing file as an empty config (first write is legitimate)', async () => {
    const r = await freshStore().load();
    expect(r).toEqual({ ok: true, value: {} });
  });

  it('round-trips a full config preserving unknown keys and extra providers', async () => {
    const store = freshStore();
    expect((await store.load()).ok).toBe(true);
    const merged = mergeNewProvider(baseConfig(), GOOD_CREATE);
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    await store.save(merged.value.config);
    const back = await store.load();
    expect(back).toEqual({ ok: true, value: merged.value.config });
    const value = back.ok ? back.value : {};
    expect(providerNamesIn(value)).toContain('mylocal');
    expect(providerEntryIn(value, 'legacy-one')).toEqual({
      baseUrl: 'http://127.0.0.1:1/v1',
      apiKey: 'sk-other-KEEPME',
    });
  });

  it('leaves NO tmp file behind and writes exactly the codec output', async () => {
    const store = freshStore();
    await store.save(baseConfig());
    const text = fs.readFileSync(store.filePath, 'utf8');
    expect(text).toBe(jsonCodecs.stringify(baseConfig()));
    const strays = readdirSync(dir).filter(
      (f) => f.endsWith('.tmp') && f.includes(store.filePath.split('.').pop() ?? '~'),
    );
    expect(strays).toEqual([]);
    // A second save over the same path works (unique tmp names).
    await store.save({ providers: {} });
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('creates the parent directory when it does not exist', async () => {
    const store = new ModelsYamlStore(join(dir, 'nested', 'deeper', 'models.yml'), jsonCodecs);
    await store.save({ providers: { a: {} } });
    expect(fs.existsSync(store.filePath)).toBe(true);
  });

  it('reports an unparseable config as a fixed 500 — no path, no content echo', async () => {
    const store = freshStore();
    writeFileSync(store.filePath, `{{{{ not-yaml ${KEY}`, 'utf8');
    const r = await store.load();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(500);
      expect(r.error).not.toContain(KEY);
      expect(r.error).not.toContain(dir);
    }
  });

  it('reports a non-mapping config as a fixed 500 and accepts null-text as empty', async () => {
    const store = freshStore();
    writeFileSync(store.filePath, '[1,2,3]', 'utf8');
    const r = await store.load();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(500);

    const store2 = freshStore();
    writeFileSync(store2.filePath, '', 'utf8');
    expect(await store2.load()).toEqual({ ok: true, value: {} });
  });

  it('backs up the pre-write bytes to <path>.bak; first write creates none', async () => {
    const store = freshStore();
    await store.save({ providers: { one: { baseUrl: 'http://127.0.0.1:1/v1' } } });
    expect(fs.existsSync(`${store.filePath}.bak`)).toBe(false); // nothing to back up
    const first = fs.readFileSync(store.filePath, 'utf8');
    await store.save({ providers: {} }); // overwrite: old bytes must survive in .bak
    expect(fs.readFileSync(`${store.filePath}.bak`, 'utf8')).toBe(first);
    expect(fs.readFileSync(store.filePath, 'utf8')).toBe(jsonCodecs.stringify({ providers: {} }));
  });

  it('never leaves the file group/other-readable (inline apiKey hygiene)', async () => {
    const store = freshStore();
    writeFileSync(store.filePath, JSON.stringify(baseConfig()), 'utf8');
    fs.chmodSync(store.filePath, 0o644); // simulate a hand-created world-readable file
    await store.save(baseConfig());
    expect(fs.statSync(store.filePath).mode & 0o777).toBe(0o600);
    // copyFileSync inherits the source mode — the .bak of a 644 source is
    // exactly where inline apiKeys used to leak; it must be 0600 too.
    expect(fs.statSync(`${store.filePath}.bak`).mode & 0o777).toBe(0o600);
    const fresh = freshStore(); // first-ever write too
    await fresh.save(baseConfig());
    expect(fs.statSync(fresh.filePath).mode & 0o777).toBe(0o600);
  });
});

/* ─── withLock: whole read-modify-write cycle serialization ──────────────── */

describe('ModelsYamlStore.withLock (lost-update prevention)', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'aether-lock-'));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  function freshStore(): ModelsYamlStore {
    return new ModelsYamlStore(
      join(dir, `lock-${Math.random().toString(36).slice(2)}.yml`),
      jsonCodecs,
    );
  }

  it('serializes overlapping cycles: the second cycle sees the first write', async () => {
    const store = freshStore();
    await store.save(baseConfig());
    const order: string[] = [];
    // Two interleaving-shaped cycles fired in the SAME tick — the exact
    // shape of concurrent provider CRUD. Without the mutex both loads read
    // the same base and the later save reverts the earlier writer.
    const first = store.withLock(async () => {
      const loaded = await store.load();
      if (!loaded.ok) throw new Error('unreadable');
      await new Promise((r) => setTimeout(r, 10)); // widen the interleave window
      const merged = mergeNewProvider(loaded.value, GOOD_CREATE);
      if (!merged.ok) throw new Error('merge rejected');
      await store.save(merged.value.config);
      order.push('first-save');
    });
    const second = store.withLock(async () => {
      const loaded = await store.load();
      order.push('second-load');
      if (!loaded.ok) throw new Error('unreadable');
      // THE discriminator: serialized, this load MUST see first's provider.
      expect(providerNamesIn(loaded.value)).toContain('mylocal');
      await store.save({ ...loaded.value, theme: 'light' });
    });
    await Promise.all([first, second]);
    expect(order).toEqual(['first-save', 'second-load']);
    const final = await store.load();
    if (!final.ok) throw new Error('unreadable');
    // First cycle's write SURVIVES the second (a stale-base save would have
    // silently dropped it pre-serialization).
    expect(providerNamesIn(final.value)).toEqual(['legacy-one', 'mylocal']);
    expect(final.value.theme).toBe('light');
  });

  it('a rejected cycle reaches its caller verbatim and never poisons the chain', async () => {
    const store = freshStore();
    await expect(
      store.withLock(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    // Pre-fix there is no chain to poison — but the mutex must not become a
    // deadlock source either: callers queued behind a failure still run.
    expect(await store.withLock(async () => 42)).toBe(42);
  });

  it('cycles run strictly in call order even under contention', async () => {
    const store = freshStore();
    await store.save(baseConfig());
    const order: number[] = [];
    const cycles = [0, 1, 2, 3].map((i) =>
      store.withLock(async () => {
        await new Promise((r) => setTimeout(r, 4 - i)); // later calls finish FASTER unserialized
        order.push(i);
      }),
    );
    await Promise.all(cycles);
    // Pre-fix the inversions (3 before 0) were exactly how lost updates
    // ordered; with the chain, completion order == call order.
    expect(order).toEqual([0, 1, 2, 3]);
  });
});
