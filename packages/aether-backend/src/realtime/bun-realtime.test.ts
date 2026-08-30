/**
 * Tests for the Bun realtime hub's upgrade gate (D2).
 *
 * The vitest suite runs under NODE, which cannot resolve the 'bun' module —
 * hence the hub keeps `serve` behind start() and exposes the whole upgrade
 * authorization decision as the pure `authorizeRealtimeUpgrade` seam. These
 * tests drive that seam with structural request doubles (no socket, no Bun).
 */
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import {
  authorizeRealtimeUpgrade,
  extractRealtimeKey,
  overBuffered,
  MAX_BUFFERED_BYTES,
  BunRealtimeHub,
  type HubRequestLike,
} from './bun-realtime.js';
// Cross-module parity pin: the legacy manager's backlog cap is the reference
// this bound mirrors. Node-safe (websocket.ts imports only node: builtins).
import { MAX_WS_OUTBOUND_BACKLOG } from '../websocket.js';

/** Structural Request double: URL string + case-insensitive header map. */
function req(url: string, headers: Record<string, string> = {}): HubRequestLike {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return { url, headers: { get: (name: string) => lower[name.toLowerCase()] ?? null } };
}

const BASE = 'ws://127.0.0.1:3999/';
const KEY = 'sekrit';
/** Stand-in for main.ts's authenticate callback (key equality only). */
const authenticate = (r: HubRequestLike): boolean => extractRealtimeKey(r) === KEY;

describe('authorizeRealtimeUpgrade', () => {
  it('allows everything when no callbacks are configured (auth disabled, no origin rule)', () => {
    expect(authorizeRealtimeUpgrade(req(BASE))).toBe('allow');
    expect(authorizeRealtimeUpgrade(req(BASE), {})).toBe('allow');
  });

  it('rejects with 401 when authenticate is provided and no credential is present (D2)', () => {
    // This is the exact CRITICAL: an unconditional upgrade would stream live
    // engine frames to any socket. Reverting the gate flips this to 'allow'.
    expect(authorizeRealtimeUpgrade(req(BASE), { authenticate })).toBe(401);
  });

  it('accepts Authorization: Bearer, lowercase bearer, X-API-Key and ?apikey=', () => {
    const opts = { authenticate };
    expect(authorizeRealtimeUpgrade(req(BASE, { Authorization: `Bearer ${KEY}` }), opts)).toBe(
      'allow',
    );
    expect(authorizeRealtimeUpgrade(req(BASE, { Authorization: `bearer ${KEY}` }), opts)).toBe(
      'allow',
    );
    expect(authorizeRealtimeUpgrade(req(BASE, { 'X-API-Key': KEY }), opts)).toBe('allow');
    expect(authorizeRealtimeUpgrade(req(`${BASE}?apikey=${KEY}`), opts)).toBe('allow');
  });

  it('rejects a wrong credential with 401', () => {
    expect(authorizeRealtimeUpgrade(req(BASE, { 'X-API-Key': 'wrong' }), { authenticate })).toBe(
      401,
    );
    expect(authorizeRealtimeUpgrade(req(`${BASE}?apikey=wrong`), { authenticate })).toBe(401);
  });

  it('accepts a valid single-use ?ticket= via validateTicket instead of a key (X3)', () => {
    let consumed = false;
    const validateTicket = (t: string): boolean => {
      if (t !== 't1cket' || consumed) return false;
      consumed = true; // delete-on-use, like the real store
      return true;
    };
    const opts = { authenticate, validateTicket };
    expect(authorizeRealtimeUpgrade(req(`${BASE}?ticket=t1cket`), opts)).toBe('allow');
    // Second use of the same ticket must fall through to the credential gate
    // (no key present → 401): proves single-use is enforced, not swallowed.
    expect(authorizeRealtimeUpgrade(req(`${BASE}?ticket=t1cket`), opts)).toBe(401);
  });

  it('rejects an invalid/expired ticket with 401 when no key is present', () => {
    expect(
      authorizeRealtimeUpgrade(req(`${BASE}?ticket=expired`), {
        authenticate,
        validateTicket: () => false,
      }),
    ).toBe(401);
    // validateTicket not provided at all → the ticket is not a credential.
    expect(authorizeRealtimeUpgrade(req(`${BASE}?ticket=t1cket`), { authenticate })).toBe(401);
  });

  it('enforces the Origin gate with 403 EVEN when auth is disabled (D5 wiring)', () => {
    // Auth off (no authenticate callback) must NOT skip the origin rule.
    expect(authorizeRealtimeUpgrade(req(BASE), { isOriginAllowed: () => false })).toBe(403);
  });

  it('origin rejection (403) wins over a valid credential', () => {
    expect(
      authorizeRealtimeUpgrade(req(BASE, { 'X-API-Key': KEY }), {
        authenticate,
        isOriginAllowed: () => false,
      }),
    ).toBe(403);
  });

  it('passes when the origin rule accepts and credentials are valid', () => {
    expect(
      authorizeRealtimeUpgrade(req(BASE, { Origin: 'http://localhost:3081', 'X-API-Key': KEY }), {
        authenticate,
        isOriginAllowed: (r) => r.headers.get('origin') === 'http://localhost:3081',
      }),
    ).toBe('allow');
  });
});

