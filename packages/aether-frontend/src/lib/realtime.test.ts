/**
 * RealtimeClient wire-contract tests (node env — no jsdom).
 *
 * Everything the class touches is stubbed:
 * - `WebSocket`: hand-rolled fake (scriptable open/message/close, send
 *   recorder, instance registry). Node 22's native undici WebSocket exists
 *   but cannot be scripted, so it must be replaced.
 * - `window`: only `window.location.{protocol,hostname}` is ever read.
 * - `fetch`: one recorder-backed stub answering /health and
 *   /api/realtime-ticket; each test swaps the responder.
 * - `getApiKey()` from ./api: whole-module mock (real api.ts would drag in
 *   sessionStorage).
 * - timers: fake, so the 1s→30s backoff ladder advances deterministically.
 *
 * The module-level getRealtimeClient() singleton is not resettable, so class
 * tests use `new RealtimeClient()` directly and the singleton test re-imports
 * the module via vi.resetModules().
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RealtimeClient } from './realtime';

// ── ./api mock (getApiKey only — realtime.ts's sole import from it) ──
const { getApiKeyMock } = vi.hoisted(() => ({
  getApiKeyMock: vi.fn(() => null as string | null),
}));
vi.mock('./api', () => ({ getApiKey: getApiKeyMock }));

// ── Fake WebSocket ───────────────────────────────────────────────────
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  closedByClient = false;
  onopen: ((ev?: unknown) => void) | null = null;
  onmessage: ((m: { data: unknown }) => void) | null = null;
  onclose: ((ev?: unknown) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closedByClient = true;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }

  // Scripted server-side events (tests call these explicitly).
  fireOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
  fireMessage(data: unknown): void {
    this.onmessage?.({ data });
  }
  fireClose(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }
}

// ── fetch stub ───────────────────────────────────────────────────────
interface FakeResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}
interface FetchCall {
  url: string;
  init?: { method?: string; headers?: Record<string, string> };
}

const jsonRes = (body: unknown, ok = true): FakeResponse => ({
  ok,
  status: ok ? 200 : 500,
  json: async () => body,
});

let fetchCalls: FetchCall[] = [];
let healthResponder: () => Promise<FakeResponse>;
let ticketResponder: () => Promise<FakeResponse>;

const HEALTH_PORT = 4_321;
const healthyHealth = (): Promise<FakeResponse> =>
  Promise.resolve(jsonRes({ status: 'ok', realtime: { port: HEALTH_PORT } }));

// ── helpers ──────────────────────────────────────────────────────────
const setWindow = (protocol: 'http:' | 'https:', hostname = 'host.test'): void => {
  vi.stubGlobal('window', { location: { protocol, hostname } });
};

/** Drain pending microtasks (stubbed fetches resolve via promise chains). */
const settle = (): Promise<unknown> => vi.advanceTimersByTimeAsync(0);

const sockets = (): FakeWebSocket[] => FakeWebSocket.instances;
const lastSocket = (): FakeWebSocket => {
  const s = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  if (!s) throw new Error('no WebSocket instance created');
  return s;
};

/** connect → settle → open the freshly created socket. */
async function openSocket(client: RealtimeClient): Promise<FakeWebSocket> {
  client.connect();
  await settle();
  const s = lastSocket();
  s.fireOpen();
  return s;
}

const ENGINE_FRAME = {
  type: 'engine',
  payload: { namespace: 'session', sessionId: 's-1', event: { kind: 'message_update' } },
  timestamp: '2026-08-30T00:00:00.000Z',
} as const;

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.instances = [];
  fetchCalls = [];
  getApiKeyMock.mockReturnValue(null);
  healthResponder = healthyHealth;
  ticketResponder = async () => jsonRes({ ticket: 'tk-1' });
  const fetchMock = vi.fn(async (url: string, init?: unknown): Promise<FakeResponse> => {
    fetchCalls.push({ url, init: init as FetchCall['init'] });
    if (url === '/health') return healthResponder();
    if (url === '/api/realtime-ticket') return ticketResponder();
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('WebSocket', FakeWebSocket);
  setWindow('http:');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
  getApiKeyMock.mockReset();
});

