import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  statSync,
  symlinkSync,
  rmSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  EngineService,
  EngineSession,
  EngineUnavailableError,
  SessionResumeRejectedError,
  describeUnservedModel,
} from './engine-service.js';
import {
  createSession as createSessionRoute,
  startLoop as startLoopRoute,
} from '../routes/engine.js';
import type { EngineRouteContext } from '../routes/engine.js';
import { ModelsYamlStore, type StoreResult } from './providers-store.js';
import { LoopUserError } from './loop-manager.js';
import type { SessionTurnEvent } from './types.js';

/**
 * Node-safe harness for EngineSession: captures the omp event listener so
 * synthetic frames can be injected directly. Never imports the omp SDK (its
 * native addon is Bun-only), matching the node vitest suite's constraint.
 */
function makeSession(
  opts: {
    emitOnPrompt?: (emit: (ev: Record<string, unknown>) => void) => void;
    onCompact?: () => void;
  } = {},
) {
  const events: SessionTurnEvent[] = [];
  let listener: ((ev: unknown) => void) | null = null;
  let unsubscribeCalls = 0;
  const session = new EngineSession({
    id: 'ses_test',
    cwd: '/tmp',
    onEvent: (ev) => events.push(ev),
  });
  session.attach({
    sessionId: 'omp-session',
    sessionName: 'omp-session',
    model: { provider: 'local-server', id: 'deepseek-ai/DeepSeek-V4-Flash' },
    subscribe: (l) => {
      listener = l;
      return () => {
        unsubscribeCalls += 1;
      };
    },
    subscribeRunState: () => () => {},
    prompt: async () => {
      opts.emitOnPrompt?.((ev) => listener?.(ev));
    },
    compact: async () => {
      opts.onCompact?.();
    },
    dispose: async () => {},
  } as Parameters<EngineSession['attach']>[0]);
  return {
    session,
    events,
    emit: (ev: Record<string, unknown>) => listener?.(ev),
    /** Calls of the unsubscribe fn omp.subscribe() returned. */
    unsubscribes: () => unsubscribeCalls,
  };
}

/** The error annotation appended by EngineSession to every session error. */
const MODEL_TAG = ' — model: local-server/deepseek-ai/DeepSeek-V4-Flash';

/** The assistant message_end omp emits when a turn fails: empty content and
 *  stopReason "error". The real cause rides on `errorMessage`. */
function erroredMessageEnd(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'message_end',
    message: { role: 'assistant', content: [], stopReason: 'error', ...over },
  };
}

function sessionError(events: SessionTurnEvent[]): string | null {
  const err = events.find((e) => e.kind === 'session_error');
  return err !== undefined && 'message' in err ? err.message : null;
}

describe('EngineSession — errored message_end diagnostics', () => {
  it('surfaces the real provider error verbatim, tagged with the model', () => {
    const { session, events, emit } = makeSession();
    emit(
      erroredMessageEnd({
        errorMessage: '404 The model `deepseek-ai/DeepSeek-V4-Flash` does not exist',
      }),
    );
    expect(session.status).toBe('error');
    expect(sessionError(events)).toBe(
      '404 The model `deepseek-ai/DeepSeek-V4-Flash` does not exist' + MODEL_TAG,
    );
    expect(sessionError(events)).not.toMatch(/model may not be available/);
  });

  it('falls back to the availability hint only when omp provides no detail', () => {
    const { events, emit } = makeSession();
    emit(erroredMessageEnd());
    expect(sessionError(events)).toMatch(/model may not be available/);
    expect(sessionError(events)).toContain(MODEL_TAG);
  });

  it('reports the stop category when only stopDetails is available', () => {
    const { events, emit } = makeSession();
    emit(erroredMessageEnd({ stopDetails: { type: 'refusal' } }));
    expect(sessionError(events)).toBe('Turn ended with error (refusal)' + MODEL_TAG);
  });

  it('includes the stopDetails explanation text when present', () => {
    const { events, emit } = makeSession();
    emit(erroredMessageEnd({ stopDetails: { type: 'refusal', explanation: 'sensitive content' } }));
    expect(sessionError(events)).toBe(
      'Turn ended with error (refusal): sensitive content' + MODEL_TAG,
    );
  });

  it('accepts a stopDetails.reason field on providers that use it', () => {
    const { events, emit } = makeSession();
    emit(erroredMessageEnd({ stopDetails: { type: 'stop_reason', reason: 'max tokens reached' } }));
    expect(sessionError(events)).toBe(
      'Turn ended with error (stop_reason): max tokens reached' + MODEL_TAG,
    );
  });

  it('does not error on a healthy assistant message_end', () => {
    const { session, events, emit } = makeSession();
    emit({
      type: 'message_end',
      message: { role: 'assistant', content: [{ type: 'text', text: 'okay' }], stopReason: 'stop' },
    });
    expect(session.status).toBe('idle');
    expect(sessionError(events)).toBeNull();
  });

  it('does not flag a clean thinking-only turn as a failure', async () => {
    const { session, events } = makeSession({
      emitOnPrompt: (emit) =>
        emit({
          type: 'message_update',
          assistantMessageEvent: { type: 'thinking_delta', delta: 'hm' },
        }),
    });
    await session.prompt('hello');
    expect(sessionError(events)).toBeNull();
    expect(session.status).toBe('idle');
  });

  it('still flags a fully silent, error-free turn', async () => {
    const { session, events } = makeSession({ emitOnPrompt: () => {} });
    await session.prompt('hello');
    expect(sessionError(events)).toMatch(/no output/);
    expect(session.status).toBe('error');
  });
});

