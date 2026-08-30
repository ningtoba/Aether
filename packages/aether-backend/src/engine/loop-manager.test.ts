/**
 * LoopManager cwd contract: a loop definition WITHOUT a cwd must start on the
 * configured defaultCwd (workspace root), never the backend's process cwd —
 * under Docker that fallback silently ran loops in /app while the GUI showed a
 * host directory. An explicit definition.cwd must win over the default.
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

describe('LoopManager cwd resolution', () => {
  it('starts a blank-cwd definition on defaultCwd, not process.cwd()', async () => {
    const recorded: string[] = [];
    const manager = new LoopManager(fakeEngine(recorded), fakeSkills, {
      defaultCwd: '/workspace/root',
    });
    manager.save(loopDef('blank', ''));
    const done = terminalEvent(manager, 'blank');
    await manager.start('blank');
    await done;
    expect(recorded).toEqual(['/workspace/root']);
    // Discriminator: pre-fix this was process.cwd() (=/app in Docker).
    expect(recorded[0]).not.toBe(process.cwd());
  });

  it('prefers an explicit definition.cwd over defaultCwd', async () => {
    const recorded: string[] = [];
    const manager = new LoopManager(fakeEngine(recorded), fakeSkills, {
      defaultCwd: '/workspace/root',
    });
    manager.save(loopDef('explicit', '/home/user/projects/app'));
    const done = terminalEvent(manager, 'explicit');
    await manager.start('explicit');
    await done;
    expect(recorded).toEqual(['/home/user/projects/app']);
  });

  it('falls back to process.cwd() only when no default is configured', async () => {
    const recorded: string[] = [];
    const manager = new LoopManager(fakeEngine(recorded), fakeSkills);
    manager.save(loopDef('nDefault', ''));
    const done = terminalEvent(manager, 'nDefault');
    await manager.start('nDefault');
    await done;
    expect(recorded).toEqual([process.cwd()]);
  });
});