// ── connect pipeline ─────────────────────────────────────────────────
describe('RealtimeClient connect pipeline', () => {
  it('discovers the port via /health then mints ONE fresh ticket per attempt (single-use contract)', async () => {
    const client = new RealtimeClient();
    client.connect();
    await settle();

    expect(fetchCalls.map((c) => c.url)).toEqual(['/health', '/api/realtime-ticket']);
    expect(fetchCalls[1].init?.method).toBe('POST');
    // No API key stored → the ticket request carries no authorization header.
    expect(fetchCalls[1].init?.headers).toBeUndefined();
    expect(sockets()).toHaveLength(1);

    // A reconnect attempt must re-mint: tickets are single-use with a short TTL.
    getApiKeyMock.mockReturnValue('secret');
    lastSocket().fireClose();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(fetchCalls.map((c) => c.url)).toEqual([
      '/health',
      '/api/realtime-ticket',
      '/health',
      '/api/realtime-ticket',
    ]);
    // Once a key IS configured, it rides along as a Bearer credential.
    expect(fetchCalls[3].init?.headers).toEqual({ authorization: 'Bearer secret' });
    expect(sockets()).toHaveLength(2);
  });

  it('builds ws:// for http pages and wss:// for https pages, host from window.location and port from /health', async () => {
    ticketResponder = async () => jsonRes({ ticket: null }); // isolate scheme/host/port
    const plain = new RealtimeClient();
    plain.connect();
    await settle();
    expect(sockets()[0]?.url).toBe('ws://host.test:4321/');

    setWindow('https:', 'host.test');
    const secure = new RealtimeClient();
    secure.connect();
    await settle();
    expect(sockets()[1]?.url).toBe('wss://host.test:4321/');
  });

  it('appends the percent-encoded ticket when one is minted and a bare URL when the backend returns none', async () => {
    ticketResponder = async () => jsonRes({ ticket: 'tk/1 x' });
    const client = new RealtimeClient();
    client.connect();
    await settle();
    expect(sockets()[0]?.url).toBe('ws://host.test:4321/?ticket=tk%2F1%20x');

    // Auth-off backend (ticket: null) or missing endpoint → uncredentialed URL.
    ticketResponder = async () => jsonRes({ ticket: null });
    const authless = new RealtimeClient();
    authless.connect();
    await settle();
    expect(sockets()[1]?.url).toBe('ws://host.test:4321/');
  });

  it('connect is idempotent while bootstrapping and while the socket is open (one health fetch, one socket)', async () => {
    const client = new RealtimeClient();
    client.connect();
    client.connect();
    client.subscribe(() => {}); // subscribe also calls connect()
    await settle();

    expect(fetchCalls.filter((c) => c.url === '/health')).toHaveLength(1);
    expect(sockets()).toHaveLength(1);

    lastSocket().fireOpen();
    client.connect();
    await settle();
    expect(fetchCalls.filter((c) => c.url === '/health')).toHaveLength(1);
    expect(sockets()).toHaveLength(1);
    expect(client.connected).toBe(true);
  });
});

