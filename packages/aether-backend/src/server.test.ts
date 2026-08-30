import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AetherServer } from './server.js';

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

    it('should register all provider routes', () => {
      const router = (server as any).router;
      expect(router.match('GET', '/api/providers')).not.toBeNull();
      expect(router.match('POST', '/api/providers')).not.toBeNull();
      expect(router.match('GET', '/api/providers/test/health')).not.toBeNull();
      expect(router.match('DELETE', '/api/providers/test')).not.toBeNull();
    });

    it('should register all execution routes', () => {
      const router = (server as any).router;
      expect(router.match('GET', '/api/executions')).not.toBeNull();
      expect(router.match('POST', '/api/executions')).not.toBeNull();
      expect(router.match('GET', '/api/executions/test-id')).not.toBeNull();
      expect(router.match('POST', '/api/executions/test-id/cancel')).not.toBeNull();
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
    for (const p of ['/api/omp/providers', '/api/omp/agents', '/api/omp/skills']) {
      expect(permissionFor('GET', p)).toEqual({ resource: 'agents:*', action: 'read' });
    }
    // Disk-reading session routes get their OWN resource (viewer holds
    // agents:*/system:* read and must NOT slurp raw transcripts):
    for (const p of ['/api/omp/sessions', '/api/omp/sessions/read']) {
      expect(permissionFor('GET', p)).toEqual({ resource: 'sessions:*', action: 'read' });
    }
    // The pre-existing six mappings stay byte-identical:
    expect(permissionFor('GET', '/api/agents')).toEqual({ resource: 'agents:*', action: 'read' });
    expect(permissionFor('POST', '/api/agents')).toEqual({ resource: 'agents:*', action: 'write' });
    expect(permissionFor('GET', '/api/providers')).toEqual({
      resource: 'providers:config',
      action: 'read',
    });
    expect(permissionFor('POST', '/api/providers')).toEqual({
      resource: 'providers:config',
      action: 'write',
    });
    expect(permissionFor('GET', '/api/executions')).toEqual({
      resource: 'agents:*',
      action: 'read',
    });
    expect(permissionFor('POST', '/api/executions/e1/cancel')).toEqual({
      resource: 'agents:*',
      action: 'execute',
    });
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
