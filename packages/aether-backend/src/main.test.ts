import { describe, it, expect } from 'vitest';
import { resolveStartupBind } from './main.js';

/**
 * resolveStartupBind is the ONLY side-effect surface main.ts exports; the
 * module itself must import inertly under vitest (no server bind, no process
 * handlers) — see launchedAsEntrypoint() in main.ts. This import passing at
 * all is part of what this file pins.
 */
describe('resolveStartupBind', () => {
  it('always allows loopback binds — no key or allow-flag needed', () => {
    for (const host of ['127.0.0.1', 'localhost', '::1']) {
      expect(resolveStartupBind(host, false, false)).toEqual({ ok: true });
    }
  });

  it('allows a non-loopback bind when an API key is configured', () => {
    expect(resolveStartupBind('0.0.0.0', true, false)).toEqual({ ok: true });
  });

  it('allows a non-loopback bind with the explicit AETHER_ALLOW_UNAUTHENTICATED opt-in', () => {
    expect(resolveStartupBind('0.0.0.0', false, true)).toEqual({ ok: true });
  });

  it('refuses a non-loopback bind with neither key nor opt-in, naming AETHER_API_KEY', () => {
    const res = resolveStartupBind('0.0.0.0', false, false);
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected refusal, got ok');
    expect(res.reason).toContain('AETHER_API_KEY');
    expect(res.reason).toContain('AETHER_ALLOW_UNAUTHENTICATED');
    expect(res.reason).toContain('0.0.0.0');
  });

  it('treats any unknown interface like 0.0.0.0 (specific LAN binds are not exempt)', () => {
    expect(resolveStartupBind('192.168.1.10', false, false).ok).toBe(false);
    expect(resolveStartupBind('192.168.1.10', true, false)).toEqual({ ok: true });
  });

  it('is pure: repeated calls with equal inputs return equal verdicts', () => {
    expect(resolveStartupBind('0.0.0.0', false, false)).toEqual(
      resolveStartupBind('0.0.0.0', false, false),
    );
  });
});
