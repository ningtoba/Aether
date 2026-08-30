/**
 * @aether/ts-runtime — test suite
 *
 * Tests for TypeScript sandbox execution utilities.
 * Some tests require tsx to be installed (it is a dependency).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  execTypeScript,
  evalTypeScript,
  writeTempFileForCode,
  readOutputFile,
  VERSION,
} from './index.js';
import { getTsxEntryPath, resolveTsLauncher, tsxBinaryName } from './index.js';
import { existsSync } from 'node:fs';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('VERSION', () => {
  it('should export a semver string', () => {
    expect(VERSION).toBe('0.1.0');
  });
});

describe('execTypeScript', () => {
  it('should run simple TypeScript code and return stdout', async () => {
    const result = await execTypeScript('console.log("hello from ts-runtime");');
    expect(result.stdout.trim()).toBe('hello from ts-runtime');
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
  });

  it('should enforce timeouts and return timedOut flag', async () => {
    const result = await execTypeScript(
      'const start = Date.now(); while (Date.now() - start < 5000) {} console.log("done");',
      { timeout: 100 },
    );
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).not.toBe(0);
  }, 10_000);

  it('should capture stderr on runtime errors', async () => {
    const result = await execTypeScript('throw new Error("boom");');
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toBeTruthy();
  });

  it('should handle empty code gracefully', async () => {
    const result = await execTypeScript('');
    expect(result.exitCode).toBe(0);
  });
});

describe('evalTypeScript', () => {
  it('should return parsed JSON result from code', async () => {
    const result = await evalTypeScript<{ hello: string }>(
      'console.log(JSON.stringify({ hello: "world" }));',
    );
    expect(result.error).toBeNull();
    expect(result.value).toEqual({ hello: 'world' });
  });

  it('should return error on non-zero exit', async () => {
    const result = await evalTypeScript('throw new Error("fail");');
    expect(result.error).toBeTruthy();
    expect(result.value).toBeNull();
  });

  it('should report JSON parse failures', async () => {
    const result = await evalTypeScript('console.log("not-json");');
    expect(result.error).toContain('Failed to parse');
    expect(result.value).toBeNull();
  });
});

describe('writeTempFileForCode', () => {
  it('should create a temp file and return its path', () => {
    const path = writeTempFileForCode('console.log("hi");');
    expect(path).toBeTruthy();
    expect(path).toContain('ts-runtime');
    expect(path.endsWith('.ts')).toBe(true);
  });
});

describe('readOutputFile', () => {
  it('should throw for non-existent file', () => {
    expect(() => readOutputFile('/nonexistent/output.json')).toThrow('Output file not found');
  });
});
describe('getTsxEntryPath', () => {
  it('uses tsx.cmd on Windows and tsx on POSIX for PATH fallback', () => {
    expect(tsxBinaryName('win32')).toBe('tsx.cmd');
    expect(tsxBinaryName('linux')).toBe('tsx');
    expect(tsxBinaryName('darwin')).toBe('tsx');
  });

  it('resolves the tsx entry module in this workspace', () => {
    const entry = getTsxEntryPath();
    expect(entry.endsWith('cli.mjs')).toBe(true);
    expect(existsSync(entry)).toBe(true);
  });

  it('does not produce a drive-relative path on any platform', () => {
    const platforms: NodeJS.Platform[] = ['win32', 'linux', 'darwin'];
    for (const platform of platforms) {
      expect(getTsxEntryPath(platform).startsWith('\\C:')).toBe(false);
      expect(getTsxEntryPath(platform).startsWith('/C:')).toBe(false);
    }
  });
});

describe('resolveTsLauncher', () => {
  it('never hands the tsx CLI to a Bun host (tsx chunks do not load under Bun)', () => {
    const launcher = resolveTsLauncher('linux', {
      execPath: '/usr/local/bin/bun',
      bunVersion: '1.3.14',
    });
    expect(launcher.strategy).toBe('runtime-native');
    expect(launcher.runsTypeScriptNatively).toBe(true);
    expect(launcher.executable).toBe('/usr/local/bin/bun');
    expect(launcher.prefixArgs).toEqual([]);
  });

  it('launches the tsx entry through the executable on Node, on every OS', () => {
    for (const platform of ['linux', 'darwin', 'win32'] as NodeJS.Platform[]) {
      const launcher = resolveTsLauncher(platform, { execPath: '/usr/bin/node' });
      expect(launcher.strategy).toBe('tsx-entry');
      expect(launcher.runsTypeScriptNatively).toBe(false);
      // execFile cannot start .cmd shims, so the module entry must be used and
      // the script path stays the only trailing argument.
      expect(launcher.executable).toBe('/usr/bin/node');
      const entry = launcher.prefixArgs[0];
      expect(typeof entry).toBe('string');
      expect(entry?.endsWith('cli.mjs')).toBe(true);
      expect(existsSync(entry as string)).toBe(true);
    }
  });

  it('defaults to a launcher the host runtime can actually run', () => {
    const launcher = resolveTsLauncher();
    const hostIsBun = process.versions.bun !== undefined;
    expect(launcher.strategy).toBe(hostIsBun ? 'runtime-native' : 'tsx-entry');
    expect(launcher.executable).toBe(process.execPath);
  });

  it('falls back to the bare node executable name when execPath is unusable', () => {
    expect(resolveTsLauncher('linux', { execPath: '' }).executable).toBe('node');
  });
});

describe('sandbox isolation', () => {
  it('runs untrusted code in the temp working directory, not the caller cwd', async () => {
    const result = await execTypeScript('console.log(process.cwd())');
    expect(result.exitCode).toBe(0);
    // The sandbox must default to its temp dir — never the calling process's
    // cwd (which would hand untrusted code read/write access to the repo).
    expect(result.stdout.trim()).not.toBe(process.cwd());
  }, 20_000);

  it('treats timeout: 0 as "no timeout" instead of killing at t=0', async () => {
    const result = await execTypeScript('console.log("ok")', { timeout: 0 });
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
  }, 10_000);
});