describe('describeUnservedModel — served-model preflight decision', () => {
  const opts = {
    provider: 'local-server',
    modelId: 'deepseek-ai/DeepSeek-V4-Flash',
    baseUrl: 'http://192.168.1.10:8000/v1',
    servedIds: ['deepseek-ai/DeepSeek-V4-Flash-0731'],
  };

  it('returns null when the model is served', () => {
    expect(
      describeUnservedModel({ ...opts, modelId: 'deepseek-ai/DeepSeek-V4-Flash-0731' }),
    ).toBeNull();
  });

  it('names the unserved model and what the provider DOES serve', () => {
    const problem = describeUnservedModel(opts);
    expect(problem).toContain('local-server/deepseek-ai/DeepSeek-V4-Flash');
    expect(problem).toContain('http://192.168.1.10:8000/v1');
    expect(problem).toContain('`deepseek-ai/DeepSeek-V4-Flash-0731`');
    expect(problem).toMatch(/is not served by the provider/);
  });

  it('handles a provider reporting no served models', () => {
    expect(describeUnservedModel({ ...opts, servedIds: [] })).toContain('(none listed)');
  });
});

/* ─── EngineService live-session cap / disposeAll — mocked omp SDK ─────── */

/**
 * The Bun-only omp SDK is replaced with a minimal in-memory double (the
 * factory means the real package — whose native addon cannot load under plain
 * Node — is never imported). EngineService only touches ModelRegistry,
 * discoverAuthStorage, SessionManager (create/open/getDefaultSessionDir) and
 * createAgentSession, so the full create/resume/dispose/evict lifecycle can
 * be driven here deterministically. The recorder fields back the durability
 * seams below (disk-backed create, confined resume, identity/warning).
 */
const sdk = vi.hoisted(() => ({
  /** Fake omp sessions in creation order (== EngineSession creation order). */
  created: [] as Array<{ label: string; disposed: boolean; compactCalls: number }>,
  /** Prompt body installed while set — lets a test hang a turn on a gate. */
  promptImpl: null as null | (() => Promise<void>),
  /** Labels whose dispose() must throw (resilience probes). */
  failDispose: new Set<string>(),
  /** createAgentSession option objects, recorded per call (persistence seam). */
  createOpts: [] as Array<Record<string, unknown>>,
  /** SessionManager.create() products handed out, in call order. */
  createdManagers: [] as Array<{ tag: string; cwd: string }>,
  /** Paths SessionManager.open() was called with (resume seam). */
  openCalls: [] as string[],
  /** Steers the mock's getDefaultSessionDir: defaultSessionRoots() then
   *  derives the root as this value (no env mutation in tests). */
  sessionsRoot: null as string | null,
  /** When set, the fake omp session reports this as its sessionFile. */
  ompSessionFile: undefined as string | undefined,
  /** When set, createAgentSession returns this as modelFallbackMessage. */
  fallbackMessage: null as string | null,
  /** Remaining ModelRegistry.refresh() failures (transient-startup seam). */
  failRefresh: 0,
  /** Total refresh() calls (shared-attempt pin). */
  refreshCalls: 0,
  /** Catalog the fake registry serves to listModels(). */
  availableModels: [] as Array<Record<string, unknown>>,
}));

vi.mock('@oh-my-pi/pi-coding-agent', () => ({
  discoverAuthStorage: async () => ({ getApiKey: async () => undefined }),
  ModelRegistry: class {
    constructor(_auth: unknown) {}
    async refresh(): Promise<void> {
      sdk.refreshCalls += 1;
      if (sdk.failRefresh > 0) {
        sdk.failRefresh -= 1;
        throw new Error('transient refresh flake');
      }
    }
    find(provider: string, id: string) {
      // No baseUrl → the served-model preflight skips its fetch entirely.
      return { provider, id };
    }
    getAvailable() {
      return sdk.availableModels;
    }
  },
  SessionManager: {
    // Durability contract: in-memory sessions vanish with the process (the
    // pre-durability bug). Any call must fail the test loudly.
    inMemory: (_cwd: string): never => {
      throw new Error('SessionManager.inMemory is banned — sessions must be disk-backed');
    },
    create: (cwd: string) => {
      const manager = { tag: 'create', cwd };
      sdk.createdManagers.push(manager);
      return manager;
    },
    open: async (path: string) => {
      sdk.openCalls.push(path);
      return { tag: 'open', path };
    },
    // The real SDK returns join(sessionsRoot, <encoded-cwd>); mirror just
    // enough for defaultSessionRoots() to derive root === sdk.sessionsRoot.
    getDefaultSessionDir: (_cwd: string) =>
      `${sdk.sessionsRoot ?? '/tmp/aether-test-sessions'}/enc-cwd`,
  },
  createAgentSession: async (opts: Record<string, unknown>) => {
    sdk.createOpts.push(opts);
    const label = `omp_${sdk.created.length}`;
    const omp = {
      label,
      disposed: false,
      compactCalls: 0,
      model: { provider: 'p', id: label },
      subscribe: () => () => {},
      subscribeRunState: () => () => {},
      prompt: async () => {
        const impl = sdk.promptImpl;
        await (impl ? impl() : undefined);
      },
      compact: async () => {
        omp.compactCalls += 1;
      },
      dispose: async () => {
        if (sdk.failDispose.has(label)) throw new Error(`dispose failed: ${label}`);
        omp.disposed = true;
      },
      ...(sdk.ompSessionFile !== undefined ? { sessionFile: sdk.ompSessionFile } : {}),
    };
    sdk.created.push(omp);
    return {
      session: omp,
      ...(sdk.fallbackMessage ? { modelFallbackMessage: sdk.fallbackMessage } : {}),
    };
  },
}));