describe('extractRealtimeKey', () => {
  it('prefers Bearer, falls back to X-API-Key then ?apikey=; null when absent', () => {
    expect(extractRealtimeKey(req(BASE, { Authorization: `Bearer ${KEY}` }))).toBe(KEY);
    expect(extractRealtimeKey(req(BASE, { Authorization: 'Bearer' }))).toBe(null); // no token
    expect(extractRealtimeKey(req(BASE, { 'X-API-Key': KEY }))).toBe(KEY);
    expect(extractRealtimeKey(req(`${BASE}?apikey=${KEY}`))).toBe(KEY);
    // Bearer wins over weaker surfaces (deterministic precedence).
    expect(
      extractRealtimeKey(
        req(`${BASE}?apikey=query`, { 'X-API-Key': 'header', Authorization: 'Bearer bearer' }),
      ),
    ).toBe('bearer');
    expect(extractRealtimeKey(req(BASE))).toBe(null);
  });

  it('URL-decodes the apikey query param', () => {
    expect(extractRealtimeKey(req(`${BASE}?apikey=a%20b`))).toBe('a b');
  });

  it('survives malformed URLs (returns null, never throws)', () => {
    expect(extractRealtimeKey(req('::not a url::', { 'X-API-Key': KEY }))).toBe(KEY);
    expect(extractRealtimeKey(req('::not a url::'))).toBe(null);
  });
});

describe('BunRealtimeHub construction under node', () => {
  it('constructs from the options object without touching the bun runtime', () => {
    // Static 'bun' imports would crash this node-only suite at import time;
    // the hub keeps the runtime behind start(). Construction alone is safe.
    const hub = new BunRealtimeHub({ port: 3999, host: '127.0.0.1', authenticate });
    expect(hub.isRunning).toBe(false);
    expect(hub.clientCount).toBe(0);
    expect(hub.uptimeMs).toBe(0);
  });
});

/**
 * Outbound bound (broadcast backpressure guard).
 *
 * start() needs Bun.serve, but broadcast()/dropClient() only read the
 * `started` flag and the `clients` set — seeding that private state lets
 * these tests drive the REAL broadcast loop under Node with socket fakes,
 * so the cap check, teardown choice and eviction are all discriminated
 * (removing the bound from broadcast() fails the over-cap case; flipping
 * the strict `>` to `>=` fails the at-cap case; evicting on send()'s -1
 * backpressure signal fails the slow-but-healthy case).
 */

interface FakeClient {
  data: Record<string, unknown>;
  sent: string[];
  terminated: boolean;
  closeCode: number | undefined;
  send(frame: string): number;
  close(code?: number): void;
  getBufferedAmount?: () => number;
  terminate?: () => void;
}

interface FakeOpts {
  /** ws.data.filter subscription set (hub honors it before sending). */
  filter?: string[];
  /** What getBufferedAmount() reports (default 0 = healthy queue). */
  buffered?: number;
  /** Explicit send() return override; default frame.length (1+ = bytes). */
  sendStatus?: number;
  throwOnSend?: boolean;
  /** Runtime without the optional method → bound must degrade, not crash. */
  noBufferProbe?: boolean;
  noTerminate?: boolean;
}

