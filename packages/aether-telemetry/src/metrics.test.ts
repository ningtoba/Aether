import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getMetrics, metrics } from './metrics.js';

// Mock the logger to avoid side effects
vi.mock('./logger.js', () => ({
  createLogger: () => ({
    trace: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('MetricsRegistry', () => {
  let registry: ReturnType<typeof getMetrics>;

  beforeEach(() => {
    // Reset the singleton registry
    registry = getMetrics();
    registry.reset();
  });

  describe('counter', () => {
    it('should register a counter and initialize to 0', () => {
      registry.counter('test_counter');
      const snapshot = registry.snapshot();
      expect(snapshot.counters['test_counter']).toBeDefined();
      expect(snapshot.counters['test_counter'].value).toBe(0);
    });

    it('should increment a counter', () => {
      registry.counter('requests');
      registry.increment('requests');
      expect(registry.snapshot().counters['requests'].value).toBe(1);
    });

    it('should increment by a custom value', () => {
      registry.counter('tokens');
      registry.increment('tokens', 150);
      expect(registry.snapshot().counters['tokens'].value).toBe(150);
    });

    it('should auto-register counter on first increment', () => {
      registry.increment('auto_counter', 5);
      expect(registry.snapshot().counters['auto_counter'].value).toBe(5);
    });

    it('should track description and unit', () => {
      registry.counter('api_calls', {
        description: 'Total API calls',
        unit: 'calls',
      });
      const c = registry.snapshot().counters['api_calls'];
      expect(c.description).toBe('Total API calls');
      expect(c.unit).toBe('calls');
    });

    it('should be idempotent on multiple calls', () => {
      registry.counter('same');
      registry.counter('same');
      registry.increment('same', 1);
      expect(registry.snapshot().counters['same'].value).toBe(1);
    });
  });

  describe('gauge', () => {
    it('should register a gauge and initialize to 0', () => {
      registry.gauge('memory_usage');
      expect(registry.snapshot().gauges['memory_usage'].value).toBe(0);
    });

    it('should set a gauge value', () => {
      registry.gauge('cpu_percent');
      registry.setGauge('cpu_percent', 75.5);
      expect(registry.snapshot().gauges['cpu_percent'].value).toBe(75.5);
    });

    it('should overwrite gauge value', () => {
      registry.gauge('connections');
      registry.setGauge('connections', 10);
      registry.setGauge('connections', 20);
      expect(registry.snapshot().gauges['connections'].value).toBe(20);
    });

    it('should auto-register gauge on first set', () => {
      registry.setGauge('auto_gauge', 99);
      expect(registry.snapshot().gauges['auto_gauge'].value).toBe(99);
    });
  });

  describe('histogram', () => {
    it('should register a histogram and initialize to 0', () => {
      registry.histogram('latency');
      const h = registry.snapshot().histograms['latency'];
      expect(h).toBeDefined();
      expect(h.count).toBe(0);
      expect(h.sum).toBe(0);
    });

    it('should observe values and update sum/count', () => {
      registry.histogram('request_duration');
      registry.observe('request_duration', 100);
      registry.observe('request_duration', 200);
      const h = registry.snapshot().histograms['request_duration'];
      expect(h.count).toBe(2);
      expect(h.sum).toBe(300);
      expect(h.avg).toBe(150);
    });

    it('should calculate percentiles from buckets', () => {
      registry.histogram('test_histo', [10, 20, 30, 40, 50]);
      for (let i = 0; i < 10; i++) registry.observe('test_histo', 5);
      for (let i = 0; i < 5; i++) registry.observe('test_histo', 15);
      for (let i = 0; i < 3; i++) registry.observe('test_histo', 25);
      for (let i = 0; i < 2; i++) registry.observe('test_histo', 45);

      const h = registry.snapshot().histograms['test_histo'];
      expect(h.count).toBe(20);
      // p50 should be in first bucket (le=10) since 10/20 = 0.5
      expect(h.p50).toBeLessThanOrEqual(10);
    });

    it('should auto-register histogram on first observe', () => {
      registry.observe('auto_histo', 42);
      expect(registry.snapshot().histograms['auto_histo'].count).toBe(1);
    });
  });

  describe('snapshot', () => {
    it('should return a snapshot with timestamp', () => {
      registry.counter('c1');
      registry.increment('c1');
      registry.gauge('g1');
      registry.setGauge('g1', 42);
      registry.observe('h1', 100);

      const snap = registry.snapshot();
      expect(snap.timestamp).toBeGreaterThan(0);
      expect(Object.keys(snap.counters)).toContain('c1');
      expect(Object.keys(snap.gauges)).toContain('g1');
      expect(Object.keys(snap.histograms)).toContain('h1');
    });

    it('should return empty snapshot when no metrics registered', () => {
      const snap = registry.snapshot();
      expect(Object.keys(snap.counters)).toHaveLength(0);
      expect(Object.keys(snap.gauges)).toHaveLength(0);
      expect(Object.keys(snap.histograms)).toHaveLength(0);
    });
  });

  describe('reset', () => {
    it('should clear all metrics', () => {
      registry.counter('c1');
      registry.increment('c1', 10);
      registry.gauge('g1');
      registry.setGauge('g1', 5);

      registry.reset();

      const snap = registry.snapshot();
      expect(Object.keys(snap.counters)).toHaveLength(0);
      expect(Object.keys(snap.gauges)).toHaveLength(0);
    });
  });
});

describe('metrics singleton convenience API', () => {
  beforeEach(() => {
    metrics.reset();
  });

  it('should provide counter/increment', () => {
    metrics.counter('api_reqs');
    metrics.increment('api_reqs');
    metrics.increment('api_reqs', 2);
    const snap = metrics.snapshot();
    expect(snap.counters['api_reqs'].value).toBe(3);
  });

  it('should provide gauge/setGauge', () => {
    metrics.gauge('temperature');
    metrics.setGauge('temperature', 36.6);
    expect(metrics.snapshot().gauges['temperature'].value).toBe(36.6);
  });

  it('should provide histogram/observe', () => {
    metrics.histogram('duration');
    metrics.observe('duration', 50);
    metrics.observe('duration', 150);
    const h = metrics.snapshot().histograms['duration'];
    expect(h.count).toBe(2);
    expect(h.avg).toBe(100);
  });

  it('should provide reset', () => {
    metrics.increment('x', 1);
    metrics.reset();
    expect(Object.keys(metrics.snapshot().counters)).toHaveLength(0);
  });
});
describe('histogram statistics & labels (cumulative semantics)', () => {
  let registry: ReturnType<typeof getMetrics>;

  beforeEach(() => {
    registry = getMetrics();
    registry.reset();
  });

  it('computes percentiles from cumulative bucket counts (no double-counting)', () => {
    registry.histogram('h_stats', [10, 20, 30, 40, 50]);
    for (let i = 0; i < 10; i++) registry.observe('h_stats', 5);
    for (let i = 0; i < 5; i++) registry.observe('h_stats', 15);
    for (let i = 0; i < 3; i++) registry.observe('h_stats', 25);
    for (let i = 0; i < 2; i++) registry.observe('h_stats', 45);

    const h = registry.snapshot().histograms['h_stats'];
    // p90 is the 18th value (bucket 30); misreading cumulative counts as
    // per-interval previously under-reported it to bucket 20.
    expect(h.p90).toBe(30);
  });

  it('estimates max as the smallest bucket covering every observation', () => {
    registry.histogram('h_mx', [10, 20, 30, 40, 50]);
    for (let i = 0; i < 3; i++) registry.observe('h_mx', 5);

    const h = registry.snapshot().histograms['h_mx'];
    // The largest observation sits in the le=10 bucket; previously max was
    // pegged at the top bucket (50) because cumulative counts made every
    // bucket "non-empty".
    expect(h.max).toBe(10);
  });

  it('reflects per-recording labels in the snapshot labels', () => {
    registry.counter('labeled_c', { defaultLabels: { service: 'aether' } });
    registry.increment('labeled_c', 2, { route: '/api/agents' });
    expect(registry.snapshot().counters['labeled_c'].labels).toEqual(
      expect.objectContaining({ service: 'aether', route: '/api/agents' }),
    );

    registry.gauge('labeled_g');
    registry.setGauge('labeled_g', 5, { host: 'h1' });
    expect(registry.snapshot().gauges['labeled_g'].labels).toEqual(
      expect.objectContaining({ host: 'h1' }),
    );

    registry.histogram('labeled_h', [10, 20]);
    registry.observe('labeled_h', 7, { op: 'run' });
    expect(registry.snapshot().histograms['labeled_h'].labels).toEqual(
      expect.objectContaining({ op: 'run' }),
    );
  });
  it('does not read out-of-range observations as zero data', () => {
    registry.histogram('h_out', [10, 20]);
    registry.observe('h_out', 5);
    registry.observe('h_out', 5);
    registry.observe('h_out', 5);
    registry.observe('h_out', 40); // exceeds the largest configured bucket (20)
    const h = registry.snapshot().histograms['h_out'];
    expect(h.count).toBe(4);
    expect(h.sum).toBe(55);
    // The +Inf sentinel bucket keeps min on the in-range observations while
    // the out-of-range value is honestly reported as exceeding the range.
    expect(h.min).toBe(10);
    expect(h.max).toBe(Number.POSITIVE_INFINITY);
    expect(h.p50).toBe(10);
  });

  it('keeps stats finite when every observation fits a configured bucket', () => {
    registry.histogram('h_in', [10, 20]);
    registry.observe('h_in', 5);
    registry.observe('h_in', 15);
    const h = registry.snapshot().histograms['h_in'];
    expect(Number.isFinite(h.max)).toBe(true);
    expect(h.max).toBe(20);
    expect(h.p90).toBe(20);
  });
});