const MODEL = { provider: 'p', modelId: 'm' };

async function makeCappedEngine(maxLiveSessions?: number): Promise<EngineService> {
  const engine =
    maxLiveSessions === undefined
      ? new EngineService({ force: true })
      : new EngineService({ force: true, maxLiveSessions });
  await engine.start();
  return engine;
}

describe('EngineService — live-session cap (MAX_LIVE_SESSIONS)', () => {
  beforeEach(() => {
    sdk.created.length = 0;
    sdk.promptImpl = null;
    sdk.failDispose.clear();
  });

  it('evicts the oldest non-busy session when the cap is exceeded', async () => {
    const engine = await makeCappedEngine(2);
    const s1 = await engine.createSession({ cwd: '/tmp/a', model: MODEL });
    const s2 = await engine.createSession({ cwd: '/tmp/a', model: MODEL });
    const s3 = await engine.createSession({ cwd: '/tmp/a', model: MODEL });
    expect(engine.listSessions().map((s) => s.id)).toEqual([s2.id, s3.id]);
    expect(engine.getSession(s1.id)).toBeUndefined();
    // Eviction disposes the underlying omp session, not just the map entry.
    expect(sdk.created[0].disposed).toBe(true);
    expect(sdk.created[1].disposed).toBe(false);
  });

  it('never evicts a busy session — the oldest IDLE one goes instead', async () => {
    const engine = await makeCappedEngine(2);
    const gate = Promise.withResolvers<void>();
    sdk.promptImpl = () => gate.promise;
    const s1 = await engine.createSession({ cwd: '/tmp/a', model: MODEL });
    void s1.prompt('hangs');
    // Discriminator #2: prompt() must flip running SYNCHRONOUSLY (before its
    // first await) or the route-level busy gate would keep a race window.
    expect(s1.busy).toBe(true);
    sdk.promptImpl = null;
    const s2 = await engine.createSession({ cwd: '/tmp/a', model: MODEL });
    const s3 = await engine.createSession({ cwd: '/tmp/a', model: MODEL });
    expect(engine.listSessions().map((s) => s.id)).toEqual([s1.id, s3.id]);
    expect(sdk.created[1].disposed).toBe(true); // s2 — oldest non-busy victim
    expect(sdk.created[0].disposed).toBe(false); // busy s1 untouched
    gate.resolve();
  });

  it('allows creation past the cap when every session is busy — warning once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const engine = await makeCappedEngine(1);
      const gate = Promise.withResolvers<void>();
      sdk.promptImpl = () => gate.promise;
      const s1 = await engine.createSession({ cwd: '/tmp/a', model: MODEL });
      void s1.prompt('hangs');
      await engine.createSession({ cwd: '/tmp/a', model: MODEL });
      const s2 = engine.listSessions().at(-1)!;
      void s2.prompt('hangs');
      await engine.createSession({ cwd: '/tmp/a', model: MODEL });
      expect(engine.listSessions().length).toBe(3); // creation never failed
      expect(warn).toHaveBeenCalledTimes(1); // loud, but only once
      gate.resolve();
    } finally {
      warn.mockRestore();
    }
  });

  it('takes the cap from MAX_LIVE_SESSIONS when no constructor override is given', async () => {
    process.env.MAX_LIVE_SESSIONS = '1';
    let engine: EngineService;
    try {
      engine = new EngineService({ force: true });
    } finally {
      delete process.env.MAX_LIVE_SESSIONS;
    }
    await engine.start();
    await engine.createSession({ cwd: '/tmp/a', model: MODEL }); // evicted
    const s2 = await engine.createSession({ cwd: '/tmp/a', model: MODEL });
    expect(engine.listSessions().map((s) => s.id)).toEqual([s2.id]);
    expect(sdk.created[0].disposed).toBe(true);
  });
});

describe('EngineService — disposeAll / compact guard / createdAt stability', () => {
  beforeEach(() => {
    sdk.created.length = 0;
    sdk.promptImpl = null;
    sdk.failDispose.clear();
  });

  it('disposeAll drains the map and survives an individual dispose failure', async () => {
    const engine = await makeCappedEngine();
    await engine.createSession({ cwd: '/tmp/a', model: MODEL });
    await engine.createSession({ cwd: '/tmp/a', model: MODEL });
    sdk.failDispose.add(sdk.created[0].label); // the first dispose throws
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await engine.disposeAll(); // must NOT throw despite the failure
      expect(engine.listSessions()).toEqual([]);
      expect(sdk.created[1].disposed).toBe(true); // the loop continued past it
      // Asserted BEFORE mockRestore — restoring also clears call history.
      expect(err).toHaveBeenCalled();
    } finally {
      err.mockRestore();
    }
  });

  it('compact() refuses while a turn is running: resolves false, no omp call', async () => {
    let compactCalls = 0;
    let racing: Promise<boolean> | null = null;
    const { session, events } = makeSession({
      onCompact: () => {
        compactCalls += 1;
      },
      emitOnPrompt: () => {
        // Synchronous with the turn: status is 'running' at this point.
        racing = session.compact('racing');
      },
    });
    await session.prompt('go');
    expect(sessionError(events)).toMatch(/busy/i);
    expect(compactCalls).toBe(0); // omp.compact was never reached
    // Discriminator (finding #5): pre-fix compact() resolved undefined, so
    // the route could not tell the busy no-op from a real compaction and
    // answered 200 {ok:true} while nothing happened.
    expect(await racing!).toBe(false);
  });

  it('compact() on an idle session runs the compaction and resolves true', async () => {
    let compactCalls = 0;
    const { session } = makeSession({
      onCompact: () => {
        compactCalls += 1;
      },
    });
    // Discriminator: pre-fix this resolved undefined (Promise<void>),
    // indistinguishable from the busy no-op by the awaited caller.
    expect(await session.compact('housekeeping')).toBe(true);
    expect(compactCalls).toBe(1);
  });

  it('summary createdAt derives from createdAtMs — stable across reads', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2020-01-01T00:00:00Z'));
      const { session } = makeSession();
      vi.setSystemTime(new Date('2021-06-01T00:00:00Z'));
      const engine = new EngineService({ force: true });
      const first = engine.toSummary(session);
      const second = engine.toSummary(session);
      // Discriminator: pre-fix every summary stamped the READ time, so the
      // first read would say 2021 and could drift between reads.
      expect(first.createdAt).toBe('2020-01-01T00:00:00.000Z');
      expect(second.createdAt).toBe(first.createdAt);
    } finally {
      vi.useRealTimers();
    }
  });
});

