/**
 * Legacy provider registry contracts (HTTP level):
 *  - apiKey honesty: a NON-EMPTY apiKey is rejected 400 with an actionable
 *    message (the key is never wired to the engine, so silently dropping it
 *    would lie about storage). Empty/absent apiKey stays accepted.
 *  - bounded registry: the module-level Map has no eviction, so the 501st
 *    POST answers 503 'provider registry full (500)' and the registry is
 *    NOT mutated by the rejected request.
 *  - honest health: no endpoint ping exists, so the answer is
 *    status 'unknown' + latency null + simulated true — never the old
 *    fabricated 'reachable' + random latency.
 * The provider map is module-level state; every test drains it first.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AetherServer } from '../server.js';
import type { EngineWiring } from '../server.js';
import { LoopManager } from '../engine/loop-manager.js';
import { WorkspacesService } from '../engine/workspaces.js';
import type { EngineService, SkillsService, OmpFacade } from '../engine/index.js';
import { providerStats, setProviderCatalogProbe } from './providers.js';

const unusedEngine = {
  async createSession() {
    throw new Error('not used by these routes');
  },
} as unknown as EngineService; // structural test double

const unusedSkills = { get: async () => null } as unknown as SkillsService; // test seam

const facadeStub = {
  async settingsSchema() {
    return { ok: false as const, error: 'unused' };
  },
} as unknown as OmpFacade; // structural test double

let server: AetherServer;

beforeEach(async () => {
  server = new AetherServer({
    port: 0,
    host: '127.0.0.1',
    engine: {
      engine: unusedEngine,
      loops: new LoopManager(unusedEngine, unusedSkills),
      skills: unusedSkills,
      facade: facadeStub,
    } satisfies EngineWiring,
    workspaces: new WorkspacesService(),
  });
  await server.start();
  // Drain the module-level registry so each test starts from a known size.
  const list = (await (await fetch(base() + '/api/providers')).json()) as {
    providers: Array<{ id: string }>;
  };
  for (const p of list.providers) {
    await fetch(`${base()}/api/providers/${p.id}`, { method: 'DELETE' });
  }
});

afterEach(async () => {
  await server.stop();
});

const base = () => `http://127.0.0.1:${server.getPort()}`;

async function postProvider(body: Record<string, unknown>): Promise<Response> {
  return fetch(`${base()}/api/providers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function providerCount(): Promise<number> {
  const r = (await (await fetch(`${base()}/api/providers`)).json()) as {
    providers: unknown[];
  };
  return r.providers.length;
}

describe('POST /api/providers apiKey honesty', () => {
  it('rejects a non-empty apiKey with the actionable omp-settings message', async () => {
    const before = await providerCount();
    const res = await postProvider({ name: 'p1', type: 'openai', apiKey: 'sk-abc123' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error:
        'apiKey is not supported here; provider keys are managed via omp settings (PUT /api/omp/settings)',
    });
    // Discriminator: pre-fix this created a record (apiKeyConfigured:true)
    // while silently dropping the secret.
    expect(await providerCount()).toBe(before);
  });

  it('accepts an absent apiKey and reports apiKeyConfigured false honestly', async () => {
    const res = await postProvider({ name: 'p2', type: 'openai' });
    expect(res.status).toBe(201);
    const { provider } = (await res.json()) as { provider: { apiKeyConfigured: boolean } };
    expect(provider.apiKeyConfigured).toBe(false);
  });

  it('accepts an empty-string apiKey (GUI sends undefined-or-value)', async () => {
    const res = await postProvider({ name: 'p3', type: 'openai', apiKey: '' });
    expect(res.status).toBe(201);
    const { provider } = (await res.json()) as { provider: { apiKeyConfigured: boolean } };
    expect(provider.apiKeyConfigured).toBe(false);
  });
});

describe('GET /api/providers/:id/health honesty', () => {
  it('answers unknown/simulated instead of fabricated reachability', async () => {
    const created = await postProvider({ name: 'p4', type: 'openai' });
    const { provider } = (await created.json()) as { provider: { id: string; name: string } };
    const res = await fetch(`${base()}/api/providers/${provider.id}/health`);
    expect(res.status).toBe(200);
    const { health } = (await res.json()) as {
      health: { id: string; status: string; latency: unknown; simulated?: boolean };
    };
    // Discriminator: pre-fix status was 'reachable' and latency a random int.
    expect(health.status).toBe('unknown');
    expect(health.latency).toBeNull();
    expect(health.simulated).toBe(true);
    expect(health.id).toBe(provider.id);
  });
});

describe('provider registry cap', () => {
  it('501st POST is a 503 capacity answer and the registry stays untouched', async () => {
    for (let i = 0; i < 500; i++) {
      const res = await postProvider({ name: `cap-${i}`, type: 'test' });
      if (res.status !== 201) throw new Error(`seed POST ${i} unexpectedly ${res.status}`);
    }
    expect(await providerCount()).toBe(500);
    const res = await postProvider({ name: 'overflow', type: 'test' });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'provider registry full (500)' });
    // Discriminator: the rejected POST must not have mutated the map.
    expect(await providerCount()).toBe(500);
  }, 30_000);
});

/**
 * providerStats honesty: `healthy` used to be `providers.size` — the SAME
 * fabricated number as `configured`, so "all providers healthy" was true by
 * construction. It is now the LAST OBSERVED count from the real engine
 * provider catalog (omp ModelRegistry via the facade's listProviders
 * accessor), 0 whenever that source is unavailable. providerStats() drives a
 * TTL-cached stale-while-revalidate refresh, so tests await the OBSERVED
 * condition (vi.waitFor), never a guessed sleep.
 */
