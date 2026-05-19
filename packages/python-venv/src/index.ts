/**
 * @aether/python-venv — Python virtual environment management
 *
 * Provides utilities for creating, managing, and using Python virtual environments
 * via child_process operations.
 */

import { execSync, execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

export const VERSION = "0.1.0";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VenvOptions {
  /** Path to the Python executable (default: auto-detect via "python3" or "python") */
  pythonPath?: string;
}

export interface InstalledPackage {
  name: string;
  version: string;
}

export interface PythonResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Default directory name for venvs created without an explicit path. */
const DEFAULT_VENV_DIR = ".aether-venv";

/** Resolve venv path: if relative, resolve relative to cwd. */
function resolveVenvPath(venvPath?: string): string {
  return resolve(venvPath ?? join(process.cwd(), DEFAULT_VENV_DIR));
}

/**
 * Find a working Python 3 executable.
 * Throws if none found.
 */
function findPython(pythonPath?: string): string {
  if (pythonPath) {
    if (!existsSync(pythonPath)) {
      throw new Error(`Python executable not found at: ${pythonPath}`);
    }
    return pythonPath;
  }

  const candidates = ["python3", "python"];
  for (const cmd of candidates) {
    try {
      const result = execSync(`${cmd} --version`, {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 5_000,
      }) as string;
      if (result.startsWith("Python 3")) {
        return cmd;
      }
    } catch {
      // Try next candidate
    }
  }

  throw new Error(
    "Python 3 not found. Please install Python 3 and ensure it's available in PATH.",
  );
}

/**
 * Get the path to the Python executable inside a venv.
 */
function getVenvPython(venvPath: string): string {
  // Windows vs Unix
  const isWin = process.platform === "win32";
  return isWin
    ? join(venvPath, "Scripts", "python.exe")
    : join(venvPath, "bin", "python");
}

/**
 * Get the path to pip inside a venv.
 */
function getVenvPip(venvPath: string): string {
  const isWin = process.platform === "win32";
  return isWin
    ? join(venvPath, "Scripts", "pip.exe")
    : join(venvPath, "bin", "pip");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the Python executable path for a virtual environment.
 * If the venv doesn't exist, returns the expected path based on convention.
 */
export function getPythonPath(venvPath?: string): string {
  const resolved = resolveVenvPath(venvPath);
  const pythonPath = getVenvPython(resolved);
  if (!existsSync(pythonPath)) {
    throw new Error(
      `Virtual environment not found at "${resolved}". Create it first with createVenv().`,
    );
  }
  return pythonPath;
}

/**
 * Get the pip executable path for a virtual environment.
 */
export function getPipPath(venvPath?: string): string {
  const resolved = resolveVenvPath(venvPath);
  const pipPath = getVenvPip(resolved);
  if (!existsSync(pipPath)) {
    throw new Error(
      `pip not found in virtual environment at "${resolved}".`,
    );
  }
  return pipPath;
}

/**
 * Create a Python virtual environment at the given path (or a default location).
 * Returns the path to the created venv.
 */
export function createVenv(venvPath?: string, options: VenvOptions = {}): string {
  const resolved = resolveVenvPath(venvPath);
  const python = findPython(options.pythonPath);

  if (existsSync(resolved)) {
    // Check if it looks like a valid venv
    const pythonPath = getVenvPython(resolved);
    if (existsSync(pythonPath)) {
      return resolved; // Already exists and looks valid
    }
    // Remove broken/incomplete venv directory
    rmSync(resolved, { recursive: true, force: true });
  }

  // Ensure parent directory exists
  mkdirSync(resolve(resolved, ".."), { recursive: true });

  try {
    execFileSync(python, ["-m", "venv", resolved], {
      stdio: "pipe",
      timeout: 30_000,
    });
  } catch (err) {
    throw new Error(
      `Failed to create virtual environment at "${resolved}": ${(err as Error).message}`,
    );
  }

  return resolved;
}

/**
 * Install packages into a virtual environment via pip.
 */
export function installPackages(
  packages: string | string[],
  venvPath?: string,
): void {
  const resolved = resolveVenvPath(venvPath);
  const pip = getPipPath(resolved);
  const pkgList = Array.isArray(packages) ? packages : [packages];

  try {
    execFileSync(pip, ["install", ...pkgList], {
      stdio: "pipe",
      timeout: 120_000,
    });
  } catch (err) {
    throw new Error(
      `Failed to install packages: ${(err as Error).message}`,
    );
  }
}

/**
 * Run a Python script file within the virtual environment.
 * Returns stdout, stderr, and exit code.
 */
export function runPython(
  scriptPath: string,
  venvPath?: string,
  args: string[] = [],
): PythonResult {
  const resolved = resolveVenvPath(venvPath);
  const python = getPythonPath(resolved);

  try {
    const result = spawnSync(python, [scriptPath, ...args], {
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 60_000,
    });
    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      exitCode: result.status ?? 1,
    };
  } catch (err) {
    return {
      stdout: "",
      stderr: `Failed to run script: ${(err as Error).message}`,
      exitCode: 1,
    };
  }
}

/**
 * Run inline Python code within the virtual environment.
 * Returns stdout, stderr, and exit code.
 */
export function runPythonCode(code: string, venvPath?: string): PythonResult {
  const resolved = resolveVenvPath(venvPath);
  const python = getPythonPath(resolved);

  try {
    const result = spawnSync(python, ["-c", code], {
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 60_000,
    });
    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      exitCode: result.status ?? 1,
    };
  } catch (err) {
    return {
      stdout: "",
      stderr: `Failed to run Python code: ${(err as Error).message}`,
      exitCode: 1,
    };
  }
}

/**
 * List installed packages in the virtual environment.
 * Returns an array of {name, version} objects.
 */
export function getInstalledPackages(venvPath?: string): InstalledPackage[] {
  const resolved = resolveVenvPath(venvPath);
  const pip = getPipPath(resolved);

  try {
    const result = execFileSync(pip, ["list", "--format=json"], {
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 30_000,
    });

    const parsed = JSON.parse(result as string) as Array<{ name: string; version: string }>;
    return parsed.map((pkg) => ({
      name: pkg.name,
      version: pkg.version,
    }));
  } catch (err) {
    throw new Error(
      `Failed to list installed packages: ${(err as Error).message}`,
    );
  }
}

/**
 * Delete a virtual environment directory.
 */
export function deleteVenv(venvPath?: string): void {
  const resolved = resolveVenvPath(venvPath);

  if (!existsSync(resolved)) {
    return; // Nothing to delete
  }

  try {
    rmSync(resolved, { recursive: true, force: true });
  } catch (err) {
    throw new Error(
      `Failed to delete virtual environment at "${resolved}": ${(err as Error).message}`,
    );
  }
}