function fakeClient(o: FakeOpts = {}): FakeClient {
  const c: FakeClient = {
    data: o.filter ? { filter: new Set(o.filter) } : {},
    sent: [],
    terminated: false,
    closeCode: undefined,
    send(frame: string): number {
      if (o.throwOnSend) throw new Error('socket is dead');
      // Bun's documented return (websockets.mdx, Backpressure): -1 enqueued
      // with backpressure, 0 dropped (NOT enqueued), 1+ bytes written.
      const status = o.sendStatus ?? frame.length;
      if (status !== 0) c.sent.push(frame);
      return status;
    },
    close(code?: number): void {
      c.closeCode = code;
    },
  };
  if (!o.noBufferProbe) c.getBufferedAmount = () => o.buffered ?? 0;
  if (!o.noTerminate)
    c.terminate = () => {
      c.terminated = true;
    };
  return c;
}

function startedHub(): { hub: BunRealtimeHub; clients: Set<FakeClient> } {
  const hub = new BunRealtimeHub();
  const inner = hub as unknown as { started: boolean; clients: Set<FakeClient> };
  inner.started = true; // broadcast() gate; start() itself stays Bun-only
  return { hub, clients: inner.clients };
}

describe('overBuffered (pure outbound bound)', () => {
  it('keeps at exactly the cap, drops above it (legacy strict > parity)', () => {
    expect(overBuffered(9, 10)).toBe(false);
    expect(overBuffered(10, 10)).toBe(false); // AT the cap = keep
    expect(overBuffered(11, 10)).toBe(true); // above = drop
    expect(overBuffered(MAX_BUFFERED_BYTES, MAX_BUFFERED_BYTES)).toBe(false);
    expect(overBuffered(MAX_BUFFERED_BYTES + 1, MAX_BUFFERED_BYTES)).toBe(true);
  });

  it('never evicts on zero/negative/NaN readings', () => {
    expect(overBuffered(0, 10)).toBe(false);
    expect(overBuffered(-5_000, 10)).toBe(false);
    expect(overBuffered(NaN, 10)).toBe(false);
    expect(overBuffered(0, 0)).toBe(false);
    expect(overBuffered(NaN, 0)).toBe(false);
  });

  it('caps the same order of magnitude as the legacy websocket.ts backlog', () => {
    // Parity, not bit-equality: the mirror comment must stay honest.
    expect(MAX_BUFFERED_BYTES).toBeLessThanOrEqual(MAX_WS_OUTBOUND_BACKLOG * 10);
    expect(MAX_BUFFERED_BYTES).toBeGreaterThanOrEqual(MAX_WS_OUTBOUND_BACKLOG / 10);
  });
});

