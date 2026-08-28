/**
 * Crash reporter for Aether Desktop
 *
 * Logs uncaught exceptions, unhandled rejections, and renderer crashes
 * to a local file and optionally forwards them to a remote endpoint.
 */

import { app } from 'electron';
import { writeFileSync, mkdirSync, existsSync, readFileSync, rmSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserWindow } from 'electron';

export interface CrashReporterDeps {
  getMainWindow: () => BrowserWindow | null;
}

const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10 MB

function getLogDir(): string {
  const dir = join(app.getPath('userData'), 'logs');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getLogPath(): string {
  return join(getLogDir(), 'crash.log');
}

export function registerCrashReporter(_deps: CrashReporterDeps): void {
  process.on('uncaughtException', (error: Error) => {
    logCrash({
      timestamp: new Date().toISOString(),
      type: 'uncaught-exception',
      message: error.message,
      stack: error.stack,
    });
    // Never keep running after an uncaught exception: the process state is
    // undefined and continuing silently corrupts the app. Exit non-zero so a
    // supervisor (or a relaunch) can recover cleanly.
    process.exit(1);
  });

  process.on('unhandledRejection', (reason: unknown) => {
    logCrash({
      timestamp: new Date().toISOString(),
      type: 'unhandled-rejection',
      message: String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });
}

export function logCrash(report: {
  timestamp: string;
  type: string;
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
}): void {
  try {
    const entry = JSON.stringify(report) + '\n';
    const logPath = getLogPath();

    // Rotate log if too large: rename the full file to .old (atomically, and
    // the active log then starts clean) instead of appending to a still-
    // oversized file after copying it.
    if (existsSync(logPath) && readFileSync(logPath).length > MAX_LOG_SIZE) {
      rmSync(logPath + '.old', { force: true });
      renameSync(logPath, logPath + '.old');
    }

    writeFileSync(logPath, entry, { flag: 'a' });
    console.error(`[crash-reporter] ${report.type}: ${report.message}`);
  } catch {
    // Fail silently — can't log the logger failure
  }
}

export function getCrashLogs(): Array<{
  timestamp: string;
  type: string;
  message: string;
  stack?: string;
}> {
  // Include the rotated archive first so entries stay chronological (rotation
  // renames the full crash.log to crash.log.old before starting fresh).
  const paths = [getLogPath() + '.old', getLogPath()];
  const lines: string[] = [];
  for (const p of paths) {
    if (!existsSync(p)) continue;
    lines.push(...readFileSync(p, 'utf-8').split('\n').filter(Boolean));
  }
  return lines
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}
