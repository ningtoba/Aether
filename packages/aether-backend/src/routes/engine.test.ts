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
function stubSession(
  opts: {
    promptImpl?: () => Promise<void>;
    busy?: boolean;
    compactImpl?: () => Promise<boolean>;
  } = {},
) {
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
      // Real EngineSession.compact resolves true only when compaction was
      // initiated; false when omp's busy guard no-oped the call.
      return opts.compactImpl ? opts.compactImpl() : Promise.resolve(true);
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

  it('compact answers 409 when compact() resolves false (omp no-op raced turn)', async () => {
    const stub = stubSession({ compactImpl: () => Promise.resolve(false) });
    await withStubEngine(stub.session, async (base) => {
      const res = await fetch(`${base}/api/sessions/ses_probe/compact`, { method: 'POST' });
      // Pre-fix the route ignored the boolean and answered 200 {ok:true}
      // even though omp skipped the compaction — a dishonest success.
      expect(res.status).toBe(409);
      const body = (await res.json()) as { ok?: boolean; error?: string };
      expect(body.ok).toBeUndefined();
      expect(body.error).toBe('Session ses_probe compact skipped — a turn started; try again');
    });
    expect(stub.calls.compacts).toBe(1);
  });

  it('compact answers 200 ok:true when compact() resolves true', async () => {
    const stub = stubSession({ compactImpl: () => Promise.resolve(true) });
    await withStubEngine(stub.session, async (base) => {
      const res = await fetch(`${base}/api/sessions/ses_probe/compact`, { method: 'POST' });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    });
    expect(stub.calls.compacts).toBe(1);
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

describe('POST /api/loops transition validation', () => {
  it('rejects a transition kind outside none|compact|skill|gate', async () => {
    // Discriminator: pre-fix ANY kind persisted — the runner then silently
    // treated the unknown kind as 'none' (a user-configured gate just… lost).
    const res = await postLoop({ transition: { kind: 'teleport' } });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/transition\.kind/);
    expect(body.error).toContain('gate');
  });

  it('persists skill args verbatim; response shape stays { loop }', async () => {
    const res = await postLoop({
      transition: { kind: 'skill', skillName: 'review', args: 'apply to round {round}' },
    });
    expect(res.status).toBe(201);
    const { loop } = (await res.json()) as {
      loop: { transition: { kind: string; skillName?: string; args?: string } };
    };
    expect(loop.transition).toEqual({
      kind: 'skill',
      skillName: 'review',
      args: 'apply to round {round}',
    });
  });

  it('normalises empty args to undefined (static skill prompt back-compat)', async () => {
    const res = await postLoop({ transition: { kind: 'skill', skillName: 'review', args: '' } });
    expect(res.status).toBe(201);
    const { loop } = (await res.json()) as { loop: { transition: { args?: string } } };
    expect(loop.transition.args).toBeUndefined();
  });

  it('rejects non-string args / skillName instead of storing a poison value', async () => {
    expect((await postLoop({ transition: { kind: 'skill', args: 42 } })).status).toBe(400);
    expect(
      (await postLoop({ transition: { kind: 'skill', skillName: { nested: true } } })).status,
    ).toBe(400);
  });

  it('defaults a missing transition to none (back-compat)', async () => {
    const res = await postLoop({});
    expect(res.status).toBe(201);
    const { loop } = (await res.json()) as { loop: { transition: { kind: string } } };
    expect(loop.transition.kind).toBe('none');
  });
});

/* ─── saveLoop numeric/validation contracts (findings #2, #8, #10, #11) ── */

describe('POST /api/loops maxRounds/maxTimeMs/model validation', () => {
  it('rejects a non-integer maxRounds with the contract 400 instead of persisting poison', async () => {
    // Discriminator: pre-fix {maxRounds: 2.5} persisted 2.5 — and isLoopDefinition
    // then DROPPED the whole loop at next boot (silent disappearance). 0 and
    // negatives silently vanished into undefined (a different lie).
    for (const bad of [2.5, '5', 0, -3, null, NaN]) {
      const res = await postLoop({ maxRounds: bad });
      expect(res.status, `maxRounds=${String(bad)}`).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('maxRounds must be a positive integer');
    }
  });

  it('rejects a non-integer maxTimeMs with its own contract message', async () => {
    const res = await postLoop({ maxTimeMs: 1500.5 });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('maxTimeMs must be a positive integer');
    expect((await postLoop({ maxTimeMs: '60000' })).status).toBe(400);
  });

  it('absent stays allowed (indefinite) and valid integers persist verbatim', async () => {
    const noCap = await postLoop({});
    expect(noCap.status).toBe(201);
    const { loop: plain } = (await noCap.json()) as {
      loop: { maxRounds?: number; maxTimeMs?: number };
    };
    expect(plain.maxRounds).toBeUndefined();
    expect(plain.maxTimeMs).toBeUndefined();

    const capped = await postLoop({ maxRounds: 3, maxTimeMs: 60000 });
    expect(capped.status).toBe(201);
    const { loop } = (await capped.json()) as {
      loop: { maxRounds?: number; maxTimeMs?: number };
    };
    expect(loop.maxRounds).toBe(3);
    expect(loop.maxTimeMs).toBe(60000);
  });

  it('rejects non-string model fields the store guard would drop at next boot', async () => {
    // The old truthiness check let {provider: 5} through; isProviderModel on
    // load demands strings, so the loop vanished on restart.
    const res = await fetch(`http://127.0.0.1:${server.getPort()}/api/loops`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'p', model: { provider: 5, modelId: 'm' } }),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/loops definition cap', () => {
  const base = () => `http://127.0.0.1:${server.getPort()}`;

  it('409s the 65th NEW definition, leaves the store unpolluted, updates stay free', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 64; i++) {
      const res = await postLoop({ name: `cap ${i}` });
      expect(res.status).toBe(201);
      const created = (await res.json()) as { loop: { id: string } };
      ids.push(created.loop.id);
    }

    // Discriminator: pre-fix this was a 201 — definitions were the last
    // unbounded keyed surface, with a full loops.json rewrite per save.
    const over = await postLoop({ name: 'overflow' });
    expect(over.status).toBe(409);
    const overBody = (await over.json()) as { error: string };
    expect(overBody.error).toBe('loop limit reached (64)');

    // Store unpolluted by the rejection.
    const list = (await (await fetch(`${base()}/api/loops`)).json()) as {
      loops: unknown[];
    };
    expect(list.loops).toHaveLength(64);

    // Replacing an existing id is allowed even AT cap.
    const upd = await postLoop({ id: ids[0], name: 'renamed at cap' });
    expect(upd.status).toBe(201);
    const updBody = (await upd.json()) as { loop: { name: string } };
    expect(updBody.loop.name).toBe('renamed at cap');
  });
});

describe('POST /api/loops/:id/advance action validation', () => {
  const advance = (id: string, body: unknown) =>
    fetch(`http://127.0.0.1:${server.getPort()}/api/loops/${id}/advance`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('rejects any action outside continue|stop instead of coercing to continue', async () => {
    // Discriminator: the gate is the human decision point, and pre-fix ANY
    // garbage body ('delet-everything', an absent action, null) silently meant
    // CONTINUE. Pre-fix a ghost id returned 404 here; validation must reject
    // the action BEFORE touching the manager.
    for (const body of [{ action: 'delet-everything' }, {}, { action: null }, { action: 0 }]) {
      const res = await advance('ghost', body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      const errBody = (await res.json()) as { error: string };
      expect(errBody.error).toBe('unknown action');
    }
  });

  it('valid actions keep their behavior (unknown loop still 404s)', async () => {
    expect((await advance('ghost', { action: 'continue' })).status).toBe(404);
    expect((await advance('ghost', { action: 'stop' })).status).toBe(404);
  });
});

/** Third server shape: caller-supplied engine double driving the REAL LoopManager. */
async function withEngineDouble(
  engine: EngineService,
  fn: (base: string) => Promise<void>,
): Promise<void> {
  const wiring: EngineWiring = {
    engine,
    loops: new LoopManager(engine, unusedSkills),
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

describe('loop route error echo policy', () => {
  it('echoes LoopManager-composed guidance verbatim (typed passthrough)', async () => {
    await withEngineDouble(unusedEngine, async (base) => {
      const res = await fetch(`${base}/api/loops/ghost/start`, { method: 'POST' });
      expect(res.status).toBe(500);
      // The GUI prompt depends on this text staying verbatim.
      const guidance = (await res.json()) as { error: string };
      expect(guidance.error).toBe('Loop not found: ghost');
    });
  });

  it('swallows a raw SDK/fs error: logged server-side, fixed message, no paths', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const leaky = {
        createSession: async () => {
          throw new Error('ENOENT: open /home/user/.omp/agent/private.jsonl failed');
        },
        disposeSession: async () => true,
      } as unknown as EngineService;
      await withEngineDouble(leaky, async (base) => {
        const created = (await (
          await fetch(`${base}/api/loops`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ prompt: 'go', model: { provider: 'p', modelId: 'm' } }),
          })
        ).json()) as { loop: { id: string } };
        const res = await fetch(`${base}/api/loops/${created.loop.id}/start`, { method: 'POST' });
        expect(res.status).toBe(500);
        const text = await res.text();
        // Discriminator: handleLoopError used to echo err.message for ANY
        // error — the absolute journal path above was disclosed to the client.
        expect(JSON.parse(text)).toEqual({ error: 'Internal server error' });
        expect(text).not.toContain('private.jsonl');
        expect(text).not.toContain('/home/user');
      });
      expect(errSpy).toHaveBeenCalledWith(
        '[Engine] unexpected loop route failure:',
        expect.any(Error),
      );
    } finally {
      errSpy.mockRestore();
    }
  });
});
