import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AetherServer } from './server.js';
import type { EngineWiring } from './server.js';
import { LoopManager } from './engine/loop-manager.js';
import { WorkspacesService } from './engine/workspaces.js';
import type { EngineService, SkillsService, OmpFacade } from './engine/index.js';
import * as store from './store.js';

describe('AetherServer', () => {
  let server: AetherServer;

  beforeEach(() => {
    server = new AetherServer({ port: 0, host: '127.0.0.1' });
  });

  afterEach(async () => {
    await server.stop();
  });

  describe('initialization', () => {
    it('should be created with default options', () => {
      const s = new AetherServer();
      expect(s).toBeDefined();
    });

    it('should not be running initially', () => {
      expect(server.isRunning()).toBe(false);
    });

    it('should expose WebSocket manager', () => {
      expect(server.ws).toBeDefined();
    });
  });

  describe('start/stop', () => {
    it('should start and listen on the assigned port', async () => {
      await server.start();
      expect(server.isRunning()).toBe(true);
      const port = server.getPort();
      expect(port).toBeGreaterThan(0);
    });

    it('should stop and mark as not running', async () => {
      await server.start();
      expect(server.isRunning()).toBe(true);
      await server.stop();
      expect(server.isRunning()).toBe(false);
    });

    it('should be idempotent on double start', async () => {
      await server.start();
      await server.start(); // second start should resolve immediately
      expect(server.isRunning()).toBe(true);
    });

    it('should be idempotent on double stop', async () => {
      await server.start();
      await server.stop();
      await server.stop(); // should not throw
    });
  });

  describe('CORS', () => {
    it('should default to same-origin only (empty allow-list)', () => {
      // No configured origins → the server must never emit an
      // Access-Control-Allow-Origin header (see the fetch tests below).
      // Internal peek: private field, no runtime accessor exists.
      const { corsOrigins } = server as unknown as { corsOrigins: string[] };
      expect(corsOrigins).toEqual([]);
    });

    it('should allow setting custom origins and mirror them to the WebSocket allow-list', () => {
      server.setCorsOrigins(['http://localhost:3000']);
      // Internal peek: private fields, no runtime accessors exist.
      const { corsOrigins } = server as unknown as { corsOrigins: string[] };
      const { allowedOrigins } = server.ws as unknown as { allowedOrigins: string[] };
      expect(corsOrigins).toEqual(['http://localhost:3000']);
      // websocket.ts upgrades are gated by the same list (existing hook).
      expect(allowedOrigins).toEqual(['http://localhost:3000']);
    });

    it('emits NO Access-Control-Allow-Origin for a foreign Origin preflight by default', async () => {
      await server.start();
      const port = server.getPort()!;
      const res = await fetch(`http://127.0.0.1:${port}/api/agents`, {
        method: 'OPTIONS',
        headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' },
      });
      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
      expect(res.headers.get('access-control-allow-methods')).toBeNull();
    });

    it('emits NO Access-Control-Allow-Origin for a foreign Origin on normal requests', async () => {
      await server.start();
      const port = server.getPort()!;
      const res = await fetch(`http://127.0.0.1:${port}/health`, {
        headers: { Origin: 'https://evil.example' },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });

    it('echoes a configured Origin with Vary: Origin; non-matching origins get nothing', async () => {
      const gui = new AetherServer({
        port: 0,
        host: '127.0.0.1',
        corsOrigins: ['https://gui.example'],
      });
      try {
        await gui.start();
        const port = gui.getPort()!;
        const hit = await fetch(`http://127.0.0.1:${port}/health`, {
          headers: { Origin: 'https://gui.example' },
        });
        expect(hit.status).toBe(200);
        expect(hit.headers.get('access-control-allow-origin')).toBe('https://gui.example');
        expect(hit.headers.get('vary')).toContain('Origin');

        const miss = await fetch(`http://127.0.0.1:${port}/health`, {
          headers: { Origin: 'https://evil.example' },
        });
        expect(miss.status).toBe(200);
        expect(miss.headers.get('access-control-allow-origin')).toBeNull();
        expect(miss.headers.get('access-control-allow-methods')).toBeNull();
      } finally {
        await gui.stop();
      }
    });

    it('denies the literal null origin even when configured', async () => {
      server.setCorsOrigins(['null']);
      await server.start();
      const port = server.getPort()!;
      const res = await fetch(`http://127.0.0.1:${port}/health`, { headers: { Origin: 'null' } });
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });

    it('serves requests without an Origin header unchanged (curl / server-to-server)', async () => {
      await server.start();
      const port = server.getPort()!;
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      expect(res.status).toBe(200);
      expect(await res.json()).toBeTypeOf('object');
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });
  });

  describe('health endpoint', () => {
    it('should have health route registered', () => {
      // Access the router to check routes
      const router = (server as any).router;
      // Try matching the health route
      const match = router.match('GET', '/health');
      expect(match).not.toBeNull();
    });
  });

  describe('API routes', () => {
    it('should register all agent routes', () => {
      const router = (server as any).router;
      expect(router.match('GET', '/api/agents')).not.toBeNull();
      expect(router.match('POST', '/api/agents')).not.toBeNull();
      expect(router.match('GET', '/api/agents/test-id')).not.toBeNull();
      expect(router.match('PUT', '/api/agents/test-id')).not.toBeNull();
      expect(router.match('DELETE', '/api/agents/test-id')).not.toBeNull();
    });

    it('should register the omp provider control plane (legacy CRUD gone)', () => {
      const router = (server as any).router;
      // Clean cutover: the simulated /api/providers in-memory CRUD is deleted
      // — its verbs must no longer match the router table at all.
      expect(router.match('GET', '/api/providers')).toBeNull();
      expect(router.match('POST', '/api/providers')).toBeNull();
      expect(router.match('GET', '/api/providers/test/health')).toBeNull();
      expect(router.match('DELETE', '/api/providers/test')).toBeNull();
      // The replacement family (engine-backed, RBAC providers:config):
      expect(router.match('GET', '/api/omp/providers')).not.toBeNull();
      expect(router.match('PUT', '/api/omp/providers/test/key')).not.toBeNull();
      expect(router.match('DELETE', '/api/omp/providers/test/key')).not.toBeNull();
      expect(router.match('POST', '/api/omp/providers')).not.toBeNull();
      expect(router.match('DELETE', '/api/omp/providers/test')).not.toBeNull();
      expect(router.match('POST', '/api/omp/providers/test/verify')).not.toBeNull();
    });

    it('should return 404 for unknown routes', async () => {
      const router = (server as any).router;
      expect(router.match('GET', '/api/nonexistent')).toBeNull();
    });

    it('should register all omp facade routes', () => {
      const router = (server as any).router;
      expect(router.match('GET', '/api/omp/status')).not.toBeNull();
      expect(router.match('GET', '/api/omp/settings')).not.toBeNull();
      expect(router.match('GET', '/api/omp/settings/values')).not.toBeNull();
      expect(router.match('PUT', '/api/omp/settings')).not.toBeNull();
      expect(router.match('GET', '/api/omp/providers')).not.toBeNull();
      expect(router.match('GET', '/api/omp/agents')).not.toBeNull();
      expect(router.match('GET', '/api/omp/skills')).not.toBeNull();
      expect(router.match('GET', '/api/omp/sessions')).not.toBeNull();
      expect(router.match('GET', '/api/omp/sessions/read')).not.toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// D1: routePermission is TOTAL on /api/* — no registered route may slip
// through a table gap with a null permission (that silently skipped RBAC).
// ---------------------------------------------------------------------------
describe('RBAC route table totality (D1)', () => {
  const server = new AetherServer({ port: 0, host: '127.0.0.1' });

  // Private seam peek, same convention this file already uses for `router`.
  const permissionFor = (method: string, path: string): { resource: string; action: string } =>
    // @ts-expect-error - accessing private method for test
    server.routePermission(method, path);

  it('resolves a concrete permission for EVERY registered /api route', () => {
    const router = (server as any).router;
    const registered: Array<{ method: string; pattern: RegExp }> = router.routes;
    // RegExp built from a STRING pattern escapes forward slashes in .source
    // ('^/api/agents$' comes back as '^\\/api\\/agents$') — normalize before
    // matching, or the enumeration silently sees zero routes.
    const api = registered
      .map((r) => ({ method: r.method, source: r.pattern.source.replace(/\\\//g, '/') }))
      .filter((r) => r.source.startsWith('^/api/'));
    // Anti-vacuity: the real table has ~40 API entries; an empty extraction
    // must never let this guard pass by checking nothing.
    expect(api.length).toBeGreaterThanOrEqual(30);
    for (const entry of api) {
      // Reconstruct a concrete path: ^/api/agents/([^/]+)$ → /api/agents/test-id
      const path = entry.source.slice(1, -1).replace(/\(\[\^\/\]\+\)/g, 'test-id');
      for (const method of [entry.method, 'HEAD']) {
        const perm = permissionFor(method, path);
        expect(perm, `${method} ${path}`).not.toBeNull();
        expect(perm.resource, `${method} ${path} resource`).toBeTruthy();
        expect(perm.action, `${method} ${path} action`).toBeTruthy();
      }
    }
  });

  it('registers the realtime-ticket route', () => {
    const router = (server as any).router;
    expect(router.match('POST', '/api/realtime-ticket')).not.toBeNull();
  });

  it('maps the audit-enumerated routes explicitly', () => {
    expect(permissionFor('GET', '/api/workspaces')).toEqual({
      resource: 'workspaces:*',
      action: 'read',
    });
    expect(permissionFor('GET', '/api/workspaces/browse')).toEqual({
      resource: 'workspaces:*',
      action: 'read',
    });
    expect(permissionFor('GET', '/api/models')).toEqual({ resource: 'system:*', action: 'read' });
    expect(permissionFor('GET', '/api/skills')).toEqual({ resource: 'system:*', action: 'read' });
    expect(permissionFor('GET', '/api/omp/status')).toEqual({
      resource: 'system:*',
      action: 'read',
    });
    for (const p of ['/api/omp/agents', '/api/omp/skills']) {
      expect(permissionFor('GET', p)).toEqual({ resource: 'agents:*', action: 'read' });
    }
    // Provider catalog read moved to the omp family but keeps providers:config.
    expect(permissionFor('GET', '/api/omp/providers')).toEqual({
      resource: 'providers:config',
      action: 'read',
    });
    // Disk-reading session routes get their OWN resource (viewer holds
    // agents:*/system:* read and must NOT slurp raw transcripts):
    for (const p of ['/api/omp/sessions', '/api/omp/sessions/read']) {
      expect(permissionFor('GET', p)).toEqual({ resource: 'sessions:*', action: 'read' });
    }
    // The pre-existing mappings stay byte-identical:
    expect(permissionFor('GET', '/api/agents')).toEqual({ resource: 'agents:*', action: 'read' });
    expect(permissionFor('POST', '/api/agents')).toEqual({ resource: 'agents:*', action: 'write' });
    // The provider control-plane mutations keep the SAME providers:config
    // write mapping the legacy /api/providers POST used (now on /api/omp/*):
    for (const [method, path] of [
      ['PUT', '/api/omp/providers/openai/key'],
      ['DELETE', '/api/omp/providers/openai/key'],
      ['POST', '/api/omp/providers'],
      ['DELETE', '/api/omp/providers/openai'],
      ['POST', '/api/omp/providers/openai/verify'],
    ] as const) {
      expect(permissionFor(method, path)).toEqual({
        resource: 'providers:config',
        action: 'write',
      });
    }
    expect(permissionFor('GET', '/api/sessions')).toEqual({ resource: 'agents:*', action: 'read' });
    expect(permissionFor('POST', '/api/sessions/s1/prompt')).toEqual({
      resource: 'agents:*',
      action: 'execute',
    });
    expect(permissionFor('GET', '/api/loops')).toEqual({ resource: 'agents:*', action: 'read' });
    expect(permissionFor('POST', '/api/loops/l1/start')).toEqual({
      resource: 'agents:*',
      action: 'execute',
    });
    expect(permissionFor('GET', '/api/omp/settings')).toEqual({
      resource: 'settings:*',
      action: 'read',
    });
    expect(permissionFor('PUT', '/api/omp/settings')).toEqual({
      resource: 'settings:*',
      action: 'write',
    });
  });

  it('never returns null: unknown /api/* paths fall back to system:* read/write', () => {
    // This is the fail-open regression: the old table returned null here and
    // handleRequest skipped RBAC entirely.
    expect(permissionFor('GET', '/api/not-yet-listed')).toEqual({
      resource: 'system:*',
      action: 'read',
    });
    expect(permissionFor('HEAD', '/api/not-yet-listed')).toEqual({
      resource: 'system:*',
      action: 'read',
    });
    expect(permissionFor('POST', '/api/not-yet-listed')).toEqual({
      resource: 'system:*',
      action: 'write',
    });
    expect(permissionFor('DELETE', '/api/not-yet-listed')).toEqual({
      resource: 'system:*',
      action: 'write',
    });
    // Ticket mint (POST) rides the total fallback: system:* write.
    expect(permissionFor('POST', '/api/realtime-ticket')).toEqual({
      resource: 'system:*',
      action: 'write',
    });
  });
});

// ---------------------------------------------------------------------------
// 405 Method Not Allowed (path exists, method does not) + uniform 404 shape
// ---------------------------------------------------------------------------
describe('method mismatch (405) and not-found (404) shape', () => {
  let server: AetherServer;
  beforeEach(() => {
    server = new AetherServer({ port: 0, host: '127.0.0.1' });
  });
  afterEach(async () => {
    await server.stop();
  });

  it('answers 405 with an Allow header listing the registered methods', async () => {
    await server.start();
    // /api/agents is registered GET+POST only — DELETE must 405, never 404.
    const res = await fetch(`http://127.0.0.1:${server.getPort()}/api/agents`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(405);
    const methods = (res.headers.get('allow') ?? '')
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean);
    expect(methods).toContain('GET');
    expect(methods).toContain('POST');
    expect(methods).not.toContain('DELETE');
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Method not allowed');
  });

  it('param routes 405 too: POST /api/agents/:id is not registered', async () => {
    await server.start();
    const res = await fetch(`http://127.0.0.1:${server.getPort()}/api/agents/x1`, {
      method: 'POST',
    });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toContain('PUT');
  });

  it('unknown path keeps the uniform 404 body with no path/method echo', async () => {
    await server.start();
    const res = await fetch(`http://127.0.0.1:${server.getPort()}/api/nope?q=1`);
    expect(res.status).toBe(404);
    // Strict shape pin: pre-fix the body reflected `path` and `method` back.
    expect(await res.json()).toEqual({ error: 'Not found' });
  });

  it('sets bounded request/headers timeouts on the HTTP server', async () => {
    await server.start();
    // Internal peek: the http.Server is a private field, no runtime accessor
    // exists (same convention as the `corsOrigins` peek in the CORS block).
    const view = server as unknown as {
      server: { requestTimeout: number; headersTimeout: number };
    };
    expect(view.server.requestTimeout).toBe(30_000);
    expect(view.server.headersTimeout).toBe(10_000);
    // Node clamps headersTimeout above requestTimeout — the pair must hold.
    expect(view.server.requestTimeout).toBeGreaterThanOrEqual(view.server.headersTimeout);
  });

  it('adds Vary: Origin to DENIED cross-origin responses too', async () => {
    await server.start();
    const res = await fetch(`http://127.0.0.1:${server.getPort()}/health`, {
      headers: { Origin: 'https://evil.example' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    // Cache-poisoning guard: the deny decision varies by Origin, so caches
    // must not reuse this ACAO-less response for an allowed Origin.
    expect(res.headers.get('vary')).toContain('Origin');
  });

  it('logs one [http] access line per request: method, pathname, status, ms', async () => {
    await server.start();
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });
    try {
      await fetch(`http://127.0.0.1:${server.getPort()}/health?token=secret123`);
      // Real delay by necessity: the server's 'finish' event fires on Node's
      // real socket-flush path — fake timers cannot drive the http layer.
      await new Promise((r) => setTimeout(r, 20));
    } finally {
      spy.mockRestore();
    }
    const line = logs.find((l) => l.includes('[http]'));
    expect(line).toBeDefined();
    expect(line).toContain('GET /health ');
    expect(line).toContain(' 200 ');
    expect(line).toContain('ms');
    // The query string (possible credential) must never be logged.
    expect(line).not.toContain('token');
    expect(line).not.toContain('secret123');
  });
});

// ---------------------------------------------------------------------------
// POST /api/agents hardening: body shape, name validation, registry cap
// ---------------------------------------------------------------------------
describe('POST /api/agents validation', () => {
  let server: AetherServer;
  beforeEach(() => {
    server = new AetherServer({ port: 0, host: '127.0.0.1' });
  });
  afterEach(async () => {
    await server.stop();
  });

  async function postAgent(body: string): Promise<Response> {
    return fetch(`http://127.0.0.1:${server.getPort()}/api/agents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
  }

  it('rejects non-object JSON bodies with 400 (was a 500 path)', async () => {
    await server.start();
    for (const body of ['null', '[1,2]', '"just-a-string"', '42']) {
      const res = await postAgent(body);
      expect(res.status, body).toBe(400);
    }
  });

  it('rejects non-string, empty and oversized names with 400', async () => {
    await server.start();
    for (const body of ['{"name":{"nested":true}}', '{"name":42}', '{"name":""}']) {
      const res = await postAgent(body);
      expect(res.status, body).toBe(400);
    }
    const long = await postAgent(JSON.stringify({ name: 'x'.repeat(201) }));
    expect(long.status).toBe(400);
    const err = (await long.json()) as { error: string };
    expect(err.error).toBe('Agent name is required');
  });

  it('caps the registry at 500: overflow answers 503 without mutating', async () => {
    await server.start();
    // Seed close to the cap in-process (same module the route reads).
    const seeded: store.AgentId[] = [];
    for (let i = store.listAgents().length; i < 499; i++) {
      seeded.push(store.createAgent({ name: `seed-${i}` }).id);
    }
    try {
      const ok = await postAgent(JSON.stringify({ name: 'fills-to-cap' }));
      expect(ok.status).toBe(201);
      const overflow = await postAgent(JSON.stringify({ name: 'one-too-many' }));
      expect(overflow.status).toBe(503);
      const err = (await overflow.json()) as { error: string };
      expect(err.error).toMatch(/registry full \(500\)/);
      // The rejected POST left the registry untouched at exactly the cap.
      expect(store.listAgents()).toHaveLength(500);
    } finally {
      for (const id of seeded) store.deleteAgent(id);
      for (const a of store.listAgents()) store.deleteAgent(a.id);
    }
  });
});

// ---------------------------------------------------------------------------
// PUT /api/omp/settings schema gate (closes arbitrary-key writes into the
// user's live ~/.omp/agent config). Facade is a structural test double,
// same seam style as routes/facade.test.ts.
// ---------------------------------------------------------------------------
describe('PUT /api/omp/settings schema gate', () => {
  const unusedEngine = {
    async createSession() {
      throw new Error('not used by these routes');
    },
  } as unknown as EngineService; // structural test double

  const unusedSkills = { get: async () => null } as unknown as SkillsService; // test seam

  let setCalls: Array<{ path: string; value: unknown }> = [];
  let schemaOk = true;

  /** Schema double: one def per primitive type + a complex-typed one. */
  function facadeStub(): OmpFacade {
    return {
      async settingsSchema() {
        if (!schemaOk) {
          return { ok: false as const, error: 'settings schema unavailable in this omp version' };
        }
        return {
          ok: true as const,
          schema: {
            tabs: [{ id: 'ui', label: 'UI' }],
            groups: {},
            settings: [
              { path: 'ui.theme', type: 'string' },
              { path: 'tools.bash.timeoutSecs', type: 'number' },
              { path: 'experimental.foo', type: 'boolean' },
              { path: 'agents.modelRoles', type: 'object' },
            ],
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
    schemaOk = true;
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

  async function putSettings(body: unknown): Promise<Response> {
    return fetch(`http://127.0.0.1:${server.getPort()}/api/omp/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('rejects a path absent from the SDK schema with 400 and NEVER writes', async () => {
    // Discriminator: pre-fix any key landed verbatim in ~/.omp/agent config.
    const res = await putSettings({ path: 'arbitrary.attacker.key', value: 'x' });
    expect(res.status).toBe(400);
    const err = (await res.json()) as { error: string };
    expect(err.error).toBe('unknown settings path');
    expect(setCalls).toEqual([]);
  });

  it('rejects obvious primitive type mismatches against the schema type', async () => {
    const num = await putSettings({ path: 'tools.bash.timeoutSecs', value: 'soon' });
    expect(num.status).toBe(400);
    const err = (await num.json()) as { error: string };
    expect(err.error).toBe('settings.value must be number');
    const bool = await putSettings({ path: 'experimental.foo', value: 'yes' });
    expect(bool.status).toBe(400);
    expect(setCalls).toEqual([]);
  });

  it('forwards schema-known paths with matching (or complex) values to the facade', async () => {
    const ok = await putSettings({ path: 'ui.theme', value: 'dark' });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, path: 'ui.theme' });
    // Complex types stay the SDK's deeper concern.
    const complex = await putSettings({ path: 'agents.modelRoles', value: { any: true } });
    expect(complex.status).toBe(200);
    expect(setCalls).toEqual([
      { path: 'ui.theme', value: 'dark' },
      { path: 'agents.modelRoles', value: { any: true } },
    ]);
  });

  it('degrades to 501 when the schema is unavailable (SDK down) — never a blind write', async () => {
    schemaOk = false;
    const res = await putSettings({ path: 'ui.theme', value: 'dark' });
    expect(res.status).toBe(501);
    const err = (await res.json()) as { error: string };
    expect(err.error).toMatch(/unavailable/i);
    expect(setCalls).toEqual([]);
  });
});
