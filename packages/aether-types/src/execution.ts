import type { SandboxLimits } from './sandbox.js';

// ============================================================
// Execution environment interfaces
// ============================================================

/** Result from executing code in any sandbox */
export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  signal: string | null;
  duration: number; // ms
  timedOut: boolean;
  memoryUsedMb?: number;
}

/** A file to be placed in the sandbox before execution */
export interface SandboxFile {
  path: string; // relative path inside sandbox
  content: string;
  mode?: number; // chmod, e.g. 0o755
}

/** Base options common to all execution environments */
export interface BaseExecOptions {
  files?: SandboxFile[];
  timeout?: number; // ms
  env?: Record<string, string>;
  cwd?: string;
  limits?: Partial<SandboxLimits>;
}

/** Environment status */
export interface EnvStatus {
  ready: boolean;
  type: 'docker' | 'playwright' | 'ts-runtime' | 'python-venv';
  version?: string;
  error?: string;
  info?: Record<string, unknown>;
}
