/**
 * Provider control-plane HTTP verbs (routes/facade.ts) against a FAKE
 * EngineService injected exactly like routes/engine.test.ts + facade.test.ts
 * (structural doubles through `as unknown as`). The fake delegates key
 * storage to a RECORDING authStorage double and custom-provider CRUD to the
 * REAL pure merge functions over an in-memory config — so the validation
 * semantics (400/409) exercised over HTTP are the production ones.
 *
 * Contract discriminators:
 *  - the submitted apiKey NEVER appears in any serialized response body;
 *  - 400 on apiKey >4096 chars / empty key / bad name / models-without-key;
 *  - 409 on duplicate; 400 delete-bundled with the fixed message;
 *  - verify passes reason codes through, and the ENGINE-level verify
 *    (timeout / network / http-<status>) is driven by an injected fetch on a
 *    warmed real EngineService (private seams assigned via cast).
 */
import { describe, it, expect, afterEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AetherServer } from '../server.js';
import type { EngineWiring } from '../server.js';
import { LoopManager } from '../engine/loop-manager.js';
import type { EngineService, SkillsService, OmpFacade } from '../engine/index.js';
import {
  EngineService as EngineServiceClass,
  EngineUnavailableError,
  ProviderOpError,
} from '../engine/engine-service.js';
import {
  mergeNewProvider,
  mergeRemovedProvider,
  providerEntryIn,
  providerNamesIn,
} from '../engine/providers-store.js';
import { setProviderKey } from './facade.js';

const KEY = 'sk-route-SUPERSECRET-999';

/* ─── Fake world: recording authStorage + pure merges over a live config ─ */

const BUNDLED = ['openai', 'anthropic', 'ollama'];

interface VerifyStub {
  reachable: boolean;
  modelCount: number | null;
  reason?: string;
}

interface ProviderWorld {
  engine: EngineService;
  facade: OmpFacade;
  authCalls: {
    set: Array<{ provider: string; key: string }>;
    remove: string[];
  };
  authed: Set<string>;
  config(): Record<string, unknown>;
  setVerify(result: VerifyStub): void;
  facadeListCalls(): number;
}

function makeWorld(initialConfig: Record<string, unknown>): ProviderWorld {
  const authCalls = {
    set: [] as Array<{ provider: string; key: string }>,
    remove: [] as string[],
  };
  const authed = new Set<string>(['openai']);
  let config = initialConfig;
  let verifyResult: VerifyStub = { reachable: true, modelCount: 3 };
  let facadeListed = 0;

  const impl = {
    async listProviderDtos() {
      // Mirrors EngineProviderDto rows (custom/authOrigin/discoveryStatus).
      return [
        {
          id: 'openai',
          name: 'openai',
          modelCount: 2,
          models: ['gpt-a', 'gpt-b'],
          authenticated: authed.has('openai'),
          discoverable: false,
          custom: false,
          authOrigin: 'api_key',
        },
        {
          id: 'mylocal',
          name: 'mylocal',
          baseUrl: 'http://127.0.0.1:8000/v1',
          modelCount: 1,
          models: ['m1'],
          authenticated: false,
          discoverable: false,
          custom: true,
          discoveryStatus: 'ok',
        },
      ];
    },
    async setProviderApiKey(provider: string, key: string) {
      const inModelsYml = Object.prototype.hasOwnProperty.call(
        (config.providers ?? {}) as Record<string, unknown>,
        provider,
      );
      if (!BUNDLED.includes(provider) && !inModelsYml)
        throw new ProviderOpError(400, 'unknown provider');
      authCalls.set.push({ provider, key }); // RECORDING storage double
      authed.add(provider);
    },
    async removeProviderApiKey(provider: string) {
      authCalls.remove.push(provider);
      authed.delete(provider);
      return authed.has(provider); // post-state truth, same as the engine
    },
    async createCustomProvider(input: Record<string, unknown>) {
      // Mirrors the engine's order: registry-known (bundled) 409 pre-check,
      // then the REAL pure merge (name/baseUrl/key/models rules + cap).
      const name = typeof input?.name === 'string' ? input.name.trim() : '';
      if (BUNDLED.includes(name)) throw new ProviderOpError(409, 'provider already exists');
      const merged = mergeNewProvider(config, input);
      if (!merged.ok) throw new ProviderOpError(merged.status, merged.error);
      config = merged.value.config;
      return merged.value.name;
    },
    async deleteCustomProvider(id: string) {
      const merged = mergeRemovedProvider(config, id);
      if (!merged.ok) throw new ProviderOpError(merged.status, merged.error);
      config = merged.value;
      authCalls.remove.push(id);
    },
    async verifyProvider() {
      return verifyResult;
    },
    providerHealthStats: () => ({ configured: 4, healthy: authed.size }),
  };

  const engine = impl as unknown as EngineService; // structural test double
  const facade = {
    async listProviders() {
      facadeListed++;
      return { ok: true, providers: [] };
    },
  } as unknown as OmpFacade;

  return {
    engine,
    facade,
    authCalls,
    authed,
    config: () => config,
    setVerify(result: VerifyStub) {
      verifyResult = result;
    },
    facadeListCalls: () => facadeListed,
  };
}

