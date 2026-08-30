/**
 * Credential redaction on the settings surface (HTTP level):
 *  - GET /api/omp/settings/values NEVER echoes a credential-flagged value.
 *    Clients get a presence marker instead — true when a non-empty value is
 *    stored, false when empty or absent (same truthiness as the providers.ts
 *    apiKeyConfigured flag). Server-side redaction means the secret bytes
 *    must not appear anywhere in the response body.
 *  - non-credential values pass through verbatim.
 *  - the WRITE path (PUT /api/omp/settings) still forwards the REAL value to
 *    the facade unchanged — redaction is strictly read-only.
 * The facade is a structural test double (same seam as engine.test.ts):
 * these routes only ever call settingsSchema/settingsGet/settingsSet.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AetherServer } from '../server.js';
import type { EngineWiring } from '../server.js';
import { LoopManager } from '../engine/loop-manager.js';
import { WorkspacesService } from '../engine/workspaces.js';
import type { EngineService, SkillsService, OmpFacade } from '../engine/index.js';

const SECRET = 'sk-live-SUPERSECRET-000';

const unusedEngine = {
  async createSession() {
    throw new Error('not used by these routes');
  },
} as unknown as EngineService; // structural test double

const unusedSkills = { get: async () => null } as unknown as SkillsService; // test seam

let setCalls: Array<{ path: string; value: unknown }> = [];

/** Settings-capable facade double: 3 credential paths — stored / empty / absent. */
function facadeStub(): OmpFacade {
  return {
    async settingsSchema() {
      return {
        ok: true as const,
        schema: {
          tabs: [{ id: 'providers', label: 'Providers' }],
          groups: {},
          settings: [
            { path: 'ui.theme', type: 'string' },
            { path: 'providers.openai.apiKey', type: 'string', credential: true },
            { path: 'providers.empty.apiKey', type: 'string', credential: true },
            { path: 'providers.absent.apiKey', type: 'string', credential: true },
          ],
        },
      };
    },
    async settingsGet() {
      return {
        ok: true as const,
        values: {
          'ui.theme': 'dark',
          'providers.openai.apiKey': SECRET,
          'providers.empty.apiKey': '',
        },
      };
    },
    async settingsSet(path: string, value: unknown) {
      setCalls.push({ path, value });
      return { ok: true as const };
    },
  } as unknown as OmpFacade; // structural test double
}

let server: AetherServer;

beforeEach(async () => {
  setCalls = [];
  const wiring: EngineWiring = {
    engine: unusedEngine,
    loops: new LoopManager(unusedEngine, unusedSkills),
    skills: unusedSkills,
    facade: facadeStub(),
  };
  server = new AetherServer({
    port: 0,
    host: '127.0.0.1',
    engine: wiring,
    workspaces: new WorkspacesService(),
  });
  await server.start();
});

afterEach(async () => {
  await server.stop();
});

const base = () => `http://127.0.0.1:${server.getPort()}`;

describe('GET /api/omp/settings/values credential redaction', () => {
  it('never echoes the stored secret and answers a true presence marker', async () => {
    const res = await fetch(`${base()}/api/omp/settings/values`);
    expect(res.status).toBe(200);
    const body = await res.text();
    // Discriminator: pre-fix this returned the raw secret verbatim.
    expect(body).not.toContain(SECRET);
    const { values } = JSON.parse(body) as { values: Record<string, unknown> };
    expect(values['providers.openai.apiKey']).toBe(true);
  });

  it('marks empty values false and absent credential paths false too', async () => {
    const res = await fetch(`${base()}/api/omp/settings/values`);
    const { values } = (await res.json()) as { values: Record<string, unknown> };
    expect(values['providers.empty.apiKey']).toBe(false);
    expect(values['providers.absent.apiKey']).toBe(false);
  });

  it('leaves non-credential values untouched', async () => {
    const res = await fetch(`${base()}/api/omp/settings/values`);
    const { values } = (await res.json()) as { values: Record<string, unknown> };
    expect(values['ui.theme']).toBe('dark');
  });
});

describe('PUT /api/omp/settings write passthrough', () => {
  it('forwards the real credential value to the facade unchanged', async () => {
    const res = await fetch(`${base()}/api/omp/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'providers.openai.apiKey', value: SECRET }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, path: 'providers.openai.apiKey' });
    // Discriminator: redaction must be read-only — the WRITE path persists the
    // real secret, so making the write path redact breaks this assert.
    expect(setCalls).toEqual([{ path: 'providers.openai.apiKey', value: SECRET }]);
  });
});