// ── subscribe frame & message fan-out ────────────────────────────────
describe('RealtimeClient frames', () => {
  it('sends the engine filter subscribe frame as the first bytes on every open (backend contract: {filter:["engine"]})', async () => {
    const client = new RealtimeClient();
    const first = await openSocket(client);
    // The hub (websocket.ts / bun-realtime.ts) reads ONLY `parsed.filter` —
    // the frame intentionally carries no `type` field.
    expect(first.sent).toEqual(['{"filter":["engine"]}']);

    // Reconnects re-subscribe: the socket-level filter dies with the socket.
    first.fireClose();
    await vi.advanceTimersByTimeAsync(1_000);
    const second = lastSocket();
    second.fireOpen();
    expect(second.sent[0]).toBe('{"filter":["engine"]}');
  });

  it('fans every parsable frame to handlers verbatim and silently drops un-parsable payloads', async () => {
    const seen: unknown[] = [];
    const client = new RealtimeClient();
    const unsubscribe = client.subscribe((frame) => seen.push(frame));
    const socket = await openSocket(client);

    socket.fireMessage(JSON.stringify(ENGINE_FRAME));
    expect(seen).toEqual([ENGINE_FRAME]);

    // Foreign but parsable shapes are forwarded verbatim — the client does
    // NOT validate frame shape; consumers (chat reducer) guard on payload.
    socket.fireMessage(JSON.stringify({ hello: 'world' }));
    expect(seen).toHaveLength(2);
    expect(seen[1]).toEqual({ hello: 'world' });

    // Un-parsable data must neither reach handlers nor throw.
    expect(() => socket.fireMessage('not json')).not.toThrow();
    expect(seen).toHaveLength(2);

    unsubscribe();
    socket.fireMessage(JSON.stringify(ENGINE_FRAME));
    expect(seen).toHaveLength(2);
  });
});

// ── backoff ladder ───────────────────────────────────────────────────
describe('RealtimeClient backoff', () => {
  it('retries after the first close at 1s, then doubles and caps the ladder at 30s', async () => {
    const client = new RealtimeClient();
    client.connect();
    await settle();

    const ladder = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000];
    for (const delay of ladder) {
      const before = sockets().length;
      lastSocket().fireClose();
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(sockets()).toHaveLength(before); // not yet — retry not early
      await vi.advanceTimersByTimeAsync(1);
      expect(sockets()).toHaveLength(before + 1); // retried exactly at the delay
    }
  });

  it('resets the ladder back to 1s after a successful open', async () => {
    const client = new RealtimeClient();
    client.connect();
    await settle();

    lastSocket().fireClose(); // schedules 1s, ladder now 2s
    await vi.advanceTimersByTimeAsync(1_000);
    const reopened = lastSocket();
    reopened.fireOpen(); // reset point

    reopened.fireClose(); // must be 1s again, NOT the 2s the ladder had reached
    await vi.advanceTimersByTimeAsync(999);
    expect(sockets()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets()).toHaveLength(3);
  });
});

// ── onReconnect semantics ────────────────────────────────────────────
describe('RealtimeClient onReconnect', () => {
  it('never fires on the initial open and fires on every later one (everOpened gate)', async () => {
    const calls: string[] = [];
    const client = new RealtimeClient();
    client.onReconnect(() => calls.push('r1'));
    client.onReconnect(() => calls.push('r2'));

    const first = await openSocket(client);
    expect(calls).toEqual([]); // first open dropped nothing — no refetch churn

    first.fireClose();
    await vi.advanceTimersByTimeAsync(1_000);
    lastSocket().fireOpen();
    expect(calls).toEqual(['r1', 'r2']);

    lastSocket().fireClose();
    await vi.advanceTimersByTimeAsync(1_000);
    lastSocket().fireOpen();
    expect(calls).toEqual(['r1', 'r2', 'r1', 'r2']);
  });

  it('fans out over a snapshot so a callback may unsubscribe a sibling mid-fan-out', async () => {
    const fired: string[] = [];
    const client = new RealtimeClient();
    client.onReconnect(() => {
      fired.push('a');
      offB(); // kills b, which is queued BEHIND a
    });
    const offB = client.onReconnect(() => fired.push('b'));

    await openSocket(client); // first open (no fan-out)
    lastSocket().fireClose();
    await vi.advanceTimersByTimeAsync(1_000);
    lastSocket().fireOpen();

    expect(fired).toEqual(['a', 'b']); // live-set iteration would skip b
  });
});