/* ─── Server harness (same DI pattern as routes/facade.test.ts) ────────── */

const unusedSkills = { get: async () => null } as unknown as SkillsService; // test seam

let server: AetherServer | null = null;
// Created fresh by start() at the top of every test.
let world!: ProviderWorld;

function baseConfig(): Record<string, unknown> {
  return {
    theme: 'dark', // unrelated top-level key that must survive every merge
    providers: {
      'legacy-one': { baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'sk-other-KEEPME' },
    },
  };
}

async function start(wiringOverrides: Partial<EngineWiring> = {}): Promise<string> {
  world = makeWorld(baseConfig());
  server = new AetherServer({
    port: 0,
    host: '127.0.0.1',
    engine: {
      engine: world.engine,
      loops: new LoopManager(world.engine, unusedSkills),
      skills: unusedSkills,
      facade: world.facade,
      ...wiringOverrides,
    },
  });
  await server.start();
  return `http://127.0.0.1:${server.getPort()}`;
}

afterEach(async () => {
  await server?.stop();
  server = null;
});

function send(base: string, method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/* ─── GET catalog ──────────────────────────────────────────────────────── */

describe('GET /api/omp/providers', () => {
  it('serves the engine rows (custom/authOrigin/discoveryStatus) verbatim', async () => {
    const base = await start();
    const res = await send(base, 'GET', '/api/omp/providers');
    expect(res.status).toBe(200);
    const { providers } = (await res.json()) as { providers: Array<Record<string, unknown>> };
    expect(providers.map((p) => p.id)).toEqual(['openai', 'mylocal']);
    expect(providers[0]).toMatchObject({
      authenticated: true,
      custom: false,
      authOrigin: 'api_key',
    });
    expect(providers[1]).toMatchObject({
      custom: true,
      discoveryStatus: 'ok',
      authenticated: false,
    });
    // Discriminator: the live engine path ran; the facade per-call path did NOT.
    expect(world.facadeListCalls()).toBe(0);
  });

  it('falls back to the facade storage ONLY when the engine is not started', async () => {
    const broken = {
      async listProviderDtos() {
        throw new EngineUnavailableError();
      },
    } as unknown as EngineService; // structural test double
    const base = await start({ engine: broken });
    const res = await send(base, 'GET', '/api/omp/providers');
    expect(res.status).toBe(200);
    expect(world.facadeListCalls()).toBe(1);
  });
});

/* ─── Key CRUD ─────────────────────────────────────────────────────────── */

describe('PUT /api/omp/providers/:id/key', () => {
  it('stores via the recording authStorage and echoes NO secret', async () => {
    const base = await start();
    const res = await send(base, 'PUT', '/api/omp/providers/openai/key', { apiKey: KEY });
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(JSON.parse(text)).toEqual({ ok: true, provider: 'openai', authenticated: true });
    expect(text).not.toContain(KEY); // discriminator: key never serialized
    expect(world.authCalls.set).toEqual([{ provider: 'openai', key: KEY }]);
  });

  it('400s empty, whitespace-only, over-4096 and missing keys — without echoing them', async () => {
    const base = await start();
    for (const apiKey of ['', '    ', 'k'.repeat(4097), undefined]) {
      const res = await send(base, 'PUT', '/api/omp/providers/openai/key', { apiKey });
      const text = await res.text();
      expect(res.status).toBe(400);
      if (typeof apiKey === 'string' && apiKey.length > 0) expect(text).not.toContain(apiKey);
    }
    expect(world.authCalls.set).toEqual([]); // nothing was stored
  });

  it('400s an unknown provider (not registry-known, not in models.yml)', async () => {
    const base = await start();
    const res = await send(base, 'PUT', '/api/omp/providers/definitely-not-real/key', {
      apiKey: KEY,
    });
    const text = await res.text();
    expect(res.status).toBe(400);
    expect(JSON.parse(text).error).toBe('unknown provider');
    expect(text).not.toContain(KEY);
  });

  it('400s a body that is not a JSON object', async () => {
    const base = await start();
    const res = await fetch(`${base}/api/omp/providers/openai/key`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: 'null',
    });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/omp/providers/:id/key', () => {
  it('removes the key and answers the POST-removal auth truth', async () => {
    const base = await start();
    expect(world.authed.has('openai')).toBe(true);
    const res = await send(base, 'DELETE', '/api/omp/providers/openai/key');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, provider: 'openai', authenticated: false });
    expect(world.authCalls.remove).toContain('openai');
  });
});

