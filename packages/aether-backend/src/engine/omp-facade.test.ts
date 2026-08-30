/**
 * readDiskSession path confinement (arbitrary-file-read fix):
 *  - the pure guard confineSessionPath() accepts ONLY a regular .jsonl whose
 *    realpath stays inside a known omp session root; every rejection is a
 *    bare { ok:false } — no fs message, no path echo (no filesystem oracle).
 *  - the facade wiring is pinned too: OmpFacade.readDiskSession applies the
 *    guard with roots discovered from the SDK's default session dir (and the
 *    standard ~/.omp/agent/sessions fallback), answers the fixed
 *    'session not found', and keeps the success transcript shape unchanged.
 *  - journal reads are BOUNDED (finding #9): a file over the 32 MiB byte cap
 *    is refused BEFORE its content is read (fs-spy proven) and parsing stops
 *    at the 100_000-line cap with `truncated: true`; smaller files keep the
 *    exact pre-cap transcript shape.
 *  - the GET /api/omp/sessions/read route answers 400/404/200 over the real
 *    HTTP surface with zero path echo.
 * Runs under plain Node: the guard is SDK-free and the facade is driven with
 * a stubbed SDK surface + ensure() spy (the Bun-only import stays lazy).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  truncateSync,
  symlinkSync,
  realpathSync,
} from 'node:fs';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { confineSessionPath, OmpFacade } from './omp-facade.js';
import { AetherServer } from '../server.js';
import type { EngineWiring } from '../server.js';
import { LoopManager } from './loop-manager.js';
import { WorkspacesService } from './workspaces.js';
import type { EngineService, SkillsService } from './index.js';

/* node:fs is ESM-frozen (vi.spyOn on the namespace throws), so the byte-cap
 * proof uses a TRANSPARENT module mock: every export passes through to the
 * real implementation untouched; only readFileSync becomes an observable
 * spy-fn with identical behavior. Nothing in this file's graph can tell. */
vi.mock('node:fs', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof fs;
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});

let base: string; // tmp playground
let sessionsRoot: string; // pretend omp sessions root (dirname of the SDK's default project dir)
let projDir: string; // one encoded project dir inside it
let inside: string; // legit session file
let outside: string; // omp-shaped secret file OUTSIDE every session root
let sneaky: string; // session-root symlink → the outside file

const SESSION_JSONL = [
  '{"type":"session","id":"sess-1","name":"Demo"}',
  '{"type":"message","message":{"role":"user","content":"hello world"},"timestamp":"2026-01-01T00:00:00.000Z"}',
  '{"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"hi there"}]}}',
  '',
].join('\n');

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'aether-ompconf-'));
  sessionsRoot = join(base, 'sessions');
  projDir = join(sessionsRoot, '--home-user-proj--');
  mkdirSync(projDir, { recursive: true });
  inside = join(projDir, '2026-01-01_sess-1.jsonl');
  writeFileSync(inside, SESSION_JSONL);
  outside = join(base, 'outside-secret.jsonl'); // SAME extension, outside every root
  writeFileSync(outside, SESSION_JSONL);
  sneaky = join(projDir, 'sneak.jsonl');
  symlinkSync(outside, sneaky);
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

describe('confineSessionPath', () => {
  it('accepts a regular .jsonl inside a session root and returns its realpath', () => {
    expect(confineSessionPath(inside, [sessionsRoot])).toEqual({
      ok: true,
      path: realpathSync(inside),
    });
  });

  it('rejects a valid session file outside every root, with no path echo', () => {
    const r = confineSessionPath(outside, [sessionsRoot]);
    expect(r.ok).toBe(false);
    // The rejection carries nothing but the verdict: no path, no fs text.
    expect(JSON.stringify(r)).not.toContain('outside-secret');
    expect(JSON.stringify(r)).not.toContain(base);
  });

  it('rejects a dot-dot traversal that resolves outside the root', () => {
    const traversed = join(sessionsRoot, '..', 'outside-secret.jsonl');
    expect(confineSessionPath(traversed, [sessionsRoot]).ok).toBe(false);
  });

  it('rejects a symlink inside the root that escapes to the outside file', () => {
    expect(confineSessionPath(sneaky, [sessionsRoot]).ok).toBe(false);
  });

  it('rejects the wrong extension inside the root', () => {
    const note = join(projDir, 'notes.txt');
    writeFileSync(note, SESSION_JSONL);
    expect(confineSessionPath(note, [sessionsRoot]).ok).toBe(false);
  });

  it('rejects a non-regular file named .jsonl inside the root', () => {
    const dir = join(projDir, 'dir.jsonl');
    mkdirSync(dir);
    expect(confineSessionPath(dir, [sessionsRoot]).ok).toBe(false);
  });

  it('rejects a missing file and an empty request with the same fixed answer', () => {
    expect(confineSessionPath(join(projDir, 'ghost.jsonl'), [sessionsRoot]).ok).toBe(false);
    expect(confineSessionPath('', [sessionsRoot]).ok).toBe(false);
  });

  it('confines into no file when the root is empty or missing', () => {
    expect(confineSessionPath(inside, []).ok).toBe(false);
    expect(confineSessionPath(inside, [join(base, 'nope')]).ok).toBe(false);
  });
});

