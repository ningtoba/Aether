/**
 * Execution routes are a pure in-memory SIMULATION (no engine, no process,
 * no I/O is ever started): every response object must carry
 * `simulated: true` so the GUI can never present these records as real
 * execution. This pins the marker on every response shape — create, get,
 * list, cancel — and on the timer-advanced 'completed' state as well.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AetherServer } from '../server.js';
import type { EngineWiring } from '../server.js';
import { LoopManager } from '../engine/loop-manager.js';
import { WorkspacesService } from '../engine/workspaces.js';
import type { EngineService, SkillsService, OmpFacade } from '../engine/index.js';

interface Simulated {
  simulated?: unknown;
  status?: string;
}

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

beforeAll(async () => {
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
});

afterAll(async () => {
  await server.stop();
});

const base = () => `http://127.0.0.1:${server.getPort()}`;

async function startExecution(body: Record<string, unknown>): Promise<Simulated & { id: string }> {
  const res = await fetch(`${base()}/api/executions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(201);
  const { execution } = (await res.json()) as { execution: Simulated & { id: string } };
  return execution;
}

describe('executions simulated marker', () => {
  it('marks the created record simulated on POST', async () => {
    const exec = await startExecution({ agentId: 'a-1', input: { x: 1 } });
    // Discriminator: pre-fix the record claimed bare 'pending' status with
    // nothing telling the client no engine ever accepted it.
    expect(exec.simulated).toBe(true);
    // Cancel so the simulated timer chain has nothing to advance.
    const cancel = await fetch(`${base()}/api/executions/${exec.id}/cancel`, { method: 'POST' });
    expect(cancel.status).toBe(200);
    const { execution } = (await cancel.json()) as { execution: Simulated };
    expect(execution.simulated).toBe(true);
  });

  it('marks every GET-by-id and list entry simulated', async () => {
    const exec = await startExecution({});
    const one = await fetch(`${base()}/api/executions/${exec.id}`);
    expect(one.status).toBe(200);
    const { execution } = (await one.json()) as { execution: Simulated };
    expect(execution.simulated).toBe(true);

    const all = await fetch(`${base()}/api/executions`);
    const { executions } = (await all.json()) as { executions: Simulated[] };
    expect(executions.length).toBeGreaterThan(0);
    for (const e of executions) expect(e.simulated).toBe(true);
    // Leave the timer chain nothing to advance.
    await fetch(`${base()}/api/executions/${exec.id}/cancel`, { method: 'POST' });
  });

  it('keeps the marker through the timer-advanced completed state', async () => {
    const exec = await startExecution({ input: { hi: true } });
    // The whole 'lifecycle' is a 2s timer (setImmediate → running → +2s
    // completed) — no engine exists. Poll past it and assert the completed
    // answer is still flagged as simulation.
    const deadline = Date.now() + 5_000;
    let status = '';
    let execution: Simulated = {};
    while (Date.now() < deadline) {
      const res = await fetch(`${base()}/api/executions/${exec.id}`);
      ({ execution } = (await res.json()) as { execution: Simulated });
      status = execution.status ?? '';
      if (status === 'completed') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(status).toBe('completed');
    expect(execution.simulated).toBe(true);
  }, 10_000);
});
