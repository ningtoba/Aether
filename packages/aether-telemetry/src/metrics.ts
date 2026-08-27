/**
 * @aether/telemetry — Metrics collection subsystem
 *
 * Provides counters, gauges, and histograms for tracking agent execution
 * metrics — token usage, cost, latency, failure rates, etc.
 *
 * Data is stored in-memory with optional periodic snapshots. Designed for
 * the Electron renderer to poll via IPC for dashboard display.
 */

import type { TelemetryAttributes, MetricPoint, MetricDef, MetricType } from './types.js';
import { createLogger } from './logger.js';

const log = createLogger({ module: 'telemetry:metrics', level: 'info' });

// ─── Types ────────────────────────────────────────────────────────────

export interface MetricOptions {
  /** Human-readable description */
  description?: string;
  /** Unit string (e.g. "tokens", "ms", "USD") */
  unit?: string;
  /** Default labels applied to every recording */
  defaultLabels?: TelemetryAttributes;
}

interface CounterState {
  value: number;
  def: MetricDef;
  labels: TelemetryAttributes;
}

interface GaugeState {
  value: number;
  def: MetricDef;
  labels: TelemetryAttributes;
}

interface HistogramBucket {
  le: number;
  count: number;
}

interface HistogramState {
  sum: number;
  count: number;
  buckets: HistogramBucket[];
  def: MetricDef;
  labels: TelemetryAttributes;
}

type MetricState = CounterState | GaugeState | HistogramState;

// ─── Snapshots ────────────────────────────────────────────────────────

export interface MetricsSnapshot {
  timestamp: number;
  counters: Record<
    string,
    { value: number; labels: TelemetryAttributes; description: string; unit?: string }
  >;
  gauges: Record<
    string,
    { value: number; labels: TelemetryAttributes; description: string; unit?: string }
  >;
  histograms: Record<
    string,
    {
      sum: number;
      count: number;
      avg: number;
      min: number;
      max: number;
      p50: number;
      p90: number;
      p99: number;
      labels: TelemetryAttributes;
      description: string;
      unit?: string;
    }
  >;
}

// ─── Default histogram buckets (milliseconds) ─────────────────────────

const DEFAULT_HISTOGRAM_BUCKETS_MS = [
  1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000,
];

// ─── Registry ─────────────────────────────────────────────────────────

class MetricsRegistry {
  private counters = new Map<string, CounterState>();
  private gauges = new Map<string, GaugeState>();
  private histograms = new Map<string, HistogramState>();
  private readonly defaultLabels: TelemetryAttributes;

  constructor(defaultLabels?: TelemetryAttributes) {
    this.defaultLabels = defaultLabels ?? {};
  }

  // ── Counter ────────────────────────────────────────────────────────

  counter(name: string, opts: MetricOptions = {}): void {
    if (this.counters.has(name)) return;
    this.counters.set(name, {
      value: 0,
      def: { name, type: 'counter', description: opts.description ?? '', unit: opts.unit },
      labels: { ...this.defaultLabels, ...opts.defaultLabels },
    });
  }

  increment(name: string, value: number = 1, extraLabels?: TelemetryAttributes): void {
    const state = this.counters.get(name);
    if (!state) {
      this.counter(name);
      this.increment(name, value, extraLabels);
      return;
    }
    state.value += value;
    log.trace(
      { metric: name, delta: value, ...(extraLabels as Record<string, unknown>) },
      `Counter ${name} += ${value} = ${state.value}`,
    );
  }

  // ── Gauge ─────────────────────────────────────────────────────────

  gauge(name: string, opts: MetricOptions = {}): void {
    if (this.gauges.has(name)) return;
    this.gauges.set(name, {
      value: 0,
      def: { name, type: 'gauge', description: opts.description ?? '', unit: opts.unit },
      labels: { ...this.defaultLabels, ...opts.defaultLabels },
    });
  }

  setGauge(name: string, value: number, extraLabels?: TelemetryAttributes): void {
    const state = this.gauges.get(name);
    if (!state) {
      this.gauge(name);
      this.setGauge(name, value, extraLabels);
      return;
    }
    state.value = value;
  }

  // ── Histogram ─────────────────────────────────────────────────────

