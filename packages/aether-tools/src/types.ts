/**
 * Shared types for the Aether tool runtime system.
 *
 * A tool is a single executable action (run a command, open a browser,
 * execute Python, etc.). The ToolRegistry manages lifecycle, permissions,
 * timeouts, and retries across all runtime backends.
 */

import type { ChildProcess } from "node:child_process";

// ─── Permission model ───────────────────────────────────────────────────────

/** Categories a tool may be gated on. */
export type PermissionScope =
  | "shell"       // arbitrary shell commands
  | "filesystem"  // read/write files outside workspace
  | "network"     // outbound HTTP / TCP
  | "docker"      // Docker container mgmt
  | "browser"     // headless browser automation
  | "runtime"     // isolated code execution (Python / Node)

export interface ToolPermissions {
  /** Scopes the caller needs. */
  scopes: PermissionScope[];
  /** If true, tool is sandboxed in a Docker container (requires docker scope). */
  sandbox?: boolean;
  /** Max wall-clock time in ms (0 = inherit from ToolDef). */
  timeoutOverride?: number;
}

// ─── Tool definition ────────────────────────────────────────────────────────

export type ToolKind =
  | "shell"       // local or Docker shell
  | "docker"      // Dockerode container lifecycle
  | "playwright"  // Playwright browser automation
  | "python"      // Python code execution
  | "node"        // Node.js / TypeScript code execution

/** Parameters a tool receives on invocation. */
export interface ToolParams {
  /** For shell/runtime tools: the command or code to run. */
  command?: string;
  /** Arguments passed to the command. */
  args?: string[];
  /** Working directory inside the sandbox. */
  cwd?: string;
  /** Environment variable overrides. */
  env?: Record<string, string>;
  /** Stdin to pipe (text or base64). */
  stdin?: string;
  /** Content to write before execution (path → content). */
  files?: Record<string, string>;
  /** Docker-specific: image tag. */
  image?: string;
  /** Playwright-specific: URL to navigate to. */
  url?: string;
  /** Playwright-specific: JavaScript to evaluate. */
  script?: string;
  /** Runtime-specific: code string to eval. */
  code?: string;
  /** Arbitrary extra parameters. */
  [key: string]: unknown;
}

/** Configuration for a registered tool. */
export interface ToolDef<TParams = ToolParams> {
  kind: ToolKind;
  /** Human-readable label (shown to the agent). */
  label: string;
  /** Description (shown to the agent when choosing a tool). */
  description: string;
  /** Default max wall-clock time in ms. */
  timeoutMs: number;
  /** Default max output bytes captured. */
  maxOutputBytes: number;
  /** Permissions required to invoke this tool. */
  permissions: ToolPermissions;
  /** If set, retry on transient errors this many times. */
  maxRetries?: number;
  /** Backoff strategy (ms). Default: [500, 1000, 2000]. */
  retryDelaysMs?: number[];
  /** If true, output is streamed as chunks (caller gets a stream handle). */
  streamable?: boolean;
}

// ─── Execution result ───────────────────────────────────────────────────────

export interface ToolOutput {
  /** Exit code (0 = success). */
  exitCode: number;
  /** Stdout text. */
  stdout: string;
  /** Stderr text. */
  stderr: string;
  /** Wall-clock runtime in ms. */
  durationMs: number;
  /** True if the tool was killed due to timeout. */
  timedOut: boolean;
  /** True if output was truncated to maxOutputBytes. */
  truncated: boolean;
  /** Optional structured data (e.g. Playwright screenshot path). */
  data?: Record<string, unknown>;
}

/** A single emitted chunk during streaming execution. */
export interface ToolChunk {
  kind: "stdout" | "stderr" | "error" | "exit";
  data: string;
  timestamp: number;
}

// ─── Streaming ──────────────────────────────────────────────────────────────

/** Callback-based stream consumer. */
export type StreamCallback = (chunk: ToolChunk) => void | Promise<void>;

// ─── Internal helpers ───────────────────────────────────────────────────────

export interface SpawnedProcess {
  process: ChildProcess;
  kind: ToolKind;
  startedAt: number;
}

export interface ToolExecution {
  def: ToolDef;
  params: ToolParams;
  startedAt: number;
  /** Abort controller for cancellation. */
  abortController: AbortController;
}