// ── manual shutdown latch ────────────────────────────────────────────
describe('RealtimeClient close', () => {
  it('close() latches: no retry after close, later subscribe/connect stay down, handlers unregister', async () => {
    const handler = vi.fn();
    const client = new RealtimeClient();
    client.subscribe(handler);
    const socket = await openSocket(client);

    // Handler is live before shutdown…
    socket.fireMessage(JSON.stringify(ENGINE_FRAME));
    expect(handler).toHaveBeenCalledTimes(1);

    client.close();
    expect(socket.closedByClient).toBe(true);

    // …unregistered by close() even though the fake socket's listeners persist.
    socket.fireMessage(JSON.stringify(ENGINE_FRAME));
    expect(handler).toHaveBeenCalledTimes(1);

    // A late close event (real sockets fire it async) must not re-arm the ladder.
    socket.fireClose();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(sockets()).toHaveLength(1);

    // The latch survives future subscribes/connects: no fetches, no sockets.
    const callsBefore = fetchCalls.length;
    client.subscribe(() => {});
    client.connect();
    await settle();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchCalls).toHaveLength(callsBefore);
    expect(sockets()).toHaveLength(1);
  });
});

// ── degradation paths ────────────────────────────────────────────────
describe('RealtimeClient degradation', () => {
  it('opens a bare-URL socket when the ticket fetch throws or answers non-OK (auth-off / older backend)', async () => {
    ticketResponder = async () => {
      throw new Error('network down');
    };
    const client = new RealtimeClient();
    client.connect();
    await settle();
    expect(sockets()[0]?.url).toBe('ws://host.test:4321/');

    ticketResponder = async () => jsonRes({ error: 'no such route' }, false);
    const olderBackend = new RealtimeClient();
    olderBackend.connect();
    await settle();
    expect(sockets()[1]?.url).toBe('ws://host.test:4321/');
  });

  it('walks the backoff ladder without a socket while /health is 500, port-less, or throwing — and connects once it recovers', async () => {
    const failing = [
      async (): Promise<FakeResponse> => jsonRes({ status: 'degraded' }, false), // 500
      async (): Promise<FakeResponse> => jsonRes({ status: 'ok' }), // no realtime.port
      async (): Promise<FakeResponse> => {
        throw new Error('health unreachable');
      },
    ];
    let attempt = 0;
    healthResponder = async () => failing[attempt++]();

    const client = new RealtimeClient();
    client.connect(); // attempt 1 (500) → scheduled at 1s
    await settle();
    expect(sockets()).toHaveLength(0);

    // Attempt 2 (ok but no realtime.port) fires at 1s, schedules 2s.
    await vi.advanceTimersByTimeAsync(999);
    expect(sockets()).toHaveLength(0);
    expect(attempt).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(attempt).toBe(2);
    expect(sockets()).toHaveLength(0);

    // Attempt 3 (fetch throws) fires at 2s, schedules 4s — no crash escapes.
    await vi.advanceTimersByTimeAsync(1_999);
    await vi.advanceTimersByTimeAsync(1);
    expect(attempt).toBe(3);
    expect(sockets()).toHaveLength(0);

    // Recovery on the 4s rung: health answers → port minted → ticket → socket.
    healthResponder = healthyHealth;
    await vi.advanceTimersByTimeAsync(3_999);
    expect(sockets()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets()).toHaveLength(1);
    expect(lastSocket().url).toBe('ws://host.test:4321/?ticket=tk-1');
  });
});

// ── process-wide singleton ───────────────────────────────────────────
describe('getRealtimeClient', () => {
  it('returns the same instance on every call and bootstraps a connection eagerly', async () => {
    vi.resetModules(); // module-level singleton is not otherwise resettable
    const mod = await import('./realtime');

    const client = mod.getRealtimeClient();
    expect(mod.getRealtimeClient()).toBe(client);

    await settle(); // eager connect (no caller invoked connect())
    expect(fetchCalls.map((c) => c.url)).toEqual(['/health', '/api/realtime-ticket']);
    expect(sockets()).toHaveLength(1);

    lastSocket().fireOpen();
    expect(client.connected).toBe(true);
    client.close();
  });
});
