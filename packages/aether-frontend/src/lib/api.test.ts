import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  advanceLoop,
  browseWorkspace,
  compactSession,
  createFacadeProvider,
  createSession,
  deleteFacadeProvider,
  deleteLoop,
  disposeSession,
  getApiKey,
  getFacadeStatus,
  getHealth,
  getLoop,
  getSession,
  getSessionTranscript,
  getSettingsSchema,
  getSettingsValues,
  listDiskSessions,
  listFacadeProviders,
  listLoops,
  listModels,
  listOmpAgents,
  listOmpSkills,
  listSessions,
  listSkills,
  listWorkspaces,
  promptSession,
  readDiskSession,
  removeProviderKey,
  saveLoop,
  setApiKey,
  setProviderKey,
  setSetting,
  startLoop,
  stopLoop,
  verifyProvider,
} from './api';

/** sessionStorage slot owned by api.ts (module-private constant). */
const STORAGE_KEY = 'aether.apiKey';

/* ── fakes ────────────────────────────────────────────────────────────── */

interface FakeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  readonly sets: Array<[string, string]>;
  readonly removes: string[];
}

function makeStorage(initial: Record<string, string> = {}): FakeStorage {
  const data = new Map(Object.entries(initial));
  const sets: Array<[string, string]> = [];
  const removes: string[] = [];
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      sets.push([key, value]);
      data.set(key, value);
    },
    removeItem: (key) => {
      removes.push(key);
      data.delete(key);
    },
    sets,
    removes,
  };
}

function stubStorage(initial?: Record<string, string>): FakeStorage {
  const storage = makeStorage(initial);
  vi.stubGlobal('sessionStorage', storage);
  return storage;
}

/** Storage whose every access throws (private-mode browsers). */
function stubThrowingStorage(): void {
  vi.stubGlobal('sessionStorage', {
    getItem() {
      throw new Error('SecurityError: storage disabled');
    },
    setItem() {
      throw new Error('SecurityError: storage disabled');
    },
    removeItem() {
      throw new Error('SecurityError: storage disabled');
    },
  });
}

type Responder = Response | ((url: string, init: RequestInit) => Response | Promise<Response>);

interface Recorded {
  url: string;
  method: string;
  headers: Headers;
  /** Parsed JSON request body, or null when the call carried none. */
  body: unknown;
  signal: AbortSignal | null;
}

/** Replaces global fetch with a recorder; every call gets `responder`. */
function stubFetch(responder?: Responder): Recorded[] {
  const calls: Recorded[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit): Promise<Response> => {
      const i = init ?? {};
      calls.push({
        url: String(input),
        method: i.method ?? 'GET',
        headers: new Headers(i.headers),
        body: typeof i.body === 'string' ? JSON.parse(i.body) : null,
        signal: i.signal ?? null,
      });
      if (typeof responder === 'function') return responder(String(input), i);
      if (responder) return responder;
      return new Response('', { status: 200, statusText: 'OK' });
    }),
  );
  return calls;
}

function jsonResponse(payload: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

function headerEntries(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, name) => {
    out[name] = value;
  });
  return out;
}

function makeModel(): { provider: string; modelId: string } {
  return { provider: 'local-server', modelId: 'Qwen/Qwen3.8-Flash-Next-FP8' };
}

