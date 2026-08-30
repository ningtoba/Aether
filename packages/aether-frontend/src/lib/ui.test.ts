/**
 * Unit tests for the pure formatters exported from components/ui.tsx.
 * Node environment: importing the module touches no DOM (DOM work lives
 * inside untested components/fns only).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fmtCompact, fmtRelative } from '../components/ui';

describe('fmtCompact', () => {
  it('renders empty string for non-finite input', () => {
    expect(fmtCompact(NaN)).toBe('');
    expect(fmtCompact(Infinity)).toBe('');
    expect(fmtCompact(-Infinity)).toBe('');
  });

  it('below 1000 rounds with no unit suffix', () => {
    expect(fmtCompact(0)).toBe('0');
    expect(fmtCompact(999)).toBe('999');
    // Surprise pinned: 999.6 rounds UP to 1000 while still using the unit-less branch.
    expect(fmtCompact(999.6)).toBe('1000');
  });

  it('kilo branch: 3 significant digits with trailing zeros stripped', () => {
    expect(fmtCompact(1000)).toBe('1K'); // '1.00' → '1'
    expect(fmtCompact(1500)).toBe('1.5K'); // '1.50' → '1.5'
    expect(fmtCompact(262_144)).toBe('262K'); // q ≥ 100 → 0 decimals
    expect(fmtCompact(15_000)).toBe('15K'); // q in [10,100) → 1 decimal, '15.0' → '15'
    expect(fmtCompact(-1500)).toBe('-1.5K'); // sign kept
  });

  it('mega/giga branches', () => {
    expect(fmtCompact(1_000_000)).toBe('1M');
    expect(fmtCompact(1_250_000)).toBe('1.25M');
    // Surprise pinned: 9_999_999 is q = 9.999999 → toFixed(2) = '10.00' → '10M',
    // it does NOT escalate to the B unit.
    expect(fmtCompact(9_999_999)).toBe('10M');
    expect(fmtCompact(1e9)).toBe('1B');
    expect(fmtCompact(1e12)).toBe('1T');
    expect(fmtCompact(1e15)).toBe('1P');
  });

  it('top-of-unit boundary stays on the smaller unit (999_999 → "1000K", not "1M")', () => {
    // q = 999.999 ≥ 100 → toFixed(0) rounds to '1000' and the unit stays K.
    expect(fmtCompact(999_999)).toBe('1000K');
  });
});

describe('fmtRelative', () => {
  const NOW = Date.parse('2026-08-30T12:00:00.000Z');
  afterEach(() => {
    vi.useRealTimers();
  });

  function withNow(fn: () => void): void {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      fn();
    } finally {
      vi.useRealTimers();
    }
  }

  const ago = (ms: number): number => NOW - ms;

  it('invalid or non-positive timestamps render nothing', () => {
    withNow(() => {
      expect(fmtRelative('not a date')).toBe('');
      expect(fmtRelative(0)).toBe('');
      expect(fmtRelative(-1)).toBe('');
      // A pre-epoch ISO string parses to a negative timestamp → ''.
      expect(fmtRelative('1969-12-31T23:59:59.000Z')).toBe('');
    });
  });

  it('future timestamps and sub-minute ages read "just now"', () => {
    withNow(() => {
      expect(fmtRelative(NOW + 60_000)).toBe('just now'); // future edge
      expect(fmtRelative(NOW)).toBe('just now'); // zero diff
      expect(fmtRelative(ago(59_000))).toBe('just now');
      expect(fmtRelative(ago(1_000))).toBe('just now');
      expect(fmtRelative(ago(59_999))).toBe('just now'); // still 0 whole minutes
    });
  });

  it('minute ladder starts at exactly 60s and runs under an hour', () => {
    withNow(() => {
      expect(fmtRelative(ago(60_000))).toBe('1m ago');
      expect(fmtRelative(ago(5 * 60_000))).toBe('5m ago');
      expect(fmtRelative(ago(59 * 60_000 + 59_000))).toBe('59m ago');
    });
  });

  it('hour ladder starts at exactly 60 minutes and runs under a day', () => {
    withNow(() => {
      expect(fmtRelative(ago(60 * 60_000))).toBe('1h ago');
      expect(fmtRelative(ago(2 * 3_600_000))).toBe('2h ago');
      expect(fmtRelative(ago(23 * 3_600_000 + 59 * 60_000))).toBe('23h ago');
    });
  });

  it('day ladder starts at exactly 24 hours and runs under 30 days', () => {
    withNow(() => {
      expect(fmtRelative(ago(24 * 3_600_000))).toBe('1d ago');
      expect(fmtRelative(ago(3 * 86_400_000))).toBe('3d ago');
      expect(fmtRelative(ago(29 * 86_400_000 + 23 * 3_600_000))).toBe('29d ago');
    });
  });

  it('month ladder uses 30-day months until 12 months, then years', () => {
    withNow(() => {
      expect(fmtRelative(ago(30 * 86_400_000))).toBe('1mo ago');
      expect(fmtRelative(ago(60 * 86_400_000))).toBe('2mo ago');
      expect(fmtRelative(ago(359 * 86_400_000))).toBe('11mo ago'); // floor(359/30) = 11
      expect(fmtRelative(ago(360 * 86_400_000))).toBe('1y ago'); // floor(360/30)=12 → 1y
      expect(fmtRelative(ago(730 * 86_400_000))).toBe('2y ago');
    });
  });
});
