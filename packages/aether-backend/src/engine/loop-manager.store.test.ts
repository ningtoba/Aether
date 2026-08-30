/**
 * LoopManager persistence integrity:
 *  - persist() is ATOMIC: the JSON goes to `loops.json.tmp` first and only a
 *    renameSync publishes it — a crash mid-write can no longer truncate the
 *    store to half a JSON document (which a previous boot then treated as
 *    corrupt).
 *  - a corrupt store is QUARANTINED (renamed to `loops.json.corrupt-<ISO>`,
 *    reported once) and the process keeps serving an empty store — the file
 *    is never silently overwritten by the next save.
 *  - ONE invalid entry is skipped loudly; the healthy majority survives. The
 *    guard now enforces transition.kind ∈ the four kinds, an integer ≥1
 *    maxRounds, string skillName/args, and an absolute cwd when present.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock, MockInstance } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Wrap (call-through) exactly the two functions whose ORDER proves atomicity;
// everything else (mkdtemp/read/readdir…) stays the real filesystem.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    writeFileSync: vi.fn(actual.writeFileSync),
    renameSync: vi.fn(actual.renameSync),
  };
});
// The named imports below observe the SAME mock wrappers (they ARE the
// module's exports after the mock factory runs).
import { renameSync, writeFileSync as writeFileSyncObserved } from 'node:fs';

import { LoopManager } from './loop-manager.js';
import type { EngineService } from './engine-service.js';
import type { SkillsService } from './skills.js';
import type { LoopDefinition } from './types.js';

/** Call-through vi.fn wrappers exported by the node:fs mock (see factory). */
const writeObserved = writeFileSyncObserved as unknown as Mock;
const renameObserved = renameSync as unknown as Mock;

const fakeEngine = {
  async createSession() {
    throw new Error('unused by store tests');
  },
  async disposeSession() {
    return true;
  },
} as unknown as EngineService; // structural test double
const fakeSkills = { get: async () => null } as unknown as SkillsService; // test seam

function def(id: string): LoopDefinition {
  return {
    id,
    name: `loop ${id}`,
    prompt: 'do a thing',
    transition: { kind: 'none' },
    cwd: '/abs/path/for/writes',
    model: { provider: 'p', modelId: 'm' },
  };
}

let dir: string;
let errSpy: MockInstance;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aether-loops-store-'));
  // The store tests deliberately trigger the loud paths; silence + count.
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  errSpy.mockRestore();
  rmSync(dir, { recursive: true, force: true });
});

/** Raw store entry shapes for the load-path tests (JSON is unknown). */
function seededStore(entries: unknown[]): void {
  writeFileSync(join(dir, 'loops.json'), JSON.stringify(entries));
}

function validRaw(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    name: `loop ${id}`,
    prompt: 'do a thing',
    transition: { kind: 'none' },
    cwd: '/abs/path/loaded',
    model: { provider: 'p', modelId: 'm' },
    ...over,
  };
}

describe('LoopManager atomic persist', () => {
  it('writes loops.json.tmp and publishes it via renameSync', () => {
    const store = join(dir, 'loops.json');
    const manager = new LoopManager(fakeEngine, fakeSkills, { storeDir: dir });
    manager.save(def('persisted'));

    // The write NEVER targets the final path directly, and the final path is
    // only ever produced by a rename from the temp file.
    const writes = writeObserved.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(writes).toContain(`${store}.tmp`);
    expect(writes).not.toContain(store);
    expect(renameObserved).toHaveBeenCalledWith(`${store}.tmp`, store);

    // Call-through kept the real effect: content is readable and the temp
    // file is gone (renamed, not copied).
    expect(JSON.parse(readFileSync(store, 'utf8'))[0].id).toBe('persisted');
    expect(existsSync(`${store}.tmp`)).toBe(false);
  });
});

describe('LoopManager corrupt-store quarantine', () => {
  it('renames the corrupt store, reports once, and serves an empty store', () => {
    const store = join(dir, 'loops.json');
    const garbage = '{ "loops": [truncated mid-write';
    writeFileSync(store, garbage);

    const manager = new LoopManager(fakeEngine, fakeSkills, { storeDir: dir });

    expect(manager.list()).toEqual([]);
    expect(existsSync(store)).toBe(false);
    const quarantined = readdirSync(dir).filter((f) => f.startsWith('loops.json.corrupt-'));
    expect(quarantined).toHaveLength(1);
    // Colon-stripped ISO timestamp: legal filename on Windows too.
    expect(quarantined[0]).toMatch(
      /^loops\.json\.corrupt-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/,
    );
    // Evidence PRESERVED, not overwritten by the next persist.
    expect(readFileSync(join(dir, quarantined[0]), 'utf8')).toBe(garbage);
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(String(errSpy.mock.calls[0][0])).toMatch(/corrupt/);

    // A later save starts a FRESH valid store; the quarantine is untouched.
    manager.save(def('fresh'));
    expect(JSON.parse(readFileSync(store, 'utf8'))[0].id).toBe('fresh');
    expect(readFileSync(join(dir, quarantined[0]), 'utf8')).toBe(garbage);
  });

  it('quarantains a valid-JSON-but-not-array store too', () => {
    const store = join(dir, 'loops.json');
    writeFileSync(store, JSON.stringify({ loops: [] }));
    const manager = new LoopManager(fakeEngine, fakeSkills, { storeDir: dir });
    expect(manager.list()).toEqual([]);
    expect(readdirSync(dir).some((f) => f.startsWith('loops.json.corrupt-'))).toBe(true);
  });
});

describe('LoopManager per-entry store validation', () => {
  it('skips ONLY the invalid entries, loudly, and keeps the rest', () => {
    seededStore([
      validRaw('good'),
      validRaw('bad-kind', { transition: { kind: 'teleport' } }),
      validRaw('no-transition', { transition: undefined }),
      validRaw('bad-args', { transition: { kind: 'skill', args: 42 } }),
      validRaw('bad-maxrounds', { maxRounds: 0 }),
      validRaw('float-maxrounds', { maxRounds: 1.5 }),
      validRaw('relative-cwd', { cwd: 'relative/dir' }),
      // Absent cwd MIRRORS start()'s rule: the entry loads, and start() is
      // the component that refuses it with the actionable GUI message.
      (() => {
        const { cwd: _cwd, ...noCwd } = validRaw('absent-cwd');
        return noCwd;
      })(),
    ]);

    const manager = new LoopManager(fakeEngine, fakeSkills, { storeDir: dir });

    expect(manager.list().map((l) => l.id)).toEqual(['good', 'absent-cwd']);
    // One console.error per skipped entry — six (8 seeded, 2 valid).
    expect(errSpy).toHaveBeenCalledTimes(6);
  });

  it('a store with ONLY corrupt entries still yields an empty (not crashed) manager', () => {
    seededStore([{ id: 'no-model', prompt: 'p', transition: { kind: 'none' } }]);
    const manager = new LoopManager(fakeEngine, fakeSkills, { storeDir: dir });
    expect(manager.list()).toEqual([]);
    expect(errSpy).toHaveBeenCalledTimes(1);
  });
});
