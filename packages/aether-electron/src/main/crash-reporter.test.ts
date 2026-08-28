import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getCrashLogs, logCrash } from './crash-reporter.js';

// `app.getPath('userData')` points at an isolated temp dir per test.
const testState = vi.hoisted(() => ({ userDataDir: '' }));
vi.mock('electron', () => ({
  app: { getPath: () => testState.userDataDir },
}));

describe('crash-reporter logging', () => {
  beforeEach(() => {
    testState.userDataDir = mkdtempSync(join(tmpdir(), 'crash-reporter-'));
  });

  afterEach(() => {
    rmSync(testState.userDataDir, { recursive: true, force: true });
  });

  it('getCrashLogs reads the rotated archive in addition to the active log', () => {
    const logDir = join(testState.userDataDir, 'logs');
    mkdirSync(logDir, { recursive: true });
    const logPath = join(logDir, 'crash.log');

    writeFileSync(
      logPath,
      JSON.stringify({ timestamp: '1', type: 'old', message: 'old crash' }) + '\n',
    );
    // Rotation renames the full active log to crash.log.old before starting a
    // fresh one; the reader must surface both.
    renameSync(logPath, logPath + '.old');
    writeFileSync(
      logPath,
      JSON.stringify({ timestamp: '2', type: 'new', message: 'new crash' }) + '\n',
    );

    const logs = getCrashLogs() as Array<{ message: string }>;
    expect(logs.map((l) => l.message)).toEqual(['old crash', 'new crash']);
  });

  it('logCrash appends a parseable JSON line', () => {
    logCrash({ timestamp: 't', type: 'test', message: 'boom', stack: 'at x' });
    const logs = getCrashLogs() as Array<{ message: string; stack?: string }>;
    expect(logs).toHaveLength(1);
    expect(logs[0].message).toBe('boom');
  });
});
