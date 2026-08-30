/**
 * Engine route cwd contracts (HTTP level):
 *  - POST /api/loops must persist the VALIDATED workspace path, not fall back
 *    to the backend's process cwd (/app in Docker).
 *  - GET /api/omp/sessions accepts an optional ?cwd= scope and validates it
 *    against the workspace roots like every other cwd consumer.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
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
