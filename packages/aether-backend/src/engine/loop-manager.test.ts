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
import { LoopLimitError, LoopManager, MAX_LOOP_DEFINITIONS } from './loop-manager.js';
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

/**
 * start() reserves the loop slot BEFORE awaiting createSession: two
 * concurrent calls (GUI double-click, client retry) used to both pass the
 * runners.has(id) guard and leave the loop with TWO live runners and two
 * omp sessions. A rejected createSession must also release the reservation
 * so the loop is startable again, and a construction failure after session
 * creation must dispose the session (no leak) rather than strand the slot.
 */
describe('LoopManager start race', () => {
  it('rejects the second of two concurrent starts and creates exactly one session', async () => {
    const gate = Promise.withResolvers<EngineSession>();
    let creates = 0;
    const engine = {
      async createSession() {
        creates++;
        return gate.promise; // hold both starts inside the await window
      },
      async disposeSession() {
        return true;
      },
    } as unknown as EngineService; // structural test double
    const manager = new LoopManager(engine, fakeSkills);
    manager.save(loopDef('race', '/tmp/aether-test-race'));

    const first = manager.start('race');
    const second = manager.start('race');
    // Discriminator: pre-fix BOTH resolved (runners set twice after the await).
    await expect(second).rejects.toThrow(/Loop already running/);

    gate.resolve(completingSession());
    await first;
    expect(creates).toBe(1);
    // No orphan: exactly one runner is tracked — the first call's.
    expect(manager.listProgress()).toHaveLength(1);
  });

  it('releases the reservation when createSession rejects, so a retry can start', async () => {
    let attempt = 0;
    const engine = {
      async createSession() {
        attempt++;
        if (attempt === 1) throw new Error('provider down');
        return completingSession();
      },
      async disposeSession() {
        return true;
      },
    } as unknown as EngineService; // structural test double
    const manager = new LoopManager(engine, fakeSkills);
    manager.save(loopDef('retry', '/tmp/aether-test-retry'));

    await expect(manager.start('retry')).rejects.toThrow('provider down');
    const progress = await manager.start('retry'); // slot must be free again
    expect(attempt).toBe(2);
    expect(progress.totalRounds).toBe(0);
  });

  it('disposes the session and frees the slot when runner construction fails', async () => {
    const disposes: string[] = [];
    const engine = {
      async createSession() {
        return completingSession();
      },
      async disposeSession(id: string) {
        disposes.push(id);
        return true;
      },
    } as unknown as EngineService; // structural test double
    const manager = new LoopManager(engine, fakeSkills);
    // LoopRunner's constructor rejects a blank prompt — this fires AFTER
    // createSession resolved, so the session must be disposed by the start
    // failure path itself (pre-fix it leaked, and the slot logic had no
    // ownership contract at all).
    manager.save({ ...loopDef('badprompt', '/tmp/aether-test-badprompt'), prompt: '   ' });
    await expect(manager.start('badprompt')).rejects.toThrow(/Loop prompt is required/);
    expect(disposes).toContain('ses_fake');

    // Slot released: the SAME id starts cleanly once the definition is fixed.
    manager.save({ ...loopDef('badprompt', '/tmp/aether-test-badprompt'), prompt: 'work' });
    const done = terminalEvent(manager, 'badprompt');
    await manager.start('badprompt');
    await done;
    expect(manager.progressOf('badprompt')?.status).toBe('completed');
  });
});

/**
 * Definitions are the LAST unbounded keyed surface (sessions ≤64, providers
 * ≤500): every save() rewrites the whole loops.json, so uncapped POSTs meant
 * unbounded memory + O(n²) write amplification. MAX_LOOP_DEFINITIONS caps
 * NEW inserts only — an existing id stays editable even at/over cap, and a
 * rejected save must leave memory (and the store) untouched.
 */
describe('LoopManager definition cap', () => {
  function seeded(count = MAX_LOOP_DEFINITIONS): LoopManager {
    const manager = new LoopManager(fakeEngine([]), fakeSkills);
    for (let i = 0; i < count; i++) {
      manager.save(loopDef(`cap-${i}`, '/tmp/aether-cap'));
    }
    return manager;
  }

  it('refuses a NEW definition at cap with LoopLimitError, store untouched', () => {
    const manager = seeded();
    expect(manager.list()).toHaveLength(MAX_LOOP_DEFINITIONS);

    // Discriminator: pre-fix save() had no bound — this succeeded and the
    // store grew without limit.
    expect(() => manager.save(loopDef('cap-overflow', '/tmp/aether-cap'))).toThrow(LoopLimitError);
    try {
      manager.save(loopDef('cap-overflow', '/tmp/aether-cap'));
    } catch (err) {
      expect(err).toBeInstanceOf(LoopLimitError);
      expect((err as Error).message).toBe(`loop limit reached (${MAX_LOOP_DEFINITIONS})`);
    }

    expect(manager.list()).toHaveLength(MAX_LOOP_DEFINITIONS);
    expect(manager.get('cap-overflow')).toBeUndefined();
  });

  it('replacing an existing id always works, even at cap', () => {
    const manager = seeded();
    const renamed = { ...loopDef('cap-0', '/tmp/aether-cap'), name: 'renamed at cap' };
    const saved = manager.save(renamed);
    expect(saved.name).toBe('renamed at cap');
    expect(manager.get('cap-0')?.name).toBe('renamed at cap');
    // Replace, not grow.
    expect(manager.list()).toHaveLength(MAX_LOOP_DEFINITIONS);
  });
});