beforeEach(() => {
  // Node ≥25 ships a real in-memory sessionStorage; never let it leak between tests.
  try {
    globalThis.sessionStorage?.clear?.();
  } catch {
    /* unavailable here — tests stub their own storage anyway */
  }
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/* ── key storage ──────────────────────────────────────────────────────── */

describe('getApiKey', () => {
  it('reads the tab-scoped sessionStorage slot and returns null when unset', () => {
    expect(getApiKey()).toBeNull();
    stubStorage({ [STORAGE_KEY]: 'k1' });
    expect(getApiKey()).toBe('k1');
  });

  it('returns null when storage access throws (private mode never crashes a request)', () => {
    stubThrowingStorage();
    expect(getApiKey()).toBeNull();
  });
});

describe('setApiKey', () => {
  it('trims and stores a non-empty key under aether.apiKey', () => {
    const storage = stubStorage();
    setApiKey('  k1  ');
    expect(storage.sets).toEqual([[STORAGE_KEY, 'k1']]);
    expect(storage.removes).toEqual([]);
    expect(getApiKey()).toBe('k1');
  });

  it('clears the slot on empty and whitespace-only input (regression: empty string was stored)', () => {
    const storage = stubStorage({ [STORAGE_KEY]: 'k1' });
    setApiKey('');
    expect(storage.removes).toEqual([STORAGE_KEY]);
    expect(storage.sets).toEqual([]);
    setApiKey('   ');
    expect(storage.removes).toEqual([STORAGE_KEY, STORAGE_KEY]);
    expect(getApiKey()).toBeNull();
  });

  it('swallows storage failures instead of throwing', () => {
    stubThrowingStorage();
    expect(() => setApiKey('k1')).not.toThrow();
    expect(() => setApiKey('')).not.toThrow();
  });
});

/* ── request(): auth headers ──────────────────────────────────────────── */

describe('request authorization header', () => {
  it('attaches the Bearer key only when one is stored', async () => {
    stubStorage({ [STORAGE_KEY]: 'k1' });
    const calls = stubFetch(jsonResponse({ accepted: true }));
    await promptSession('s1', 'hi');
    expect(calls[0].headers.get('authorization')).toBe('Bearer k1');

    stubStorage();
    const anon = stubFetch(jsonResponse({ status: 'ok' }));
    await getHealth();
    expect(anon[0].headers.get('authorization')).toBeNull();
  });

  it('keeps Bearer alongside the JSON content-type (regression: any extra header used to clobber authorization)', async () => {
    // The pre-fix code spread caller opts OVER the computed headers, so the
    // first caller-supplied header silently dropped Authorization → spurious
    // 401s. Pin the exact outgoing header set the merge must produce.
    stubStorage({ [STORAGE_KEY]: 'k1' });
    const calls = stubFetch(jsonResponse({ accepted: true }));
    await promptSession('s1', 'hi');
    expect(headerEntries(calls[0].headers)).toEqual({
      'content-type': 'application/json',
      authorization: 'Bearer k1',
    });
  });

  it('sends no authorization header at all when no key is stored', async () => {
    stubStorage();
    const calls = stubFetch(jsonResponse({ groups: [] }));
    await listModels();
    expect(headerEntries(calls[0].headers)).toEqual({ 'content-type': 'application/json' });
  });
});

/* ── request(): timeout ───────────────────────────────────────────────── */

describe('request timeout', () => {
  it('aborts the fetch at the 30s default and replaces the rejection with a timeout message (regression: hung backend pinned the spinner forever)', async () => {
    vi.useFakeTimers();
    stubStorage();
    const calls = stubFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('fetch aborted')));
        }),
    );
    let settled = 'pending';
    const p = startLoop('l1');
    p.then(
      () => {
        settled = 'resolved';
      },
      () => {
        settled = 'rejected';
      },
    );

    await vi.advanceTimersByTimeAsync(29_999);
    expect(settled).toBe('pending');
    expect(calls[0].signal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(p).rejects.toThrowError(
      new Error('Request timed out after 30000ms: POST /api/loops/l1/start'),
    );
    expect(calls[0].signal?.aborted).toBe(true);
  });

  it('rethrows a network rejection verbatim (not masked as a timeout)', async () => {
    stubStorage();
    const networkError = new TypeError('Failed to fetch');
    stubFetch(() => {
      throw networkError;
    });
    await expect(getHealth()).rejects.toBe(networkError);
  });
});

/* ── request(): failure paths ─────────────────────────────────────────── */