/**
 * The REAL facade under Node: ensure() is spied true and the SDK namespace is
 * faked with just enough SessionManager shape for root discovery — the real
 * SessionManager.getDefaultSessionDir returns join(sessionsRoot,
 * <encoded-cwd>), so the facade must derive `sessionsRoot` as its root.
 */
function wiredFacade(): OmpFacade {
  const f = new OmpFacade();
  vi.spyOn(f, 'ensure').mockResolvedValue(true);
  // Named cast: the private `sdk` slot is a plain runtime property — the
  // facade's capability-gating reads it only through typeof-guarded access.
  const internals = f as unknown as { sdk: unknown };
  internals.sdk = { SessionManager: { getDefaultSessionDir: () => projDir } };
  return f;
}

describe('OmpFacade.readDiskSession confinement (wired)', () => {
  it('rejects a path outside any session root with the fixed not-found', async () => {
    const r = await wiredFacade().readDiskSession(outside);
    // Discriminator: pre-fix this READ the outside file (ok:true + messages).
    expect(r).toEqual({ ok: false, error: 'session not found' });
  });

  it('rejects the symlink-escape with the same fixed answer', async () => {
    const r = await wiredFacade().readDiskSession(sneaky);
    expect(r).toEqual({ ok: false, error: 'session not found' });
    expect(JSON.stringify(r)).not.toContain('outside-secret');
  });

  it('rejects a missing in-root file without an ENOENT oracle', async () => {
    const r = await wiredFacade().readDiskSession(join(projDir, 'ghost.jsonl'));
    // Discriminator: pre-fix this echoed 'read session: ENOENT: ... <abs path>'.
    expect(r).toEqual({ ok: false, error: 'session not found' });
    expect(JSON.stringify(r)).not.toContain('ENOENT');
    expect(JSON.stringify(r)).not.toContain(base);
  });

  it('keeps the success transcript shape unchanged for an in-root session', async () => {
    const r = await wiredFacade().readDiskSession(inside);
    expect(r.ok).toBe(true);
    expect(r.transcript).toEqual({
      id: 'sess-1',
      path: realpathSync(inside),
      name: 'Demo',
      messages: [
        { role: 'user', text: 'hello world', timestamp: '2026-01-01T00:00:00.000Z' },
        { role: 'assistant', text: 'hi there', timestamp: undefined },
      ],
    });
  });
});

describe('GET /api/omp/sessions/read over HTTP', () => {
  const unusedEngine = {
    async createSession() {
      throw new Error('not used by this route');
    },
  } as unknown as EngineService; // structural test double
  const unusedSkills = { get: async () => null } as unknown as SkillsService; // test seam

  let server: AetherServer;

  beforeEach(async () => {
    const wiring: EngineWiring = {
      engine: unusedEngine,
      loops: new LoopManager(unusedEngine, unusedSkills),
      skills: unusedSkills,
      facade: wiredFacade(),
    };
    server = new AetherServer({
      port: 0,
      host: '127.0.0.1',
      engine: wiring,
      workspaces: new WorkspacesService(base),
    });
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
    vi.restoreAllMocks();
  });

  const readUrl = (path: string | null): string => {
    const q = path === null ? '' : `?path=${encodeURIComponent(path)}`;
    return `http://127.0.0.1:${server.getPort()}/api/omp/sessions/read${q}`;
  };

  it('400s an empty path (unchanged contract)', async () => {
    const res = await fetch(readUrl(''));
    expect(res.status).toBe(400);
  });

  it('404s an outside-root path with the fixed body and zero path echo', async () => {
    const res = await fetch(readUrl(outside));
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({ error: 'session not found' });
    expect(body).not.toContain('outside-secret');
    expect(body).not.toContain(base);
  });

  it('200s an in-root session with the unchanged transcript envelope', async () => {
    const res = await fetch(readUrl(inside));
    expect(res.status).toBe(200);
    const { transcript } = (await res.json()) as {
      transcript: { id: string; path: string; name?: string; messages: unknown[] };
    };
    expect(transcript.id).toBe('sess-1');
    expect(transcript.name).toBe('Demo');
    expect(transcript.messages).toHaveLength(2);
  });
});