/* ─── Post-dispose listener detach (finding #6) ──────────────────────────── */

describe('EngineSession — dispose detaches the omp listener', () => {
  it('dispose() calls the unsubscribe fn from subscribe(); a late frame cannot resurrect or ghost-broadcast', async () => {
    const { session, events, emit, unsubscribes } = makeSession();
    await session.dispose();
    // Discriminator: pre-fix attach() DISCARDED the unsubscribe fn omp
    // returned, so nothing could ever detach the listener.
    expect(unsubscribes()).toBe(1);
    events.length = 0;
    // Simulate a frame already in flight inside the emitter's dispatch when
    // dispose ran — the detach cannot catch this one, the guard must.
    emit({ type: 'agent_end' });
    // Pre-fix BOTH assertions fail: status resurrects 'closed' → 'idle' and
    // the event ghost-broadcasts on a sessionId the map no longer holds.
    expect(session.status).toBe('closed');
    expect(events).toEqual([]);
  });

  it('attach() tolerates an older omp whose subscribe() returns no unsubscribe', async () => {
    const session = new EngineSession({ id: 's', cwd: '/tmp', onEvent: () => {} });
    session.attach({
      sessionId: 'omp',
      sessionName: 'omp',
      model: { provider: 'p', id: 'm' },
      // Older SDK shape: subscribe() returns undefined, not an unsubscribe.
      subscribe: () => undefined as unknown as () => void,
      subscribeRunState: () => () => {},
      prompt: async () => {},
      compact: async () => {},
      dispose: async () => {},
    } as Parameters<EngineSession['attach']>[0]);
    await expect(session.dispose()).resolves.toBeUndefined();
    expect(session.status).toBe('closed');
  });
});

/* ─── prompt() outcome contract: 'ok' | 'busy' | 'error' ─────────────────── */

/**
 * LoopRunner (and anything else awaiting a turn) must be able to tell a
 * failed turn from a good one WITHOUT re-reading mutable session state:
 * prompt() resolves 'busy' when the busy guard rejects, 'error' on the
 * turnErrored / zero-output paths, 'ok' otherwise. The session_error events
 * themselves are unchanged — the GUI wire stays identical.
 */
describe('EngineSession — prompt outcome contract', () => {
  it('resolves ok when the turn streamed assistant output', async () => {
    const { session } = makeSession({
      emitOnPrompt: (emit) =>
        emit({
          type: 'message_update',
          assistantMessageEvent: { type: 'text_delta', delta: 'hi' },
        }),
    });
    await expect(session.prompt('hello')).resolves.toBe('ok');
  });

  it('resolves error on the zero-output path (event unchanged)', async () => {
    const { session, events } = makeSession({ emitOnPrompt: () => {} });
    await expect(session.prompt('hello')).resolves.toBe('error');
    expect(sessionError(events)).toMatch(/no output/);
    expect(session.status).toBe('error');
  });

  it('resolves error when omp surfaced an errored message_end', async () => {
    const { session, events } = makeSession({
      emitOnPrompt: (emit) => emit(erroredMessageEnd({ errorMessage: '404 no such model' })),
    });
    await expect(session.prompt('hello')).resolves.toBe('error');
    expect(sessionError(events)).toContain('404 no such model');
  });

  it('resolves busy — never a silent success — while a turn is in flight', async () => {
    const gate = Promise.withResolvers<void>();
    const events: SessionTurnEvent[] = [];
    const session = new EngineSession({
      id: 'ses_test',
      cwd: '/tmp',
      onEvent: (ev) => events.push(ev),
    });
    session.attach({
      sessionId: 'omp-session',
      sessionName: 'omp-session',
      model: { provider: 'local-server', id: 'deepseek-ai/DeepSeek-V4-Flash' },
      subscribe: () => () => {},
      subscribeRunState: () => () => {},
      prompt: () => gate.promise, // hold the first turn open
      compact: async () => {},
      dispose: async () => {},
    } as Parameters<EngineSession['attach']>[0]);

    const first = session.prompt('a');
    // Discriminator: pre-fix the busy guard returned void — indistinguishable
    // from a completed turn, which is how LoopRunner recorded a stale-summary
    // "successful" round.
    await expect(session.prompt('b')).resolves.toBe('busy');
    expect(sessionError(events)).toMatch(/busy/i);

    gate.resolve();
    await first; // settles on the (unrelated) zero-output path — just awaited
  });

  it('a busy rejection does not poison the session: the next prompt still runs', async () => {
    const gate = Promise.withResolvers<void>();
    let resolveNext: () => void = () => {};
    const events: SessionTurnEvent[] = [];
    const session = new EngineSession({
      id: 'ses_test',
      cwd: '/tmp',
      onEvent: (ev) => events.push(ev),
    });
    let calls = 0;
    let listener: ((ev: unknown) => void) | null = null;
    session.attach({
      sessionId: 'omp-session',
      sessionName: 'omp-session',
      model: { provider: 'local-server', id: 'deepseek-ai/DeepSeek-V4-Flash' },
      subscribe: (l) => {
        listener = l;
        return () => {};
      },
      subscribeRunState: () => () => {},
      prompt: async () => {
        calls++;
        if (calls === 1) await gate.promise;
        else {
          await new Promise<void>((r) => {
            resolveNext = r;
            // produce output so the second turn is 'ok'
            listener?.({
              type: 'message_update',
              assistantMessageEvent: { type: 'text_delta', delta: 'second' },
            });
          });
        }
      },
      compact: async () => {},
      dispose: async () => {},
    } as Parameters<EngineSession['attach']>[0]);

    const first = session.prompt('a');
    await expect(session.prompt('rejected')).resolves.toBe('busy');
    gate.resolve();
    await first;

    const second = session.prompt('b');
    resolveNext();
    await expect(second).resolves.toBe('ok');
  });
});

