/**
 * @aether/ts-runtime — TypeScript runtime sandbox for isolated VM execution
 *
 * Provides sandboxed execution of TypeScript code in child processes using tsx.
 * Supports timeouts, output size limits, and basic resource constraints.
 */

import { execFile } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

export const VERSION = '0.1.0';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExecTypeScriptOptions {
  /** Max execution time in milliseconds (default: 10_000) */
  timeout?: number;
  /** Max stdout/stderr output size in bytes (default: 1_048_576 = 1 MB) */
  maxOutputSize?: number;
  /** Environment variables to pass to the child process */
  env?: Record<string, string>;
  /** Working directory for execution (default: temp directory) */
  cwd?: string;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

export interface EvalResult<T = unknown> {
  value: T | null;
  error: string | null;
  stdout: string;
  stderr: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Name of the tsx launcher for a given platform. Windows npm shims are
 * `tsx.cmd` (plain `tsx` has no executable on Windows).
 */
export function tsxBinaryName(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'tsx.cmd' : 'tsx';
}

/**
 * Candidate locations for the tsx binary, most specific first.
 * Resolves this module's directory from `import.meta.url` with
 * `fileURLToPath` so absolute paths stay correct on Windows (URL
 * `pathname` yields a leading `/C:/...` drive-relative path, which never
 * exists). Exported for cross-platform tests.
 */
/**
 * Resolve the tsx entry point.
 *
 * Prefers the `dist/cli.mjs` module, which can be launched directly with
 * `process.execPath` on every OS. The `node_modules/.bin` shims are NOT
 * usable through execFile on Windows (CreateProcessW only starts .com/.exe,
 * and execFile refuses .cmd), so a PATH resolver name is only a last resort.
 */
export function getTsxEntryPath(platform: NodeJS.Platform = process.platform): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [
    join(moduleDir, '..', 'node_modules', 'tsx', 'dist', 'cli.mjs'),
    join(moduleDir, '..', '..', '..', 'node_modules', 'tsx', 'dist', 'cli.mjs'),
    join(moduleDir, '..', '..', '..', '..', 'node_modules', 'tsx', 'dist', 'cli.mjs'),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return tsxBinaryName(platform);
}

/** Host runtime facts that decide how a `.ts` file gets launched. */
export interface TsRuntimeInfo {
  /** Absolute path of the JavaScript runtime executing this module. */
  execPath: string;
  /** Bun's version when the host runtime is Bun; undefined on Node. */
  bunVersion?: string;
}

/** A resolved launch recipe for one untrusted `.ts` file. */
export interface TsLauncher {
  /** Executable handed to `execFile`. */
  executable: string;
  /** Arguments placed before the script path (the tsx entry, or none). */
  prefixArgs: string[];
  /** True when the executable understands TypeScript without a loader hook. */
  runsTypeScriptNatively: boolean;
  /** Strategy taken, so callers can assert it without spawning. */
  strategy: 'runtime-native' | 'tsx-entry' | 'tsx-path';
}

/** The runtime facts of the current process. */
export function currentTsRuntime(): TsRuntimeInfo {
  return {
    execPath: process.execPath,
    // @types/node types process.versions with an index signature; Bun reports itself here.
    bunVersion: process.versions.bun,
  };
}

/**
 * Resolve how to launch an untrusted `.ts` file with the runtime we run on.
 *
 * Bun strips types itself, and shelling out to tsx is broken there: tsx's
 * bundled `dist/cli.mjs` resolves its own chunks relatively, which Bun's loader
 * cannot follow ("Cannot find module './cjs/index.cjs' from ''"), so every
 * sandboxed run died before the user code started — including when the child
 * was launched through this process's own executable, which *is* Bun. On Node
 * we keep the tsx entry module, launched through the executable itself so the
 * same code path works on Windows (where .cmd shims cannot be execFile'd).
 */
export function resolveTsLauncher(
  platform: NodeJS.Platform = process.platform,
  runtime: TsRuntimeInfo = currentTsRuntime(),
): TsLauncher {
  const execPath = runtime.execPath.length > 0 ? runtime.execPath : 'node';
  if (runtime.bunVersion) {
    return {
      executable: execPath,
      prefixArgs: [],
      runsTypeScriptNatively: true,
      strategy: 'runtime-native',
    };
  }
  const entry = getTsxEntryPath(platform);
  return entry.endsWith('.mjs')
    ? {
        executable: execPath,
        prefixArgs: [entry],
        runsTypeScriptNatively: false,
        strategy: 'tsx-entry',
      }
    : {
        executable: entry,
        prefixArgs: [],
        runsTypeScriptNatively: false,
        strategy: 'tsx-path',
      };
}

/** Write code to a temp file and return the file path. */
function writeTempFile(code: string): { filePath: string; cleanup: () => void } {
  const tmpDir = mkdtempSync(join(tmpdir(), 'ts-runtime-'));
  const filePath = join(tmpDir, 'script.ts');
  writeFileSync(filePath, code, 'utf-8');
  return {
    filePath,
    cleanup: () => {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run TypeScript code in an isolated child_process using tsx.
 * Returns stdout, stderr, and exitCode.
 */
export function execTypeScript(
  code: string,
  options: ExecTypeScriptOptions = {},
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const { filePath, cleanup } = writeTempFile(code);
    const timeout: number = options.timeout ?? 10_000;
    const maxOutput: number = options.maxOutputSize ?? 1_048_576;
    // Kill timers are cleared once the process settles so a fast script does
    // not keep the event loop alive for the full timeout window.
    const killTimers: ReturnType<typeof setTimeout>[] = [];

    const launcher = resolveTsLauncher();

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      NODE_ENV: 'sandbox',
      NODE_NO_WARNINGS: '1',
      ...options.env,
    };

    // If user explicitly sets NODE_OPTIONS, use theirs instead. Otherwise the
    // V8 heap cap is applied only to a Node child — it means nothing to a
    // runtime that is not V8-backed, and silently implies a limit that is not
    // enforced.
    if (options.env?.NODE_OPTIONS !== undefined) {
      env.NODE_OPTIONS = options.env.NODE_OPTIONS;
    } else if (!launcher.runsTypeScriptNatively) {
      env.NODE_OPTIONS = '--max-old-space-size=256';
    }

    // `killRequested` records that *we* killed the child, so `timedOut` does not
    // depend on how the host runtime words its execFile timeout error.
    let killRequested = false;
    const child = execFile(
      launcher.executable,
      [...launcher.prefixArgs, filePath],
      {
        timeout,
        maxBuffer: maxOutput,
        cwd: options.cwd ?? dirname(filePath),
        env,
      },
      (error, stdout, stderr) => {
        cleanup();
        for (const t of killTimers) clearTimeout(t);
        const timedOut =
          killRequested ||
          error?.killed === true ||
          (error?.message != null && error.message.includes('timed out'));
        resolve({
          stdout: stdout ?? '',
          stderr: stderr ?? '',
          exitCode: error != null ? (typeof error.code === 'number' ? error.code : 1) : 0,
          timedOut,
        });
      },
    );

    // Safety: ensure the process is killed on timeout. execFile treats timeout 0
    // as "no timeout", so the manual timer must too — otherwise timeout: 0
    // SIGTERMs a just-spawned child at t=0.
    if (timeout > 0) {
      killTimers.push(
        setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) {
            killRequested = true;
            child.kill('SIGTERM');
            killTimers.push(
              setTimeout(() => {
                if (child.exitCode === null) {
                  child.kill('SIGKILL');
                }
              }, 2_000),
            );
          }
        }, timeout),
      );
    }
  });
}

