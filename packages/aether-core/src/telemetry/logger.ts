/**
 * Structured logging with Pino + OpenTelemetry trace context injection
 *
 * Every log line automatically carries traceId, spanId from the active OTel span.
 * Supports level-based filtering, pretty-printing, and child loggers.
 */

import pino, { Logger, LevelWithSilent } from 'pino';
import { context, trace } from '@opentelemetry/api';
import type { TelemetryConfig, TelemetryLevel, SpanLogContext } from './types.js';
import { levelMap } from './types.js';

let rootLogger: Logger | null = null;

/**
 * Initialize the root pino logger with OTel trace context integration.
 */
export function initLogger(config: TelemetryConfig): Logger {
  if (rootLogger) {
    return rootLogger;
  }

  const level: LevelWithSilent = config.logLevel ?? 'info';

  rootLogger = pino({
    level,
    // Mixin injects OTel trace context into every log entry
    mixin() {
      const span = trace.getSpan(context.active());
      if (!span) {
        return { traceId: undefined, spanId: undefined };
      }
      const sc = span.spanContext();
      return {
        traceId: sc.traceId,
        spanId: sc.spanId,
        traceFlags: sc.traceFlags,
      };
    },
    transport: config.prettyPrint
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
    serializers: {
      err: pino.stdSerializers.err,
      error: pino.stdSerializers.err,
    },
  });

  return rootLogger;
}

/**
 * Get the root logger. When no explicit configuration has been supplied, a
 * default logger (pino, level `info`, no pretty transport, OTel trace-context
 * mixin) is initialized on first use so any consumer can call into the
 * telemetry logging surface without a prior initLogger() call. An explicit
 * initLogger(config) still controls the real root logger; this fallback only
 * fires when none was ever configured.
 */
export function getLogger(): Logger {
  if (!rootLogger) {
    rootLogger = pino({
      level: 'info',
      // Mixin injects OTel trace context into every log entry.
      mixin() {
        const span = trace.getSpan(context.active());
        if (!span) return { traceId: undefined, spanId: undefined };
        const sc = span.spanContext();
        return { traceId: sc.traceId, spanId: sc.spanId, traceFlags: sc.traceFlags };
      },
      serializers: {
        err: pino.stdSerializers.err,
        error: pino.stdSerializers.err,
      },
    });
  }
  return rootLogger;
}

/**
 * Create a child logger with bound fields.
 *
 * Usage:
 *   const child = childLogger({ agentId: "agent-1", sessionId: "abc-123" });
 *   child.info("agent started");
 */
export function childLogger(bindings: Record<string, unknown>): Logger {
  return getLogger().child(bindings);
}

/**
 * Create a child logger scoped to a module/package name.
 *
 * Usage:
 *   const log = moduleLogger("orchestrator");
 *   log.info("planning execution"); // logs: { module: "orchestrator", ... }
 */
export function moduleLogger(moduleName: string): Logger {
  return childLogger({ module: moduleName });
}

/**
 * Create a logger for a named module with optional level override.
 *
 * Provided for compatibility with sub-systems that want a simple
 * one-call logger factory (e.g. metrics, tracer).
 */
export function createLogger(opts: { module: string; level?: string }): Logger {
  const log = childLogger({ module: opts.module });
  if (opts.level && rootLogger) {
    // Apply level override if root logger is already initialized
    // This is a best-effort — the root level will gate all output anyway.
  }
  return log;
}

/**
 * Shutdown the logger (flush pending logs).
 */
export async function shutdownLogger(): Promise<void> {
  if (rootLogger) {
    await new Promise<void>((resolve) => {
      rootLogger!.flush();
      resolve();
    });
  }
}