/* ─── Durable sessions: disk-backed create + confined resume ───────────── */

/**
 * The contract that makes GUI agent sessions survive a backend restart:
 *  - fresh sessions get SessionManager.create(cwd) (disk-backed; the banned
 *    inMemory factory THROWS in this mock, so any regression fails loudly),
 *  - resumeSession confines the network-supplied path with the SAME roots +
 *    guard transcript reads use, BEFORE any fs/SDK touch,
 *  - the session identity (sessionFile) rides on every summary and the SDK's
 *    modelFallbackMessage surfaces verbatim as an honest warning,
 *  - POST /api/sessions maps rejections to a fixed 404 (no path echo) and
 *    unexpected engine faults to a fixed 500 (no raw message echo), while
 *    LoopManager's actionable guidance stays visible.
 */
describe('EngineService — durable sessions (disk-backed create, confined resume)', () => {
  let base = '';
  let sessionsRoot = '';

  beforeEach(() => {
    sdk.created.length = 0;
    sdk.promptImpl = null;
    sdk.failDispose.clear();
    sdk.createOpts.length = 0;
    sdk.createdManagers.length = 0;
    sdk.openCalls.length = 0;
    sdk.ompSessionFile = undefined;
    sdk.fallbackMessage = null;
    base = realpathSync(mkdtempSync(join(tmpdir(), 'aether-persist-')));
    sessionsRoot = join(base, 'sessions');
    mkdirSync(sessionsRoot);
    // The mock's getDefaultSessionDir returns sessionsRoot/enc-cwd →
    // defaultSessionRoots() derives exactly [sessionsRoot, homedir fallback].
    sdk.sessionsRoot = sessionsRoot;
  });

  afterEach(() => {
    sdk.sessionsRoot = null;
    rmSync(base, { recursive: true, force: true });
  });

  /** Drive the REAL POST /api/sessions handler with a JSON body. */
  async function postCreateSession(
    body: unknown,
    engine?: unknown,
  ): Promise<{ status: number; json: Record<string, unknown> }> {
    const req = Readable.from([Buffer.from(JSON.stringify(body))]) as unknown as IncomingMessage;
    let status = 0;
    let text = '';
    const res = {
      writeHead: (code: number) => {
        status = code;
        return res;
      },
      end: (data?: unknown) => {
        text = String(data ?? '');
        return res;
      },
    } as unknown as ServerResponse;
    const liveEngine = (engine ?? (await makeCappedEngine())) as EngineService; // test double seam
    const ctx = {
      engine: liveEngine,
      workspaces: { resolveCwd: () => ({ path: '/tmp/proj' }) },
      loops: {},
      skills: {},
    } as unknown as EngineRouteContext;
    await createSessionRoute(req, res, {}, ctx);
    return { status, json: JSON.parse(text) as Record<string, unknown> };
  }

  it('T1: createSession passes SessionManager.create(cwd) — inMemory is banned', async () => {
    const engine = await makeCappedEngine();
    const session = await engine.createSession({ cwd: '/tmp/proj', model: MODEL });
    // Discriminator: the old code called SessionManager.inMemory — this mock
    // throws there, so createSession would reject before these asserts.
    expect(sdk.createdManagers).toEqual([{ tag: 'create', cwd: '/tmp/proj' }]);
    expect(sdk.createOpts).toHaveLength(1);
    expect(sdk.createOpts[0].sessionManager).toBe(sdk.createdManagers[0]);
    // Identity rides: undefined until omp lazily materializes the file, then
    // EVERY summary re-reads it from the live omp session.
    expect(engine.toSummary(session).sessionFile).toBeUndefined();
    const journal = join(sessionsRoot, 'x.jsonl');
    // Mock seam: the fake omp session is a plain extensible literal.
    const createdOmp = sdk.created[0] as { sessionFile?: string };
    createdOmp.sessionFile = journal;
    expect(engine.toSummary(session).sessionFile).toBe(journal);
  });

  it('T2: resume rejects a path outside every root — fixed message, open() never called', async () => {
    // Existing, regular, .jsonl: ONLY the root check can reject this path.
    const evil = join(base, 'evil.jsonl');
    writeFileSync(evil, '{"type":"session"}\n');
    const engine = await makeCappedEngine();
    let caught: unknown;
    try {
      await engine.resumeSession({ cwd: '/tmp/proj', model: MODEL, sessionFile: evil });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SessionResumeRejectedError);
    if (!(caught instanceof SessionResumeRejectedError))
      throw new Error('unreachable: wrong error type');
    expect(caught.message).toBe('session not found'); // instanceof-narrowed — checked access
    expect(caught.message).not.toContain(base); // no path echo / fs oracle
    // Discriminator: confinement runs FIRST — the SDK factories are untouched.
    expect(sdk.openCalls).toEqual([]);
    expect(sdk.createOpts).toEqual([]);
  });

  it('T2b: a symlink inside the root escaping outside is rejected identically', async () => {
    const secret = join(base, 'outside-secret.jsonl');
    writeFileSync(secret, '{"type":"session"}\n');
    const link = join(sessionsRoot, 'sneaky.jsonl');
    symlinkSync(secret, link);
    const engine = await makeCappedEngine();
    await expect(
      engine.resumeSession({ cwd: '/tmp/proj', model: MODEL, sessionFile: link }),
    ).rejects.toBeInstanceOf(SessionResumeRejectedError);
    expect(sdk.openCalls).toEqual([]);
  });

  it('T2c: POST resumePath outside roots → 404 fixed body; wrong type → 400', async () => {
    const evil = join(base, 'evil.jsonl');
    writeFileSync(evil, '{"type":"session"}\n');
    const r = await postCreateSession({ model: MODEL, resumePath: evil });
    expect(r.status).toBe(404);
    expect(r.json).toEqual({ error: 'session not found' }); // no path echo
    expect(sdk.openCalls).toEqual([]);
    const t = await postCreateSession({ model: MODEL, resumePath: 42 });
    expect(t.status).toBe(400);
  });

  it('T3: resume threads sessionFile into the summary and returns the fallback as warning', async () => {
    const file = join(sessionsRoot, 'x.jsonl');
    writeFileSync(file, '{"type":"session","id":"sess-9"}\n');
    const realFile = realpathSync(file);
    sdk.ompSessionFile = realFile;
    sdk.fallbackMessage = 'Could not restore model z. Using y';
    const engine = await makeCappedEngine();
    const resumed = await engine.resumeSession({
      cwd: '/tmp/proj',
      model: MODEL,
      sessionFile: file,
    });
    // Only the CONFINED realpath is ever handed to the SDK…
    expect(sdk.openCalls).toEqual([realFile]);
    // …and the reopen product flows into the same createAgentSession options
    // shape createSession uses.
    expect(sdk.createOpts[0].sessionManager).toEqual({ tag: 'open', path: realFile });
    expect(sdk.createOpts[0]).toMatchObject({
      cwd: '/tmp/proj',
      enableMCP: false,
      enableLsp: false,
    });
    expect(resumed.warning).toBe('Could not restore model z. Using y');
    expect(engine.toSummary(resumed.session).sessionFile).toBe(realFile);
    expect(engine.getSession(resumed.session.id)).toBe(resumed.session); // registered live
  });

  it('T3b: POST /api/sessions with resumePath → 201 { session.sessionFile, warning }', async () => {
    const file = join(sessionsRoot, 'x.jsonl');
    writeFileSync(file, '{"type":"session","id":"sess-9"}\n');
    const realFile = realpathSync(file);
    sdk.ompSessionFile = realFile;
    sdk.fallbackMessage = 'Could not restore model z. Using y';
    const r = await postCreateSession({ cwd: '/tmp/proj', model: MODEL, resumePath: file });
    expect(r.status).toBe(201);
    const sessionBody = r.json.session as Record<string, unknown>; // parsed-JSON test boundary
    expect(sessionBody.sessionFile).toBe(realFile);
    expect(r.json.warning).toBe('Could not restore model z. Using y');
  });

  it('route error policy: unexpected faults silenced, actionable guidance stays visible', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // Unexpected engine fault: raw message (fs paths, SDK internals) must
      // NOT reach the client — fixed server-policy message instead.
      const leaky = {
        createSession: async () => {
          throw new Error('ENOENT: open /home/user/.omp/agent/private.jsonl failed');
        },
      } as unknown as EngineService;
      const r = await postCreateSession({ model: MODEL }, leaky);
      expect(r.status).toBe(500);
      expect(r.json).toEqual({ error: 'Internal server error' });
      expect(JSON.stringify(r.json)).not.toContain('private.jsonl');

      // Loop lifecycle guidance (LoopManager's own validation text) stays
      // verbatim — the GUI prompt to pick a directory depends on it.
      let status = 0;
      let text = '';
      const res = {
        writeHead: (code: number) => {
          status = code;
          return res;
        },
        end: (data?: unknown) => {
          text = String(data ?? '');
          return res;
        },
      } as unknown as ServerResponse;
      const loopMsg =
        'Loop l1 has no absolute working directory — open it in the GUI, pick a directory, and save before starting';
      const ctx = {
        engine: leaky,
        workspaces: { resolveCwd: () => ({ path: '/tmp/proj' }) },
        loops: {
          start: async () => {
            throw new LoopUserError(loopMsg);
          },
        },
        skills: {},
      } as unknown as EngineRouteContext;
      await startLoopRoute({} as IncomingMessage, res, { id: 'l1' }, ctx);
      expect(status).toBe(500);
      const loopBody = JSON.parse(text) as { error: string }; // captured-response test boundary
      expect(loopBody.error).toBe(loopMsg);

      // EngineUnavailableError passthrough (501 + its message) is unchanged.
      const ctx501 = {
        ...ctx,
        loops: {
          start: async () => {
            throw new EngineUnavailableError();
          },
        },
      } as unknown as EngineRouteContext;
      status = 0;
      text = '';
      await startLoopRoute({} as IncomingMessage, res, { id: 'l1' }, ctx501);
      expect(status).toBe(501);
      const unavailBody = JSON.parse(text) as { error: string }; // captured-response test boundary
      expect(unavailBody.error).toContain('unavailable');
    } finally {
      errSpy.mockRestore();
    }
  });
});