describe('request failure paths', () => {
  it('401 without a stored key names the operator remedy verbatim (not the server body)', async () => {
    stubStorage();
    stubFetch(jsonResponse({ error: 'nope' }, { status: 401, statusText: 'Unauthorized' }));
    await expect(getHealth()).rejects.toThrowError(
      new Error('Unauthorized — this backend requires an API key. Set it in Settings.'),
    );
  });

  it('401 with a key configured falls through to body.error (remedy is only for the keyless setup gap)', async () => {
    stubStorage({ [STORAGE_KEY]: 'k1' });
    stubFetch(
      jsonResponse({ error: 'invalid api key' }, { status: 401, statusText: 'Unauthorized' }),
    );
    await expect(getHealth()).rejects.toThrowError(new Error('invalid api key'));
  });

  it('401 with a key and a non-JSON error body falls back to the status line', async () => {
    stubStorage({ [STORAGE_KEY]: 'k1' });
    stubFetch(new Response('nope', { status: 401, statusText: 'Unauthorized' }));
    await expect(getHealth()).rejects.toThrowError(new Error('401 Unauthorized'));
  });

  it('prefers body.error verbatim on non-OK responses', async () => {
    stubStorage();
    stubFetch(
      jsonResponse(
        { error: 'loop cwd invalid' },
        { status: 500, statusText: 'Internal Server Error' },
      ),
    );
    await expect(startLoop('l1')).rejects.toThrowError(new Error('loop cwd invalid'));
  });

  it('falls back to "status statusText" when the JSON body has no error field', async () => {
    stubStorage();
    stubFetch(
      jsonResponse({ detail: 'proxy exploded' }, { status: 502, statusText: 'Bad Gateway' }),
    );
    await expect(getHealth()).rejects.toThrowError(new Error('502 Bad Gateway'));
  });

  it('tolerates non-JSON and non-object error bodies via the raw-text/statusText path', async () => {
    stubStorage();
    stubFetch(new Response('boom', { status: 500, statusText: 'Internal Server Error' }));
    await expect(getHealth()).rejects.toThrowError(new Error('500 Internal Server Error'));

    stubFetch(new Response('42', { status: 422, statusText: 'Unprocessable Entity' }));
    await expect(getHealth()).rejects.toThrowError(new Error('422 Unprocessable Entity'));
  });

  it('resolves an empty 2xx body to null', async () => {
    stubStorage();
    stubFetch();
    await expect(getHealth()).resolves.toBeNull();
  });

  it('resolves a non-JSON 2xx body to the raw text', async () => {
    stubStorage();
    stubFetch(new Response('plain text body', { status: 200, statusText: 'OK' }));
    await expect(listSkills()).resolves.toBe('plain text body');
  });
});

/* ── wire contract: every exported endpoint ───────────────────────────── */

interface WireCase {
  name: string;
  run: () => Promise<unknown>;
  url: string;
  method: string;
  reqBody?: unknown;
  payload: unknown;
}