describe('providerStats health honesty (real catalog source)', () => {
  afterEach(() => {
    // Restore the default probe + clear the observation cache for isolation.
    setProviderCatalogProbe(null);
  });

  /** providerStats() is sync-by-contract (getHealthStatus spreads it) while
   *  the observation is async: kick it and await the real settled condition. */
  async function settleHealthy(expected: number): Promise<{
    configured: number;
    healthy: number;
  }> {
    await vi.waitFor(() => expect(providerStats().healthy).toBe(expected));
    return providerStats();
  }

  it('healthy reflects the catalog probe, never the simulated map size', async () => {
    setProviderCatalogProbe(async () => 7);
    await postProvider({ name: 'a', type: 'openai' });
    await postProvider({ name: 'b', type: 'openai' });

    const stats = await settleHealthy(7);
    expect(stats.configured).toBe(2); // legacy CRUD records — honest for what they are
    // Discriminator: pre-fix healthy === configured === 2. The catalog says 7.
    expect(stats.healthy).toBe(7);
  });

  it('healthy is 0 when the real source is unavailable — NOT the registry size', async () => {
    let ran = false;
    setProviderCatalogProbe(async () => {
      ran = true; // engine down / SDK degraded → unavailable, not guessed
      return null;
    });
    await postProvider({ name: 'a', type: 'openai' });
    await postProvider({ name: 'b', type: 'openai' });
    await postProvider({ name: 'c', type: 'openai' });
    providerStats(); // kick the observation (refresh is pull-driven, sync API)
    await vi.waitFor(() => expect(ran).toBe(true));

    const stats = providerStats();
    expect(stats.configured).toBe(3);
    // Discriminator: pre-fix this claimed 3 'healthy' simulated records.
    expect(stats.healthy).toBe(0);
  });

  it('a throwing probe degrades to 0 loudly, never a fabricated figure', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      setProviderCatalogProbe(async () => {
        throw new Error('registry exploded');
      });
      providerStats(); // kick the observation (refresh is pull-driven, sync API)
      await vi.waitFor(() => expect(errSpy).toHaveBeenCalledTimes(1));
      expect(providerStats().healthy).toBe(0);
      expect(String(errSpy.mock.calls[0]?.[0] ?? '')).toMatch(/catalog probe failed/);
    } finally {
      errSpy.mockRestore();
    }
  });

  it('/health surfaces the observed figure through the unchanged shape', async () => {
    setProviderCatalogProbe(async () => 5);
    await settleHealthy(5);

    const health = (await (await fetch(`${base()}/health`)).json()) as {
      providers: { configured: number; healthy: number };
    };
    expect(health.providers.healthy).toBe(5);
    expect(typeof health.providers.configured).toBe('number');
  });
});
