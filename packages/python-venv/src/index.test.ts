/**
 * @aether/python-venv — test suite
 *
 * Tests for Python virtual environment management utilities.
 * Some tests require Python 3 to be available on the system.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  VERSION,
  createVenv,
  getInstalledPackages,
  runPythonCode,
  deleteVenv,
  getPythonPath,
  getPipPath,
} from './index.js';

import { execSync } from 'node:child_process';

/**
 * Try to detect Python 3. Returns the python command or throws.
 * Mirrors the internal `findPython` logic from the source.
 */
function detectPython(): string {
  const candidates = ['python3', 'python'];
  for (const cmd of candidates) {
    try {
      const result = execSync(`${cmd} --version`, {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5_000,
      }) as string;
      if (result.startsWith('Python 3')) {
        return cmd;
      }
    } catch {
      // Try next
    }
  }
  throw new Error('Python 3 not found. Please install Python 3.');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('VERSION', () => {
  it('should export a semver string', () => {
    expect(VERSION).toBe('0.1.0');
  });
});

describe('Python detection', () => {
  it('should detect Python availability or report unavailability', () => {
    // We just test that detectPython either finds Python or throws — both are valid
    try {
      const python = detectPython();
      expect(typeof python).toBe('string');
      expect(python.length).toBeGreaterThan(0);
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain('Python 3 not found');
    }
  });
});

describe('createVenv', () => {
  it('should create a venv or throw if Python unavailable', async () => {
    let pythonAvailable = false;
    try {
      detectPython();
      pythonAvailable = true;
    } catch {
      // no Python — skip
    }

    if (!pythonAvailable) {
      expect(() => createVenv()).toThrow();
      return;
    }

    // Use a temp directory for the venv
    const { mkdtempSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const tmpDir = mkdtempSync(join(tmpdir(), 'py-venv-test-'));
    const venvPath = join(tmpDir, 'test-venv');

    try {
      const result = createVenv(venvPath);
      expect(result).toBe(venvPath);
    } finally {
      deleteVenv(venvPath);
      // Clean up the temp directory
      const { rmSync } = await import('node:fs');
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    }
  }, 60_000);
});

describe('getInstalledPackages', () => {
  it('should throw if no valid venv exists', async () => {
    // Use a non-existent path
    const { join } = await import('node:path');
    expect(() => getInstalledPackages('/nonexistent-venv-path-test')).toThrow();
  });
});

describe('runPythonCode', () => {
  it('should throw because no valid venv exists by default', async () => {
    // Without a valid venv, execution should throw
    expect(() => runPythonCode('print("hello")')).toThrow('Virtual environment not found');
  });
});

describe('getPythonPath / getPipPath', () => {
  it('should throw for non-existent venv', () => {
    expect(() => getPythonPath('/dev/null/venv')).toThrow('Virtual environment not found');
    expect(() => getPipPath('/dev/null/venv')).toThrow();
  });
});
describe('createVenv path safety', () => {
  it('never deletes an existing non-empty, non-venv directory', async () => {
    const { mkdtempSync, writeFileSync, existsSync, readdirSync, rmSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(join(tmpdir(), 'aether-venv-safe-'));
    const marker = join(dir, 'keep-me.txt');
    writeFileSync(marker, 'precious');
    try {
      // Either a real venv-refusal error (python present) or a python-not-found
      // error — in both cases the pre-existing data must survive untouched.
      expect(() => createVenv(dir)).toThrow();
      expect(existsSync(marker)).toBe(true);
      expect(readdirSync(dir)).toContain('keep-me.txt');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