const wireCases: WireCase[] = [
  {
    name: 'getHealth → GET /health',
    run: () => getHealth(),
    url: '/health',
    method: 'GET',
    payload: {
      status: 'ok',
      version: '0.4.0',
      uptime: 12,
      providers: { configured: 2, healthy: 2 },
      timestamp: '2026-08-30T00:00:00.000Z',
      realtime: { port: 3082 },
    },
  },
  {
    name: 'listModels → GET /api/models',
    run: () => listModels(),
    url: '/api/models',
    method: 'GET',
    payload: { groups: [{ provider: 'local-server', models: [{ id: 'm1' }] }] },
  },
  {
    name: 'listSessions → GET /api/sessions',
    run: () => listSessions(),
    url: '/api/sessions',
    method: 'GET',
    payload: { sessions: [{ id: 's1', name: 'chat', messageCount: 2 }] },
  },
  {
    name: 'createSession(model, cwd, resumePath) → POST /api/sessions with all three fields',
    run: () => createSession(makeModel(), '/home/user/project', '/root/.omp/session.jsonl'),
    url: '/api/sessions',
    method: 'POST',
    reqBody: {
      model: makeModel(),
      cwd: '/home/user/project',
      resumePath: '/root/.omp/session.jsonl',
    },
    payload: { session: { id: 's1' }, warning: 'resumed with truncated context' },
  },
  {
    name: 'getSession → GET /api/sessions/{id}',
    run: () => getSession('s1'),
    url: '/api/sessions/s1',
    method: 'GET',
    payload: { session: { id: 's1', name: 'chat' } },
  },
  {
    name: 'getSessionTranscript → GET /api/sessions/{id}/transcript',
    run: () => getSessionTranscript('s1'),
    url: '/api/sessions/s1/transcript',
    method: 'GET',
    payload: { transcript: { id: 's1', entries: [{ kind: 'user', text: 'hi' }] } },
  },
  {
    name: 'promptSession → POST /api/sessions/{id}/prompt with { message }',
    run: () => promptSession('s1', 'hello'),
    url: '/api/sessions/s1/prompt',
    method: 'POST',
    reqBody: { message: 'hello' },
    payload: { accepted: true },
  },
  {
    name: 'compactSession → POST /api/sessions/{id}/compact',
    run: () => compactSession('s1'),
    url: '/api/sessions/s1/compact',
    method: 'POST',
    payload: { ok: true },
  },
  {
    name: 'disposeSession → POST /api/sessions/{id}/dispose',
    run: () => disposeSession('s1'),
    url: '/api/sessions/s1/dispose',
    method: 'POST',
    payload: { ok: true },
  },
  {
    name: 'listLoops → GET /api/loops',
    run: () => listLoops(),
    url: '/api/loops',
    method: 'GET',
    payload: { loops: [{ id: 'l1', name: 'Nightly audit', maxRounds: 5 }] },
  },
  {
    name: 'saveLoop → POST /api/loops with the partial loop verbatim',
    run: () => saveLoop({ id: 'l1', name: 'Nightly audit', maxRounds: 5 }),
    url: '/api/loops',
    method: 'POST',
    reqBody: { id: 'l1', name: 'Nightly audit', maxRounds: 5 },
    payload: { loop: { id: 'l1', name: 'Nightly audit', maxRounds: 5 } },
  },
  {
    name: 'getLoop → GET /api/loops/{id} keeps null progress',
    run: () => getLoop('l1'),
    url: '/api/loops/l1',
    method: 'GET',
    payload: { loop: { id: 'l1' }, progress: null },
  },
  {
    name: 'deleteLoop → DELETE /api/loops/{id}',
    run: () => deleteLoop('l1'),
    url: '/api/loops/l1',
    method: 'DELETE',
    payload: { ok: true },
  },
  {
    name: 'startLoop → POST /api/loops/{id}/start',
    run: () => startLoop('l1'),
    url: '/api/loops/l1/start',
    method: 'POST',
    payload: {
      progress: { id: 'l1', status: 'running', currentRound: 1, rounds: [], totalRounds: 3 },
    },
  },
  {
    name: 'stopLoop → POST /api/loops/{id}/stop',
    run: () => stopLoop('l1'),
    url: '/api/loops/l1/stop',
    method: 'POST',
    payload: {
      progress: { id: 'l1', status: 'stopped', currentRound: 2, rounds: [], totalRounds: 3 },
    },
  },
  {
    name: 'advanceLoop → POST /api/loops/{id}/advance with { action }',
    run: () => advanceLoop('l1', 'continue'),
    url: '/api/loops/l1/advance',
    method: 'POST',
    reqBody: { action: 'continue' },
    payload: {
      progress: { id: 'l1', status: 'running', currentRound: 2, rounds: [], totalRounds: 3 },
    },
  },
  {
    name: 'listSkills → GET /api/skills',
    run: () => listSkills(),
    url: '/api/skills',
    method: 'GET',
    payload: { skills: [{ name: 'santa-loop', description: 'd', path: '/s' }] },
  },
  {
    name: 'getFacadeStatus → GET /api/omp/status',
    run: () => getFacadeStatus(),
    url: '/api/omp/status',
    method: 'GET',
    payload: { status: { available: true, runtime: 'node', version: '1.2.3' } },
  },
  {
    name: 'listWorkspaces → GET /api/workspaces',
    run: () => listWorkspaces(),
    url: '/api/workspaces',
    method: 'GET',
    payload: { workspaces: [{ path: '/home/user', label: 'Home' }] },
  },
  {
    name: 'browseWorkspace() → GET /api/workspaces/browse with no query string',
    run: () => browseWorkspace(),
    url: '/api/workspaces/browse',
    method: 'GET',
    payload: { path: '/home/user', entries: [{ name: 'p', path: '/home/user/p', isDir: true }] },
  },
  {
    name: 'getSettingsSchema → GET /api/omp/settings',
    run: () => getSettingsSchema(),
    url: '/api/omp/settings',
    method: 'GET',
    payload: { schema: { tabs: [{ id: 'general', label: 'General' }], groups: {}, settings: [] } },
  },
  {
    name: 'getSettingsValues → GET /api/omp/settings/values',
    run: () => getSettingsValues(),
    url: '/api/omp/settings/values',
    method: 'GET',
    payload: { values: { theme: 'cinema-dark' } },
  },
  {
    name: 'setSetting → PUT /api/omp/settings with { path, value }',
    run: () => setSetting('compaction.enabled', true),
    url: '/api/omp/settings',
    method: 'PUT',
    reqBody: { path: 'compaction.enabled', value: true },
    payload: { ok: true },
  },
  {
    name: 'listFacadeProviders → GET /api/omp/providers',
    run: () => listFacadeProviders(),
    url: '/api/omp/providers',
    method: 'GET',
    payload: { providers: [{ id: 'local-server', name: 'Local', authenticated: true }] },
  },
  {
    name: 'createFacadeProvider → POST /api/omp/providers with the body verbatim',
    run: () =>
      createFacadeProvider({
        name: 'vllm',
        baseUrl: 'http://192.168.1.10:8000/v1',
        auth: 'none',
        models: [{ id: 'Qwen/Qwen3.8-Flash-Next-FP8', contextWindow: 262144 }],
      }),
    url: '/api/omp/providers',
    method: 'POST',
    reqBody: {
      name: 'vllm',
      baseUrl: 'http://192.168.1.10:8000/v1',
      auth: 'none',
      models: [{ id: 'Qwen/Qwen3.8-Flash-Next-FP8', contextWindow: 262144 }],
    },
    payload: { ok: true, provider: 'vllm' },
  },
  {
    name: 'deleteFacadeProvider → DELETE /api/omp/providers/{id}',
    run: () => deleteFacadeProvider('vllm'),
    url: '/api/omp/providers/vllm',
    method: 'DELETE',
    payload: { ok: true },
  },
  {
    name: 'setProviderKey → PUT /api/omp/providers/{id}/key with { apiKey }',
    run: () => setProviderKey('vllm', 'sk-secret'),
    url: '/api/omp/providers/vllm/key',
    method: 'PUT',
    reqBody: { apiKey: 'sk-secret' },
    payload: { ok: true, provider: 'vllm', authenticated: true },
  },
  {
    name: 'removeProviderKey → DELETE /api/omp/providers/{id}/key',
    run: () => removeProviderKey('vllm'),
    url: '/api/omp/providers/vllm/key',
    method: 'DELETE',
    payload: { ok: true, provider: 'vllm', authenticated: false },
  },
  {
    name: 'verifyProvider → POST /api/omp/providers/{id}/verify returns the result unwrapped',
    run: () => verifyProvider('vllm'),
    url: '/api/omp/providers/vllm/verify',
    method: 'POST',
    payload: { ok: true, provider: 'vllm', reachable: true, modelCount: 1 },
  },
  {
    name: 'listOmpAgents → GET /api/omp/agents',
    run: () => listOmpAgents(),
    url: '/api/omp/agents',
    method: 'GET',
    payload: { agents: [{ name: 'scout', source: 'bundled' }] },
  },
  {
    name: 'listOmpSkills → GET /api/omp/skills keeps optional warnings',
    run: () => listOmpSkills(),
    url: '/api/omp/skills',
    method: 'GET',
    payload: {
      skills: [{ name: 'santa-loop', description: 'd', path: '/s' }],
      warnings: '1 dir unreadable',
    },
  },
  {
    name: 'listDiskSessions() → GET /api/omp/sessions with no query string',
    run: () => listDiskSessions(),
    url: '/api/omp/sessions',
    method: 'GET',
    payload: { sessions: [{ id: 'd1', path: '/root/.omp/s1.jsonl', cwd: '/w' }] },
  },
  {
    name: 'readDiskSession → GET /api/omp/sessions/read with encoded ?path=',
    run: () => readDiskSession('/root/.omp/a s.jsonl'),
    url: '/api/omp/sessions/read?path=%2Froot%2F.omp%2Fa%20s.jsonl',
    method: 'GET',
    payload: { transcript: { id: 'd1', path: '/root/.omp/a s.jsonl', messages: [] } },
  },
];