  histogram(
    name: string,
    buckets: number[] = DEFAULT_HISTOGRAM_BUCKETS_MS,
    opts: MetricOptions = {},
  ): void {
    if (this.histograms.has(name)) return;
    this.histograms.set(name, {
      sum: 0,
      count: 0,
      buckets: buckets.map((le) => ({ le, count: 0 })),
      def: { name, type: 'histogram', description: opts.description ?? '', unit: opts.unit },
      labels: { ...this.defaultLabels, ...opts.defaultLabels },
    });
  }

  observe(name: string, value: number, extraLabels?: TelemetryAttributes): void {
    const state = this.histograms.get(name);
    if (!state) {
      this.histogram(name);
      this.observe(name, value, extraLabels);
      return;
    }
    state.sum += value;
    state.count += 1;
    // Assign to buckets
    for (const bucket of state.buckets) {
      if (value <= bucket.le) {
        bucket.count += 1;
      }
    }
  }

  // ── Snapshot ──────────────────────────────────────────────────────

  snapshot(): MetricsSnapshot {
    const timestamp = Date.now();

    const counters: MetricsSnapshot['counters'] = {};
    for (const [name, state] of this.counters) {
      counters[name] = {
        value: state.value,
        labels: state.labels,
        description: state.def.description,
        unit: state.def.unit,
      };
    }

    const gauges: MetricsSnapshot['gauges'] = {};
    for (const [name, state] of this.gauges) {
      gauges[name] = {
        value: state.value,
        labels: state.labels,
        description: state.def.description,
        unit: state.def.unit,
      };
    }

    const histograms: MetricsSnapshot['histograms'] = {};
    for (const [name, state] of this.histograms) {
      const sorted = state.buckets.slice().sort((a, b) => a.le - b.le);
      const values: number[] = [];
      // Reconstruct sorted values from cumulative buckets (approximate)
      const totalCount = state.count;
      const getPercentile = (p: number): number => {
        if (totalCount === 0) return 0;
        const target = totalCount * p;
        let cumulative = 0;
        for (const b of sorted) {
          cumulative += b.count;
          if (cumulative >= target) return b.le;
        }
        return sorted[sorted.length - 1]?.le ?? 0;
      };

      histograms[name] = {
        sum: state.sum,
        count: state.count,
        avg: state.count > 0 ? state.sum / state.count : 0,
        min: state.count > 0 ? (sorted.find((b) => b.count > 0)?.le ?? 0) : 0,
        max: state.count > 0 ? (sorted.filter((b) => b.count > 0).pop()?.le ?? 0) : 0,
        p50: getPercentile(0.5),
        p90: getPercentile(0.9),
        p99: getPercentile(0.99),
        labels: state.labels,
        description: state.def.description,
        unit: state.def.unit,
      };
    }

    return { timestamp, counters, gauges, histograms };
  }

  /** Reset all metrics — useful when a new execution session starts */
  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
    log.info('Metrics registry reset');
  }
}

// ─── Singleton ────────────────────────────────────────────────────────

const _defaultRegistry = new MetricsRegistry({
  service: 'aether',
  host: process.env.HOSTNAME ?? 'localhost',
});

export function getMetrics(): MetricsRegistry {
  return _defaultRegistry;
}

// ─── Convenience exports ──────────────────────────────────────────────

export const metrics = {
  counter: (name: string, opts?: MetricOptions) => _defaultRegistry.counter(name, opts),
  increment: (name: string, value?: number, labels?: TelemetryAttributes) =>
    _defaultRegistry.increment(name, value, labels),
  gauge: (name: string, opts?: MetricOptions) => _defaultRegistry.gauge(name, opts),
  setGauge: (name: string, value: number, labels?: TelemetryAttributes) =>
    _defaultRegistry.setGauge(name, value, labels),
  histogram: (name: string, buckets?: number[], opts?: MetricOptions) =>
    _defaultRegistry.histogram(name, buckets, opts),
  observe: (name: string, value: number, labels?: TelemetryAttributes) =>
    _defaultRegistry.observe(name, value, labels),
  snapshot: () => _defaultRegistry.snapshot(),
  reset: () => _defaultRegistry.reset(),
};
