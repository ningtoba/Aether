/**
 * Real-runtime context-propagation tests for the tracer.
 *
 * These MUST NOT mock @opentelemetry/api: they verify that initTracer installs
 * an AsyncLocalStorage context manager (so span context survives `await`) and
 * that injectTraceContext carries the active span into the outbound carrier.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { context, trace } from '@opentelemetry/api';
import { initTracer, shutdownTracer, withSpan, injectTraceContext } from './tracer.js';
import type { TelemetryConfig } from './types.js';

const config: TelemetryConfig = {
  serviceName: 'aether-context-test',
  consoleExporter: false,
  samplingRate: 1,
};

describe('tracer async context propagation (real OTel)', () => {
  afterAll(async () => {
    await shutdownTracer();
  });

  it('keeps the active span current across awaits (ALS context manager installed)', async () => {
    initTracer(config);

    const activeIds: string[] = [];
    await withSpan('outer', async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const afterAwait = trace.getSpan(context.active())?.spanContext().spanId;
      activeIds.push(String(afterAwait ?? 'none'));

      await withSpan('inner', async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        const inner = trace.getSpan(context.active())?.spanContext().spanId;
        activeIds.push(String(inner ?? 'none'));
      });

      // After the nested span ends, the outer span must be active again.
      const backToOuter = trace.getSpan(context.active())?.spanContext().spanId;
      activeIds.push(String(backToOuter ?? 'none'));
    });

    // With the default NOOP context manager every value is 'none'; with the
    // installed AsyncLocalStorage manager the ids are real and the outer span
    // is restored after the nested span ends.
    expect(activeIds[0]).not.toBe('none');
    expect(activeIds[1]).not.toBe('none');
    expect(activeIds[2]).toBe(activeIds[0]);
  });

  it('injects the active span into the traceparent carrier', async () => {
    initTracer(config);
    await withSpan('http-out', async (span) => {
      const carrier: Record<string, string> = {};
      injectTraceContext(carrier);
      // Injecting ROOT_CONTEXT (the old bug) never writes a traceparent.
      expect(carrier.traceparent).toBeDefined();
      expect(carrier.traceparent).toContain(span.spanContext().traceId);
    });
  });
});
