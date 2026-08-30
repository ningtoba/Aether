/**
 * Tests for the Bun realtime hub's upgrade gate (D2).
 *
 * The vitest suite runs under NODE, which cannot resolve the 'bun' module —
 * hence the hub keeps `serve` behind start() and exposes the whole upgrade
 * authorization decision as the pure `authorizeRealtimeUpgrade` seam. These
 * tests drive that seam with structural request doubles (no socket, no Bun).
 */
import { describe, it, expect } from 'vitest';
import {
  authorizeRealtimeUpgrade,
  extractRealtimeKey,
  BunRealtimeHub,
  type HubRequestLike,
} from './bun-realtime.js';

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
