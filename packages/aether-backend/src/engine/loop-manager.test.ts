/**
 * LoopManager cwd contract: LoopDefinition.cwd is required and the save route
 * always persists the WorkspacesService-validated absolute path. A blank or
 * relative cwd in the store therefore means corruption or a legacy entry —
 * start() must fail LOUDLY and must not create a session. The old
 * `cwd || process.cwd()` fallback silently ran such loops in /app under
 * Docker (the backend's own source tree), which is exactly the silent
 * wrong-directory behavior this guard removes.
 */
import { describe, it, expect } from 'vitest';
import { LoopManager } from './loop-manager.js';
import type { EngineService, EngineSession } from './engine-service.js';
import type { SkillsService } from './skills.js';
import type { LoopDefinition, LoopEvent } from './types.js';

const fakeSkills = { get: async () => null } as unknown as SkillsService; // test seam

/** Session stand-in: any method resolves immediately; no thenable trap. */
function fakeSession(): EngineSession {
  return new Proxy(() => undefined, {
    get: (_t, prop) => {
      if (prop === 'then') return undefined; // never awaitable by accident
      if (prop === 'id') return 'ses_fake';
      if (prop === 'status') return 'idle';
      if (prop === 'messageCount') return 0;
      return async () => ({});
    },
  }) as unknown as EngineSession; // structural test double
}

function fakeEngine(
  recorded: string[],
  disposes: string[] = [],
  session: EngineSession = fakeSession(),
  onDispose?: (id: string) => void,
): EngineService {
  return {
    async createSession(opts: { cwd: string }) {
      recorded.push(opts.cwd);
      return session;
    },
    async disposeSession(id: string) {
      disposes.push(id);
      onDispose?.(id);
      return true;
    },
  } as unknown as EngineService; // structural test double
}

function loopDef(id: string, cwd: string): LoopDefinition {
  return {
    id,
    name: `loop ${id}`,
    prompt: 'do a thing',
    transition: { kind: 'none' },
    maxRounds: 1,
    cwd,
    model: { provider: 'p', modelId: 'm' },
  };
}

/** Resolve when the loop reaches a terminal event (no wall-clock guessing). */
function terminalEvent(manager: LoopManager, id: string): Promise<LoopEvent> {
  const { promise, resolve } = Promise.withResolvers<LoopEvent>();
  const previous = manager.onBroadcast;
  manager.onBroadcast = (ev: LoopEvent) => {
    previous?.(ev);
    if (ev.loopId === id && (ev.kind === 'loop:completed' || ev.kind === 'loop:stop')) {
      resolve(ev);
    }
  };
  return promise;
}

describe('LoopManager cwd contract', () => {
  it('refuses to start a blank-cwd definition instead of using process.cwd()', async () => {
    const recorded: string[] = [];
    const manager = new LoopManager(fakeEngine(recorded), fakeSkills);
    manager.save(loopDef('blank', ''));
    // Discriminator: pre-fix this started on process.cwd() (=/app in Docker).
    await expect(manager.start('blank')).rejects.toThrow(/working directory/);
    expect(recorded).toEqual([]);
  });

  it('refuses a relative cwd from a corrupt store entry', async () => {
    const recorded: string[] = [];
    const manager = new LoopManager(fakeEngine(recorded), fakeSkills);
    manager.save(loopDef('relative', 'some/relative/dir'));
    await expect(manager.start('relative')).rejects.toThrow(/working directory/);
    expect(recorded).toEqual([]);
  });

  it('starts an absolute definition.cwd verbatim (no rewriting, no defaults)', async () => {
    const recorded: string[] = [];
    const manager = new LoopManager(fakeEngine(recorded), fakeSkills);
    manager.save(loopDef('explicit', '/home/user/projects/app'));
    const done = terminalEvent(manager, 'explicit');
    await manager.start('explicit');
    await done;
    expect(recorded).toEqual(['/home/user/projects/app']);
  });
});

/** Session double whose prompt resolves and yields a real last text, so the
 *  runner reaches a genuine 'completed' (the generic Proxy double trips the
 *  summary read and lands on an errored round instead). */
function completingSession(): EngineSession {
  return {
    id: 'ses_fake',
    status: 'idle',
    lastAssistantText: 'done',
    prompt: async () => {},
    compact: async () => {},
  } as unknown as EngineSession; // structural test double
}

/**
 * The loop OWNS the session it creates — every terminal path of a run must
 * dispose it. Pre-fix each loop start leaked one live omp session + its
 * subscription (per-loop-start session leak).
 */
describe('LoopManager session disposal', () => {
  it('disposes the loop session when the runner completes normally', async () => {
    const disposes: string[] = [];
    // Awaiting the real dispose event, not a timer: if the dispose is missing
    // the promise never settles and the vitest test timeout fails the test.
    const disposed = Promise.withResolvers<void>();
    const manager = new LoopManager(
      fakeEngine([], disposes, completingSession(), () => disposed.resolve()),
      fakeSkills,
    );
    manager.save(loopDef('dispose-done', '/tmp/aether-test-dispose-done'));
    await manager.start('dispose-done');
    await disposed.promise;
    expect(disposes).toContain('ses_fake');
    expect(manager.progressOf('dispose-done')?.status).toBe('completed');
  });

  it('disposes the loop session when runner.start() rejects', async () => {
    const disposes: string[] = [];
    const disposed = Promise.withResolvers<void>();
    const boomSkills = {
      get: async () => {
        throw new Error('skill store offline');
      },
    } as unknown as SkillsService; // test seam — makes the skill transition reject
    const manager = new LoopManager(
      fakeEngine([], disposes, completingSession(), () => disposed.resolve()),
      boomSkills,
    );
    manager.save({
      ...loopDef('dispose-reject', '/tmp/aether-test-dispose-reject'),
      maxRounds: 2, // the transition must be reached: round 1 is NOT final
      transition: { kind: 'skill', skillName: 'boom' },
    });
    await manager.start('dispose-reject');
    await disposed.promise;
    expect(disposes).toContain('ses_fake');
  });

  it('disposes the loop session on manual stop while a round is still in flight', async () => {
    const disposes: string[] = [];
    const gate = Promise.withResolvers<void>();
    const stalled = {
      id: 'ses_fake',
      status: 'idle',
      lastAssistantText: '',
      prompt: () => gate.promise,
      compact: async () => {},
    } as unknown as EngineSession; // structural test double
    const manager = new LoopManager(fakeEngine([], disposes, stalled), fakeSkills);
    manager.save({
      ...loopDef('dispose-stop', '/tmp/aether-test-dispose-stop'),
      maxRounds: undefined, // indefinite: only stop() can end this run
    });
    await manager.start('dispose-stop');
    // Round 1 is awaiting the never-resolving prompt: the void chain has NOT
    // settled, so only stop()'s own dispose can satisfy this assertion.
    await manager.stop('dispose-stop');
    expect(disposes).toContain('ses_fake');
    gate.resolve(); // let the round end so the chain settles cleanly
  });
});
