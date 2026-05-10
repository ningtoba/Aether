/**
 * Structured logging with Pino + OpenTelemetry trace context injection
 *
 * Every log line automatically carries traceId, spanId from the active OTel span.
 * Supports level-based filtering, pretty-printing, and child loggers.
 */

import pino, { Logger, LevelWithSilent } from "pino";
import { trace } from "@opentelemetry/api";
import type { TelemetryConfig, TelemetryLevel, SpanLogContext } from "./types.js";
import { levelMap } from "./types.js";

let rootLogger: Logger | null = null;

/**
 * Initialize the root pino logger with OTel trace context integration.
 */
export function initLogger(config: TelemetryConfig): Logger {
  if (rootLogger) {
    return rootLogger;
  }

  const level: LevelWithSilent = levelMap[config.logLevel ?? "info"];

  rootLogger = pino({
    level,
    // Mixin injects OTel trace context into every log entry
    mixin() {
      const span = trace.getSpan(trace.getActiveContext());
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
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
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
 * Get the root logger. Must call initLogger first.
 */
export function getLogger(): Logger {
  if (!rootLogger) {
    throw new Error(
      "Logger not initialized. Call initLogger(config) first."
    );
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