/* ─── Custom providers (models.yml) ───────────────────────────────────── */

describe('POST /api/omp/providers', () => {
  it('creates, preserves unrelated keys end-to-end, and never echoes the key', async () => {
    const base = await start();
    const res = await send(base, 'POST', '/api/omp/providers', {
      name: 'mylocal',
      baseUrl: 'http://10.0.0.2:8000/v1',
      apiKey: KEY,
      models: [{ id: 'm1', contextWindow: 8192, maxTokens: 1024 }],
    });
    const text = await res.text();
    expect(res.status).toBe(201);
    expect(JSON.parse(text)).toEqual({ ok: true, provider: 'mylocal' });
    expect(text).not.toContain(KEY); // the inline key NEVER rides along
    // Merge preservation through the real pure function:
    const cfg = world.config();
    expect(cfg.theme).toBe('dark');
    expect(providerNamesIn(cfg)).toEqual(['legacy-one', 'mylocal']);
    expect(providerEntryIn(cfg, 'legacy-one')).toEqual({
      baseUrl: 'http://127.0.0.1:1/v1',
      apiKey: 'sk-other-KEEPME',
    });
    expect(providerEntryIn(cfg, 'mylocal')).toEqual({
      baseUrl: 'http://10.0.0.2:8000/v1',
      apiKey: KEY,
      api: 'openai-completions',
      models: [{ id: 'm1', contextWindow: 8192, maxTokens: 1024 }],
    });
  });

  it('400s bad names, missing/invalid baseUrl and models-without-key', async () => {
    const base = await start();
    const cases: Array<Record<string, unknown>> = [
      { name: 'Bad_Name', baseUrl: 'http://x.test' },
      { name: 'ok', baseUrl: 'not a url' },
      { name: 'ok2', baseUrl: '' },
      { name: 'ok3', baseUrl: 'http://x.test', models: [{ id: 'm1' }] }, // key required
    ];
    for (const body of cases) {
      const res = await send(base, 'POST', '/api/omp/providers', body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('409s duplicates (bundled name and existing models.yml entry)', async () => {
    const base = await start();
    const bundled = await send(base, 'POST', '/api/omp/providers', {
      name: 'openai',
      baseUrl: 'http://x.test',
    });
    expect(bundled.status).toBe(409);
    await send(base, 'POST', '/api/omp/providers', { name: 'dup', baseUrl: 'http://x.test' });
    const again = await send(base, 'POST', '/api/omp/providers', {
      name: 'dup',
      baseUrl: 'http://y.test',
    });
    expect(again.status).toBe(409);
  });

  it('accepts a keyless local server with auth:none', async () => {
    const base = await start();
    const res = await send(base, 'POST', '/api/omp/providers', {
      name: 'localnokey',
      baseUrl: 'http://127.0.0.1:11434',
      auth: 'none',
      models: [{ id: 'llama3' }],
    });
    expect(res.status).toBe(201);
    expect(providerEntryIn(world.config(), 'localnokey')?.auth).toBe('none');
  });
});

describe('DELETE /api/omp/providers/:id', () => {
  it('400s bundled providers with the contract message verbatim', async () => {
    const base = await start();
    const res = await send(base, 'DELETE', '/api/omp/providers/openai');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'built-in providers cannot be deleted; remove their key instead',
    });
  });

  it('deletes a custom provider (entry + key) and keeps the rest', async () => {
    const base = await start();
    await send(base, 'POST', '/api/omp/providers', { name: 'temp', baseUrl: 'http://x.test' });
    const res = await send(base, 'DELETE', '/api/omp/providers/temp');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(providerNamesIn(world.config())).toEqual(['legacy-one']);
    expect(world.authCalls.remove).toContain('temp');
    expect(world.config().theme).toBe('dark');
  });
});

/* ─── Verify (route passthrough + engine classification) ───────────────── */

describe('POST /api/omp/providers/:id/verify (route)', () => {
  it('passes reachable + modelCount through, no reason when fine', async () => {
    const base = await start();
    world.setVerify({ reachable: true, modelCount: 7 });
    const res = await send(base, 'POST', '/api/omp/providers/ollama/verify');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      provider: 'ollama',
      reachable: true,
      modelCount: 7,
    });
  });

  it('passes timeout and http-<status> reason codes through unchanged', async () => {
    const base = await start();
    world.setVerify({ reachable: false, modelCount: null, reason: 'timeout' });
    expect(await (await send(base, 'POST', '/api/omp/providers/ollama/verify')).json()).toEqual({
      ok: true,
      provider: 'ollama',
      reachable: false,
      modelCount: null,
      reason: 'timeout',
    });
    world.setVerify({ reachable: false, modelCount: null, reason: 'http-503' });
    const body = (await (
      await send(base, 'POST', '/api/omp/providers/ollama/verify')
    ).json()) as Record<string, unknown>;
    expect(body.reason).toBe('http-503');
  });
});

