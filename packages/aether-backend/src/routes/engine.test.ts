/**
 * Engine route cwd contracts (HTTP level):
 *  - POST /api/loops must persist the VALIDATED workspace path, not fall back
 *    to the backend's process cwd (/app in Docker).
 *  - GET /api/omp/sessions accepts an optional ?cwd= scope and validates it
 *    against the workspace roots like every other cwd consumer.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AetherServer } from '../server.js';
import type { EngineWiring } from '../server.js';
import { LoopManager } from '../engine/loop-manager.js';
import { WorkspacesService } from '../engine/workspaces.js';
import type { EngineService, SkillsService, OmpFacade } from '../engine/index.js';

let root: string; // workspace root (tmp)
let sub: string; // a subdirectory inside it

const unusedEngine = {
  async createSession() {
    throw new Error('not used by these routes');
  },
} as unknown as EngineService; // structural test double

const unusedSkills = { get: async () => null } as unknown as SkillsService; // test seam

let diskCalls: Array<string | undefined> = [];
const facadeStub = {
  async listDiskSessions(cwd?: string) {
    diskCalls.push(cwd);
    return { ok: true as const, sessions: [] };
  },
} as unknown as OmpFacade; // structural test double

let server: AetherServer;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'aether-ws-'));
  sub = join(root, 'project');
  mkdirSync(sub);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

beforeEach(async () => {
  diskCalls = [];
  const loops = new LoopManager(unusedEngine, unusedSkills);
  const wiring: EngineWiring = {
    engine: unusedEngine,
    loops,
    skills: unusedSkills,
    facade: facadeStub,
  };
  server = new AetherServer({
    port: 0,
    host: '127.0.0.1',
    engine: wiring,
    workspaces: new WorkspacesService(root),
  });
  await server.start();
});

afterEach(async () => {
  await server.stop();
});

async function postLoop(body: Record<string, unknown>): Promise<Response> {
  return fetch(`http://127.0.0.1:${server.getPort()}/api/loops`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: 'do a thing', model: { provider: 'p', modelId: 'm' }, ...body }),
  });
}

describe('POST /api/loops cwd persistence', () => {
  it('stores the first workspace root when no cwd is picked', async () => {
    const res = await postLoop({});
    expect(res.status).toBe(201);
    const { loop } = (await res.json()) as { loop: { cwd: string } };
    // Discriminator: pre-fix this persisted process.cwd() (=/app in Docker).
    expect(loop.cwd).toBe(root);
    expect(loop.cwd).not.toBe(process.cwd());
  });

  it('stores the validated picked directory', async () => {
    const res = await postLoop({ cwd: sub });
    expect(res.status).toBe(201);
    const { loop } = (await res.json()) as { loop: { cwd: string } };
    expect(loop.cwd).toBe(sub);
  });

  it('rejects a cwd outside the configured roots', async () => {
    const res = await postLoop({ cwd: '/etc' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/omp/sessions cwd scoping', () => {
  const base = () => `http://127.0.0.1:${server.getPort()}/api/omp/sessions`;

  it('passes no scope when cwd is omitted', async () => {
    const res = await fetch(base());
    expect(res.status).toBe(200);
    expect(diskCalls).toEqual([undefined]);
  });

  it('validates and forwards a workspace-scoped cwd', async () => {
    const res = await fetch(`${base()}?cwd=${encodeURIComponent(sub)}`);
    expect(res.status).toBe(200);
    expect(diskCalls).toEqual([sub]);
  });

  it('rejects a cwd outside the configured roots', async () => {
    const res = await fetch(`${base()}?cwd=${encodeURIComponent('/etc')}`);
    expect(res.status).toBe(400);
    expect(diskCalls).toEqual([]);
  });
});

/* ─── Session prompt/compact safety (fire-and-forget + busy gates) ─────── */

/** Minimal EngineSession double for the prompt/compact/info routes. */
function stubSession(opts: { promptImpl?: () => Promise<void>; busy?: boolean } = {}) {
  const failures: string[] = [];
  const calls = { compacts: 0 };
  const failed = Promise.withResolvers<void>();
  const session = {
    id: 'ses_probe',
    cwd: sub,
    status: opts.busy ? 'running' : 'idle',
    busy: opts.busy ?? false,
    model: { provider: 'p', modelId: 'm' },
    messageCount: 0,
    createdAtMs: 123,
    stats: () => null,
    prompt: () => (opts.promptImpl ? opts.promptImpl() : Promise.resolve()),
    notifyPromptFailure: (cause: string) => {
      failures.push(cause);
      failed.resolve(); // the awaited signal, not a timer
    },
    compact: async () => {
      calls.compacts += 1;
    },
  };
  return { session, failures, calls, failed };
}

/** Second server whose engine double resolves exactly one session. */
async function withStubEngine(
  session: unknown,
  fn: (base: string) => Promise<void>,
): Promise<void> {
  const engine = { getSession: () => session } as unknown as EngineService;
  const wiring: EngineWiring = {
    engine,
    loops: new LoopManager(unusedEngine, unusedSkills),
    skills: unusedSkills,
    facade: facadeStub,
  };
  const srv = new AetherServer({
    port: 0,
    host: '127.0.0.1',
    engine: wiring,
    workspaces: new WorkspacesService(root),
  });
  await srv.start();
  try {
    await fn(`http://127.0.0.1:${srv.getPort()}`);
  } finally {
    await srv.stop();
  }
}

describe('session prompt/compact route safety', () => {
  it('answers 202 and handles a prompt() rejection (no unhandledRejection)', async () => {
    const stub = stubSession({
      promptImpl: () => Promise.reject(new Error('provider exploded')),
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await withStubEngine(stub.session, async (base) => {
        const res = await fetch(`${base}/api/sessions/ses_probe/prompt`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ message: 'hi' }),
        });
        expect(res.status).toBe(202);
        // Pre-fix the dead try/catch around `void session.prompt()` let this
        // rejection escape as an unhandledRejection; the awaited signal below
        // would never settle and this test would die on the vitest timeout.
        await stub.failed.promise;
      });
      expect(stub.failures[0]).toMatch(/provider exploded/);
      // Asserted BEFORE mockRestore — restoring also clears call history.
      expect(errSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Engine] prompt failed on ses_probe'),
      );
    } finally {
      errSpy.mockRestore();
    }
  });

  it('compact returns 409 while the session is busy and never reaches compact()', async () => {
    const stub = stubSession({ busy: true });
    await withStubEngine(stub.session, async (base) => {
      const res = await fetch(`${base}/api/sessions/ses_probe/compact`, { method: 'POST' });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error?: string };
      expect(body.error).toMatch(/busy/);
    });
    expect(stub.calls.compacts).toBe(0);
  });

  it('session summaries stamp createdAt from createdAtMs (exact, stable)', async () => {
    const stub = stubSession();
    await withStubEngine(stub.session, async (base) => {
      const get = async () =>
        (await (await fetch(`${base}/api/sessions/ses_probe`)).json()) as {
          session: { createdAt: string };
        };
      const first = await get();
      const second = await get();
      // createdAtMs = 123 → exact epoch stamp. Pre-fix this was the READ time
      // and drifted between the two GETs.
      expect(first.session.createdAt).toBe('1970-01-01T00:00:00.123Z');
      expect(second.session.createdAt).toBe(first.session.createdAt);
    });
  });
});