describe('BunRealtimeHub broadcast outbound bound', () => {
  // dropClient warns per eviction; silence (and capture) so the suite output
  // stays readable and the log-leak assertion can inspect the lines.
  let warn: MockInstance;
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it('terminates and evicts a client whose buffered bytes exceed the cap', () => {
    const { hub, clients } = startedHub();
    // send() returns -1 (enqueued, backpressured) AND the queue is over the
    // byte cap → the bound, not the status, must fire the teardown.
    const stalled = fakeClient({ sendStatus: -1, buffered: MAX_BUFFERED_BYTES + 1 });
    clients.add(stalled);
    hub.broadcast('engine', { hello: 'world' });
    expect(stalled.sent).toHaveLength(1); // the frame WAS enqueued first
    expect(stalled.terminated).toBe(true); // abrupt teardown, not a close handshake
    expect(stalled.closeCode).toBeUndefined();
    expect(hub.clientCount).toBe(0); // evicted NOW, close callback may be late
    expect(clients.size).toBe(0);
  });

  it('keeps a client at exactly the cap (fails if the strict > flips to >=)', () => {
    const { hub, clients } = startedHub();
    const atCap = fakeClient({ buffered: MAX_BUFFERED_BYTES });
    clients.add(atCap);
    hub.broadcast('engine', {});
    expect(atCap.terminated).toBe(false);
    expect(hub.clientCount).toBe(1);
  });

  it('keeps a slow-but-healthy client: send() -1 with the queue under the cap', () => {
    // Pins the documented -1 semantics (bun-types websockets.mdx): evicting
    // on any non-positive send() status would drop the GUI on its first
    // backpressured frame — the opposite of a byte bound.
    const { hub, clients } = startedHub();
    const slow = fakeClient({ sendStatus: -1, buffered: 4_096 });
    clients.add(slow);
    hub.broadcast('engine', {});
    expect(slow.sent).toHaveLength(1);
    expect(slow.terminated).toBe(false);
    expect(hub.clientCount).toBe(1);
  });

  it('degrades gracefully when the runtime lacks getBufferedAmount', () => {
    const { hub, clients } = startedHub();
    const legacy = fakeClient({ noBufferProbe: true });
    clients.add(legacy);
    hub.broadcast('engine', {});
    expect(legacy.sent).toHaveLength(1); // frame still flows
    expect(legacy.terminated).toBe(false); // no probe → never a false drop
    expect(hub.clientCount).toBe(1);
  });

  it('falls back to close(1011) when the runtime lacks terminate', () => {
    const { hub, clients } = startedHub();
    const noTerm = fakeClient({ noTerminate: true, buffered: MAX_BUFFERED_BYTES + 1 });
    clients.add(noTerm);
    hub.broadcast('engine', {});
    expect(noTerm.closeCode).toBe(1011); // server-error close
    expect(hub.clientCount).toBe(0);
  });

  it('evicts a socket whose send() reports 0 (dropped: connection issue)', () => {
    const { hub, clients } = startedHub();
    const dead = fakeClient({ sendStatus: 0 });
    const healthy = fakeClient();
    clients.add(dead);
    clients.add(healthy);
    hub.broadcast('engine', {});
    expect(dead.terminated).toBe(true);
    expect(dead.sent).toHaveLength(0); // 0 = never enqueued
    expect(healthy.sent).toHaveLength(1); // broadcast continued to peers
    expect(hub.clientCount).toBe(1);
  });

  it('evicts a socket whose send() throws, keeping healthy peers', () => {
    const { hub, clients } = startedHub();
    const dead = fakeClient({ throwOnSend: true });
    const healthy = fakeClient();
    clients.add(dead);
    clients.add(healthy);
    hub.broadcast('engine', {});
    expect(hub.clientCount).toBe(1);
    expect(clients.has(dead)).toBe(false);
    expect(healthy.sent).toHaveLength(1);
  });

  it('skips clients whose filter excludes the frame type', () => {
    const { hub, clients } = startedHub();
    const other = fakeClient({ filter: ['loop'] });
    const engine = fakeClient({ filter: ['engine'] });
    const unfiltered = fakeClient();
    clients.add(other);
    clients.add(engine);
    clients.add(unfiltered);
    hub.broadcast('engine', { n: 1 });
    expect(other.sent).toHaveLength(0);
    expect(other.terminated).toBe(false); // excluded ≠ dead
    expect(engine.sent).toHaveLength(1);
    expect(unfiltered.sent).toHaveLength(1); // no filter = everything
    // Frame shape contract with the frontend realtime.ts stays intact.
    const frame = JSON.parse(engine.sent[0]) as { type: string; payload: unknown };
    expect(frame.type).toBe('engine');
    expect(frame.payload).toEqual({ n: 1 });
  });

  it('teardown log carries no frame or payload content', () => {
    const { hub, clients } = startedHub();
    const stalled = fakeClient({ buffered: 2 * MAX_BUFFERED_BYTES });
    clients.add(stalled);
    hub.broadcast('engine', { transcript: 'CANARY-PAYLOAD-CONTENT' });
    const logged = warn.mock.calls.map((call) => call.map(String).join(' ')).join('\n');
    expect(logged).toContain('dropped client'); // observable, but…
    expect(logged).not.toContain('CANARY-PAYLOAD-CONTENT'); // …never payload
    expect(logged).not.toContain('engine'); // …not even the frame type
  });
});