/* ─── No engine wired → mutations degrade 501 (direct handler call) ────── */

describe('provider mutations without an engine', () => {
  it('answer the fixed 501 before touching the body', async () => {
    const captured: { status?: number; body?: string } = {};
    const res = {
      writeHead(status: number): unknown {
        captured.status = status;
        return this;
      },
      end(data?: unknown): unknown {
        captured.body = String(data ?? '');
        return this;
      },
    } as unknown as ServerResponse;
    // ctx WITHOUT engine — exactly what providerEngineOr501 guards.
    await setProviderKey(
      {} as IncomingMessage,
      res,
      { id: 'openai' },
      {
        facade: {} as OmpFacade,
      },
    );
    expect(captured.status).toBe(501);
    expect(captured.body).toMatch(/engine not configured/i);
  });
});

/* ─── Engine-level verify: injected fetch on a warmed real EngineService ─ */

function warmEngine(opts: {
  registry: Record<string, unknown>;
  auth?: Record<string, unknown>;
}): EngineServiceClass {
  const engine = new EngineServiceClass({ force: true });
  // Test seams (documented private fields): skip start(), hand the provider
  // ops a fake warm registry/authStorage. No Bun, no network, no SQLite.
  Object.assign(engine as unknown as Record<string, unknown>, {
    started: true,
    available: true,
    registry: opts.registry,
    authStorage: opts.auth ?? { hasAuth: () => false },
  });
  return engine;
}