describe('endpoint wire contract', () => {
  it.each(wireCases)('$name', async ({ run, url, method, reqBody, payload }) => {
    stubStorage();
    const calls = stubFetch(jsonResponse(payload));
    const result = await run();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(url);
    expect(calls[0].method).toBe(method);
    expect(calls[0].body).toEqual(reqBody ?? null);
    // request() returns the parsed body verbatim — no envelope unwrapping.
    expect(result).toEqual(payload);
    expect(headerEntries(calls[0].headers)).toEqual({ 'content-type': 'application/json' });
  });
});

/* ── body/query contract pins ─────────────────────────────────────────── */

describe('createSession body contract', () => {
  it('sends exactly { model } for a plain create and { model, cwd } with a cwd (resumePath never leaks in)', async () => {
    stubStorage();
    // factory responder: each call needs a fresh Response (bodies are single-read)
    const calls = stubFetch(() => jsonResponse({ session: { id: 's1' } }));
    await createSession(makeModel());
    expect(Object.keys(calls[0].body as Record<string, unknown>)).toEqual(['model']);

    await createSession(makeModel(), '/home/user/project');
    const plain = calls[1].body as Record<string, unknown>;
    expect(Object.keys(plain)).toEqual(['model', 'cwd']);
    expect('resumePath' in plain).toBe(false);
  });

  it('includes resumePath only when it is a non-empty string', async () => {
    stubStorage();
    const calls = stubFetch(() => jsonResponse({ session: { id: 's1' } }));
    await createSession(makeModel(), '/w', '/root/.omp/session.jsonl');
    expect(Object.keys(calls[0].body as Record<string, unknown>)).toEqual([
      'model',
      'cwd',
      'resumePath',
    ]);
    // falsy resumePath is dropped by the conditional spread, same as omitted
    await createSession(makeModel(), '/w', '');
    expect('resumePath' in (calls[1].body as Record<string, unknown>)).toBe(false);
  });
});

describe('query parameter encoding', () => {
  it('percent-encodes browseWorkspace / listDiskSessions / readDiskSession values', async () => {
    stubStorage();
    const browse = stubFetch(jsonResponse({ path: '/a b', entries: [] }));
    await browseWorkspace('/a b');
    expect(browse[0].url).toBe('/api/workspaces/browse?path=%2Fa%20b');

    const disk = stubFetch(jsonResponse({ sessions: [] }));
    await listDiskSessions('/x y');
    expect(disk[0].url).toBe('/api/omp/sessions?cwd=%2Fx%20y');

    const read = stubFetch(jsonResponse({ transcript: { id: 'd', path: '', messages: [] } }));
    await readDiskSession('/tmp/a&b.jsonl');
    expect(read[0].url).toBe('/api/omp/sessions/read?path=%2Ftmp%2Fa%26b.jsonl');
  });
});

describe('path id interpolation', () => {
  it('interpolates path ids raw into the URL (pin: server-issued ids only; only query params are encoded)', async () => {
    stubStorage();
    const calls = stubFetch(jsonResponse({ session: { id: 'a b/c' } }));
    await getSession('a b/c');
    expect(calls[0].url).toBe('/api/sessions/a b/c');
  });
});