/**
 * Run TypeScript code and return the evaluation result.
 * The code should output its result as JSON via console.log or process.stdout.write.
 * The captured stdout is parsed as JSON.
 */
export async function evalTypeScript<T = unknown>(
  code: string,
  context?: Record<string, unknown>,
  options: ExecTypeScriptOptions = {},
): Promise<EvalResult<T>> {
  const contextJson = context ? JSON.stringify(context) : '{}';

  const wrapperCode = `
const __context = ${contextJson};
Object.assign(globalThis, __context);

// User code follows
${code}
`;

  const result = await execTypeScript(wrapperCode, options);

  if (result.exitCode !== 0) {
    return {
      value: null,
      error: result.stderr || `Process exited with code ${result.exitCode}`,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  try {
    const trimmed = result.stdout.trim();
    const value = trimmed ? (JSON.parse(trimmed) as T) : null;
    return {
      value,
      error: null,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (parseErr) {
    return {
      value: null,
      error: `Failed to parse result as JSON: ${(parseErr as Error).message}`,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }
}

/**
 * Write TypeScript code to a temporary file and return the path.
 * Useful for debugging or when you need to inspect the generated file.
 */
export function writeTempFileForCode(code: string): string {
  const { filePath } = writeTempFile(code);
  return filePath;
}

/**
 * Read output from a file that was produced by a ts-runtime script.
 */
export function readOutputFile(filePath: string): string {
  if (!existsSync(filePath)) {
    throw new Error(`Output file not found: ${filePath}`);
  }
  return readFileSync(filePath, 'utf-8');
}