function injectFetch(engine: EngineServiceClass, impl: (...args: unknown[]) => unknown): void {
  (engine as unknown as Record<string, unknown>).fetchImpl = (url: unknown, init: unknown) => {
    return impl(url, init);
  };
}

describe('EngineService.verifyProvider (injected fetch)', () => {
  it('timeout (AbortSignal name) classifies as timeout, never throws', async () => {
    const engine = warmEngine({
      registry: { getProviderBaseUrl: () => 'http://slow.test/v1/' },
      auth: { hasAuth: () => true, peekApiKey: async () => 'probe-key' },
    });
    injectFetch(engine, () => {
      const err = new Error('The operation was aborted due to timeout');
      err.name = 'TimeoutError';
      throw err;
    });
    expect(await engine.verifyProvider('slow')).toEqual({
      reachable: false,
      modelCount: null,
      reason: 'timeout',
    });
  });

  it('network failure classifies as network', async () => {
    const engine = warmEngine({ registry: { getProviderBaseUrl: () => 'http://down.test/v1' } });
    injectFetch(engine, () => {
      throw new TypeError('fetch failed');
    });
    expect(await engine.verifyProvider('down')).toEqual({
      reachable: false,
      modelCount: null,
      reason: 'network',
    });
  });

  it('a non-2xx answer classifies as http-<status>', async () => {
    const engine = warmEngine({ registry: { getProviderBaseUrl: () => 'http://gated.test/v1' } });
    injectFetch(engine, () => ({ ok: false, status: 404, json: async () => ({}) }));
    expect(await engine.verifyProvider('gated')).toEqual({
      reachable: false,
      modelCount: null,
      reason: 'http-404',
    });
  });

  it('a healthy probe counts models and sends the peeked key as Bearer', async () => {
    const seen: Array<{ url: string; init: Record<string, unknown> }> = [];
    const engine = warmEngine({
      registry: { getProviderBaseUrl: () => 'http://good.test/v1' },
      auth: { hasAuth: () => true, peekApiKey: async () => 'peeked-KEY-1' },
    });
    (engine as unknown as Record<string, unknown>).fetchImpl = (url: unknown, init: unknown) => {
      seen.push({ url: String(url), init: init as Record<string, unknown> });
      return { ok: true, status: 200, json: async () => ({ data: [{ id: 'a' }, { id: 'b' }] }) };
    };
    expect(await engine.verifyProvider('good')).toEqual({ reachable: true, modelCount: 2 });
    expect(seen[0]?.url).toBe('http://good.test/v1/models'); // trailing-slash normalized
    const headers = seen[0]?.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer peeked-KEY-1');
  });

  it('no baseUrl anywhere (registry miss + unreadable models.yml) → no-base-url', async () => {
    // No modelsStore injected: the production store build (bun YAML) fails
    // under Node and degrades — the probe answers, never crashes.
    const engine = warmEngine({ registry: { getProviderBaseUrl: () => undefined } });
    expect(await engine.verifyProvider('ghost')).toEqual({
      reachable: false,
      modelCount: null,
      reason: 'no-base-url',
    });
  });
});

/* ─── Engine-level key ops: recording authStorage via the LIVE instances ── */

describe('EngineService key ops (recording authStorage seam)', () => {
  it('refuses unknown providers with a 400 ProviderOpError', async () => {
    const engine = warmEngine({
      registry: { hasProvider: (p: string) => p === 'openai', getAll: () => [] },
      auth: { hasAuth: () => false, set: async () => {} },
    });
    await expect(engine.setProviderApiKey('nope', KEY)).rejects.toMatchObject({
      name: 'ProviderOpError',
      status: 400,
    });
  });
});
