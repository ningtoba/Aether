/**
 * OpenTelemetry tracer provider and span helpers for Aether
 *
 * Provides a singleton TracerProvider configured via TelemetryConfig,
 * plus convenience helpers for creating and managing spans.
 */

import {
  context,
  trace,
  Span,
  SpanStatusCode,
  SpanOptions,
  Context,
  propagation,
  TextMapPropagator,
  ROOT_CONTEXT,
} from '@opentelemetry/api';
import { Resource } from '@opentelemetry/resources';
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  SimpleSpanProcessor,
  ConsoleSpanExporter,
} from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
  SEMRESATTRS_DEPLOYMENT_ENVIRONMENT,
} from '@opentelemetry/semantic-conventions';
import { W3CTraceContextPropagator } from '@opentelemetry/core';

import type { TelemetryConfig, SpanLogContext } from './types.js';

let provider: BasicTracerProvider | null = null;
let _shutdownHook: (() => Promise<void>) | null = null;
let _isInitialized = false;

/**
 * Initialize the global OpenTelemetry tracer provider.
 * Idempotent — safe to call multiple times.
 */
export function initTracer(config: TelemetryConfig): void {
  if (_isInitialized) {
    return;
  }

  const resource = new Resource({
    [ATTR_SERVICE_NAME]: config.serviceName,
    [ATTR_SERVICE_VERSION]: config.serviceVersion ?? '0.1.0',
    [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: config.environment ?? 'development',
  });

  provider = new BasicTracerProvider({
    resource,
    sampler:
      config.samplingRate !== undefined
        ? {
            shouldSample: () => ({
              decision:
                Math.random() < (config.samplingRate ?? 1.0)
                  ? 1 /* IS_RECORDED */
                  : 0 /* NOT_RECORDED */,
              attributes: {},
            }),
          }
        : undefined,
  });

  // Console exporter (development default)
  if (config.consoleExporter !== false) {
    provider.addSpanProcessor(new SimpleSpanProcessor(new ConsoleSpanExporter()));
  }

  // OTLP exporter (production / configured endpoint)
  if (config.otlpEndpoint) {
    const otlpExporter = new OTLPTraceExporter({
      url: config.otlpEndpoint,
    });
    provider.addSpanProcessor(
      new BatchSpanProcessor(otlpExporter, {
        scheduledDelayMillis: 1000,
        maxExportBatchSize: 100,
      }),
    );
  }

  // Set W3C trace context propagator for distributed tracing
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  // Install a context manager. Without one, @opentelemetry/api's default NOOP
  // context manager makes context.active() return ROOT_CONTEXT everywhere, so
  // withSpan's activation and the logger mixin never see the active span in
  // asynchronous code. AsyncLocalStorage propagates context across awaits.
  context.setGlobalContextManager(new AsyncLocalStorageContextManager());

  provider.register();

  // Build shutdown hook — use the provider's own shutdown which handles all processors
  _shutdownHook = async () => {
    if (provider) {
      await provider.shutdown();
    }
  };

  _isInitialized = true;
}

/**
 * Shut down the tracer provider, flushing all pending spans.
 */
export async function shutdownTracer(): Promise<void> {
  if (_shutdownHook) {
    await _shutdownHook();
  }
  provider = null;
  _shutdownHook = null;
  _isInitialized = false;
}

/**
 * Get the global tracer instance for a given instrumentation scope.
 */
export function getTracer(name = '@aether/telemetry', version = '0.1.0') {
  return trace.getTracer(name, version);
}

/**
 * Create a child span with automatic error handling.
 *
 * Usage:
 *   const span = startSpan("aether.agent.run", { attributes: { agentId } });
 *   try { ... } catch (e) { recordSpanError(span, e); } finally { span.end(); }
 */
export function startSpan(
  name: string,
  options?: SpanOptions & { tracerName?: string; tracerVersion?: string },
): Span {
  const tracer = getTracer(options?.tracerName, options?.tracerVersion);
  const { tracerName: _, tracerVersion: __, ...spanOpts } = options ?? {};
  return tracer.startSpan(name, spanOpts);
}

/**
 * Run an async function inside a span with automatic error handling.
 * The span is ended when the function completes or throws.
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  options?: SpanOptions & { tracerName?: string; tracerVersion?: string },
): Promise<T> {
  const span = startSpan(name, options);
  // Make the new span the active span for the duration of fn, so nested
  // spans and the log-context mixin inherit this span's trace/span ids
  // instead of a stale parent.
  const ctx = trace.setSpan(context.active(), span);
  try {
    const result = await context.with(ctx, () => fn(span));
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (err) {
    recordSpanError(span, err);
    span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
    throw err;
  } finally {
    span.end();
  }
}

/**
 * Record an error on a span, extracting structured error info.
 */
export function recordSpanError(span: Span, error: unknown): void {
  if (error instanceof Error) {
    span.recordException(error);
    span.setAttribute('error.type', error.name);
    span.setAttribute('error.message', error.message);
    span.setAttribute('error.stack', error.stack ?? '');
  } else {
    span.recordException(String(error));
    span.setAttribute('error.type', typeof error);
    span.setAttribute('error.message', String(error));
  }
  span.setStatus({ code: SpanStatusCode.ERROR });
}

/**
 * Set attributes in bulk on a span.
 */
export function setSpanAttributes(span: Span, attrs: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined && value !== null) {
      span.setAttribute(key, String(value));
    }
  }
}

/**
 * Extract trace context from the current active span as a flat object
 * suitable for injecting into log entries.
 */
export function getSpanLogContext(): SpanLogContext | null {
  const span = trace.getSpan(context.active());
  if (!span) return null;

  const spanContext = span.spanContext();
  return {
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
    traceFlags: spanContext.traceFlags,
  };
}

/**
 * Inject W3C trace context into a carrier object (e.g., HTTP headers).
 */
export function injectTraceContext(carrier: Record<string, string>): Record<string, string> {
  propagation.inject(context.active(), carrier);
  return carrier;
}

/**
 * Extract W3C trace context from a carrier object.
 */
export function extractTraceContext(carrier: Record<string, string>): Context {
  return propagation.extract(ROOT_CONTEXT, carrier);
}
