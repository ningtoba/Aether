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

function fakeEngine(recorded: string[]): EngineService {
  return {
    async createSession(opts: { cwd: string }) {
      recorded.push(opts.cwd);
      return fakeSession();
    },
    async disposeSession() {
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
