import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EngineService, EngineSession, describeUnservedModel } from './engine-service.js';
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
      return () => {};
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
  return { session, events, emit: (ev: Record<string, unknown>) => listener?.(ev) };
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
 * discoverAuthStorage, SessionManager.inMemory and createAgentSession, so the
 * full create/dispose/evict lifecycle can be driven here deterministically.
 */
const sdk = vi.hoisted(() => ({
  /** Fake omp sessions in creation order (== EngineSession creation order). */
  created: [] as Array<{ label: string; disposed: boolean; compactCalls: number }>,
  /** Prompt body installed while set — lets a test hang a turn on a gate. */
  promptImpl: null as null | (() => Promise<void>),
  /** Labels whose dispose() must throw (resilience probes). */
  failDispose: new Set<string>(),
}));

vi.mock('@oh-my-pi/pi-coding-agent', () => ({
  discoverAuthStorage: async () => ({ getApiKey: async () => undefined }),
  ModelRegistry: class {
    constructor(_auth: unknown) {}
    async refresh(): Promise<void> {}
    find(provider: string, id: string) {
      // No baseUrl → the served-model preflight skips its fetch entirely.
      return { provider, id };
    }
    getAvailable() {
      return [];
    }
  },
  SessionManager: {
    inMemory: (_cwd: string) => ({}),
  },
  createAgentSession: async () => {
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
    };
    sdk.created.push(omp);
    return { session: omp };
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

  it('compact() refuses while a turn is running and emits session_error', async () => {
    let compactCalls = 0;
    const { session, events } = makeSession({
      onCompact: () => {
        compactCalls += 1;
      },
      emitOnPrompt: () => {
        // Synchronous with the turn: status is 'running' at this point.
        void session.compact('racing');
      },
    });
    await session.prompt('go');
    expect(sessionError(events)).toMatch(/busy/i);
    expect(compactCalls).toBe(0); // omp.compact was never reached
  });

  it('compact() runs normally on an idle session', async () => {
    let compactCalls = 0;
    const { session } = makeSession({
      onCompact: () => {
        compactCalls += 1;
      },
    });
    await session.compact('housekeeping');
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