/* ─── Journal caps (finding #9): bounded sync reads ─────────────────────
 * readDiskSession must never slurp an unbounded journal into the event
 * loop: a stat gates a hard 32 MiB byte cap BEFORE any content is read,
 * and the parse stops at 100_000 entries with `truncated: true` on the
 * transcript. Files under both caps stay byte-identical (pinned above). */

describe('OmpFacade.readDiskSession journal caps', () => {
  const msgLine = (n: number) => `{"type":"message","message":{"role":"user","content":"m${n}"}}`;

  it('refuses a journal over the 32 MiB byte cap without reading its content', async () => {
    const huge = join(projDir, 'huge.jsonl');
    writeFileSync(huge, SESSION_JSONL);
    truncateSync(huge, 32 * 1024 * 1024 + 1); // sparse grow: instant, no 32 MiB write
    const readSpy = vi.mocked(fs.readFileSync);
    readSpy.mockClear();
    const f = wiredFacade();
    const r = await f.readDiskSession(huge);
    // Discriminator: pre-fix this readFileSync'd the ENTIRE oversized file.
    expect(r).toEqual({ ok: false, error: 'session transcript too large' });
    const hugePath = realpathSync(huge);
    expect(readSpy.mock.calls.some((c) => String(c[0]) === hugePath)).toBe(false);
    expect(JSON.stringify(r)).not.toContain(base); // fixed message, no path oracle
    // Non-vacuity: the SAME spy observes a normal read, so its absence
    // above is real evidence the oversized file was never opened.
    const ok = await f.readDiskSession(inside);
    expect(ok.ok).toBe(true);
    expect(readSpy.mock.calls.some((c) => String(c[0]) === realpathSync(inside))).toBe(true);
  });

  it('stops parsing at the 100_000-line cap and flags the transcript truncated', async () => {
    const many = join(projDir, 'many.jsonl');
    // 100_001 entries ≈ 6.4 MB: one over the line cap, under the byte cap —
    // only the line cap can be what bites here.
    writeFileSync(many, Array.from({ length: 100_001 }, (_, i) => msgLine(i + 1)).join('\n'));
    const r = await wiredFacade().readDiskSession(many);
    // Discriminator: pre-fix ALL 100_001 lines parsed and no flag existed.
    expect(r.ok).toBe(true);
    expect(r.transcript!.messages).toHaveLength(100_000);
    expect(r.transcript!.messages.at(-1)!.text).toBe('m100000');
    expect(r.transcript!.truncated).toBe(true);
  });

  it('does NOT flag a journal of exactly the line cap (boundary is >, not >=)', async () => {
    const exact = join(projDir, 'exact.jsonl');
    writeFileSync(exact, Array.from({ length: 100_000 }, (_, i) => msgLine(i + 1)).join('\n'));
    const r = await wiredFacade().readDiskSession(exact);
    // Discriminator: an off-by-one (>=) cap drops/flags this last entry.
    expect(r.ok).toBe(true);
    expect(r.transcript!.messages).toHaveLength(100_000);
    expect(r.transcript!.messages.at(-1)!.text).toBe('m100000');
    expect(r.transcript!.truncated).toBeUndefined();
  });

  it('keeps the truncated key OFF small-file transcripts (byte-identical shape)', async () => {
    const r = await wiredFacade().readDiskSession(inside);
    expect(r.ok).toBe(true);
    // Discriminator: an always-present `truncated: false` would break the
    // existing strict-shape pin above AND this key-set check.
    expect(Object.keys(r.transcript!)).not.toContain('truncated');
  });
});
