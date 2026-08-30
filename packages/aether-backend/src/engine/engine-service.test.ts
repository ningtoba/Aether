import { describe, it, expect } from 'vitest';
import { EngineSession, describeUnservedModel } from './engine-service.js';
import type { SessionTurnEvent } from './types.js';

/**
 * Node-safe harness for EngineSession: captures the omp event listener so
 * synthetic frames can be injected directly. Never imports the omp SDK (its
 * native addon is Bun-only), matching the node vitest suite's constraint.
 */
function makeSession(
  opts: { emitOnPrompt?: (emit: (ev: Record<string, unknown>) => void) => void } = {},
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
    compact: async () => {},
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