describe('EngineService — provider control plane (cast-injected warm engine)', () => {
  /**
   * engine-service.ts keeps modelsStore/registry/authStorage PLAIN private
   * fields precisely so the Node suite can inject a warm-state engine and
   * exercise the REAL provider ops without the Bun-only SDK: started=true
   * short-circuits start(), a tmp ModelsYamlStore stands in for the
   * production codecs, and a small fake satisfies OmpRegistryLike /
   * OmpAuthStorageLike surface used by these methods.
   */
  function warmEngine(
    registryExtra: Record<string, unknown> = {},
    makeStore?: (path: string) => ModelsYamlStore,
  ) {
    const dir = mkdtempSync(join(tmpdir(), 'aether-prov-'));
    const store = makeStore
      ? makeStore(join(dir, 'models.yml'))
      : new ModelsYamlStore(join(dir, 'models.yml'), {
          parse: (t: string) => JSON.parse(t),
          stringify: (v: unknown) => JSON.stringify(v, null, 2),
        });
    const engine = new EngineService();
    const injected = engine as unknown as {
      started: boolean;
      registry: unknown;
      authStorage: unknown;
      modelsStore: unknown;
    };
    injected.started = true;
    injected.registry = { refreshProvider: async () => {}, ...registryExtra };
    injected.authStorage = {
      set: async () => {},
      remove: async () => {},
      hasAuth: () => false,
      peekApiKey: async () => undefined,
    };
    injected.modelsStore = store;
    return { engine, store, dir };
  }

  it('409s a bundled provider name BEFORE any write — file bytes identical, no .bak', async () => {
    const { engine, store, dir } = warmEngine({ hasProvider: (n: string) => n === 'anthropic' });
    try {
      await store.save({
        providers: { mine: { baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'sk-KEEPME' } },
        theme: 'dark',
      });
      const before = readFileSync(store.filePath);
      const op = engine
        .createCustomProvider({
          name: 'anthropic',
          baseUrl: 'https://api.anthropic.com',
          apiKey: 'sk-must-never-land',
        })
        .then(() => null)
        .catch((e: Error & { status?: number }) => e);
      const err = await op;
      expect(err).not.toBeNull();
      expect(err?.status).toBe(409);
      expect(readFileSync(store.filePath)).toEqual(before);
      expect(existsSync(`${store.filePath}.bak`)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('create then delete preserves unrelated providers and top-level keys byte-round-trip', async () => {
    const { engine, store, dir } = warmEngine({ hasProvider: () => false });
    try {
      await store.save({
        providers: { mine: { baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'sk-KEEPME' } },
        theme: 'dark',
      });
      const name = await engine.createCustomProvider({
        name: 'probe-gpu',
        baseUrl: 'http://127.0.0.1:9/v1',
        auth: 'none',
        models: [{ id: 'm/x' }],
      });
      expect(name).toBe('probe-gpu');
      const mid = await store.load();
      if (!mid.ok) throw new Error('store unreadable after create');
      const midProviders = (mid.value.providers ?? {}) as Record<string, unknown>;
      expect(Object.keys(midProviders)).toEqual(['mine', 'probe-gpu']);
      expect(mid.value.theme).toBe('dark');
      expect(midProviders.mine).toEqual({ baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'sk-KEEPME' });
      // key-less server entry carries no apiKey at all
      expect(midProviders['probe-gpu']).toEqual({
        baseUrl: 'http://127.0.0.1:9/v1',
        api: 'openai-completions',
        auth: 'none',
        models: [{ id: 'm/x' }],
      });
      await engine.deleteCustomProvider('probe-gpu');
      const after = await store.load();
      if (!after.ok) throw new Error('store unreadable after delete');
      expect(Object.keys((after.value.providers ?? {}) as Record<string, unknown>)).toEqual([
        'mine',
      ]);
      expect(after.value.theme).toBe('dark');
      expect(statSync(store.filePath).mode & 0o777).toBe(0o600);
      expect(readFileSync(`${store.filePath}.bak`, 'utf8')).toContain('sk-KEEPME');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * Finding #3 discriminator. A store whose load() forces every CONCURRENT
   * pair of read-modify-write cycles onto the SAME base config: each load
   * reads the file, announces arrival, and holds its caller until a second
   * load has ARRIVED (or a 50ms watchdog fires). Pre-fix, create+delete both
   * reach load() before either save runs (a save is only reachable after its
   * own load resolves, and a load only resolves at arrivals≥2), the barrier
   * releases both with the stale base {mine}, and the last writer silently
   * reverts the first. Post-fix, the store mutex serializes the cycles: only
   * ONE load is ever in flight, the barrier never fills, and the watchdog
   * merely adds latency — the second cycle loads strictly AFTER the first
   * save, so both effects stack.
   */
  class StaleBaseStore extends ModelsYamlStore {
    private arrivals = 0;
    private readonly barrier = Promise.withResolvers<void>();
    constructor(path: string) {
      super(path, {
        parse: (t: string) => JSON.parse(t),
        stringify: (v: unknown) => JSON.stringify(v, null, 2),
      });
    }
    override async load(): Promise<StoreResult<Record<string, unknown>>> {
      const loaded = await super.load();
      this.arrivals += 1;
      if (this.arrivals >= 2) this.barrier.resolve();
      // Real 50ms watchdog on purpose (documented test-timer exception): the
      // race lives in production microtasks, not a timer fake clocks could
      // drive — and post-fix the timeout is pure latency, never correctness.
      await Promise.race([this.barrier.promise, new Promise((r) => setTimeout(r, 50))]);
      return loaded;
    }
  }

  it('concurrent create+delete keep BOTH effects — no lost update on models.yml', async () => {
    const { engine, store, dir } = warmEngine(
      { hasProvider: () => false },
      (p) => new StaleBaseStore(p),
    );
    try {
      await store.save({
        providers: { mine: { baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'sk-KEEPME' } },
        theme: 'dark',
      });
      await Promise.all([
        engine.createCustomProvider({
          name: 'probe-gpu',
          baseUrl: 'http://127.0.0.1:9/v1',
          auth: 'none',
        }),
        engine.deleteCustomProvider('mine'),
      ]);
      const final = await store.load();
      if (!final.ok) throw new Error('store unreadable after concurrent CRUD');
      const names = Object.keys((final.value.providers ?? {}) as Record<string, unknown>);
      // Pre-fix the interleaved stale saves collapse to ONE final state that
      // lost an effect either way: delete-last → probe-gpu vanished,
      // create-last → mine resurrected. Serialized, both effects hold.
      expect(names).toContain('probe-gpu');
      expect(names).not.toContain('mine');
      expect(final.value.theme).toBe('dark');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/* ─── Transient startup stays retryable (finding #7) ─────────────────────── */

describe('EngineService — transient start failure stays retryable', () => {
  beforeEach(() => {
    sdk.failRefresh = 0;
    sdk.refreshCalls = 0;
    sdk.availableModels = [];
  });

  it('a refresh flake degrades WITHOUT latching: the next engine call re-inits and recovers', async () => {
    sdk.failRefresh = 1; // first refresh throws, later ones succeed
    const engine = new EngineService({ force: true });
    await engine.start();
    // Discriminator (finding #7): pre-fix start() consumed `started` BEFORE
    // the attempt and set available=false in the catch — one flake 501'd
    // every engine route for the process lifetime. Post-fix only the
    // unrecoverable SDK-load failure latches (via #importSdk).
    expect(engine.isAvailable).toBe(true);
    expect(engine.availabilityError).toMatch(/transient refresh flake/);
    // Recovery rides the route-facing call itself: listModels → start() →
    // re-attempt succeeds.
    sdk.availableModels = [{ provider: 'p', id: 'm1' }];
    const groups = await engine.listModels();
    expect(groups).toHaveLength(1);
    expect(groups[0].models.map((m) => m.id)).toEqual(['m1']);
  });

  it('while the failure persists every call degrades to EngineUnavailableError, yet stays retryable', async () => {
    sdk.failRefresh = 3;
    const engine = new EngineService({ force: true });
    await expect(engine.listModels()).rejects.toBeInstanceOf(EngineUnavailableError);
    await expect(engine.listModels()).rejects.toBeInstanceOf(EngineUnavailableError);
    sdk.failRefresh = 0;
    sdk.availableModels = [{ provider: 'p', id: 'm9' }];
    const groups = await engine.listModels();
    expect(groups[0].total).toBe(1);
  });

  it('concurrent start() calls share ONE init attempt', async () => {
    const engine = new EngineService({ force: true });
    await Promise.all([engine.start(), engine.start(), engine.start()]);
    expect(sdk.refreshCalls).toBe(1);
  });
});

/* ─── /api/models honesty under the 200-row slice (finding #12) ──────────── */

describe('EngineService — /api/models reports total + truncated', () => {
  beforeEach(() => {
    sdk.failRefresh = 0;
    sdk.availableModels = [];
  });

  it('a 201-model provider slices to 200 but reports total 201, truncated true', async () => {
    const engine = await makeCappedEngine();
    sdk.availableModels = Array.from({ length: 201 }, (_, i) => ({ provider: 'p', id: `m${i}` }));
    const groups = await engine.listModels();
    expect(groups).toHaveLength(1);
    expect(groups[0].models).toHaveLength(200);
    // Discriminator: pre-fix the group carried NO total/truncated, so a GUI
    // rendered a truncated group as the complete catalog (undefined ≠ 201).
    expect(groups[0].total).toBe(201);
    expect(groups[0].truncated).toBe(true);
    // Existing fields keep working: the slice holds the FIRST 200 in order.
    expect(groups[0].models[0].id).toBe('m0');
    expect(groups[0].models[199].id).toBe('m199');
  });

  it('a non-truncated group is honest too: total == models.length, truncated false', async () => {
    const engine = await makeCappedEngine();
    sdk.availableModels = [
      { provider: 'q', id: 'a' },
      { provider: 'q', id: 'b' },
    ];
    const groups = await engine.listModels();
    expect(groups[0].total).toBe(2);
    expect(groups[0].truncated).toBe(false);
  });
});
