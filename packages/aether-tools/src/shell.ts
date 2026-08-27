/**
 * Local shell executor — spawns child processes with timeout,
 * streaming, and signal handling.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { Readable } from 'node:stream';
import type { ToolDef, ToolParams, ToolOutput, ToolChunk, StreamCallback } from './types.js';

export type ShellResult = ToolOutput;

/**
 * Execute a shell command locally.
 *
 * @param def  Tool definition (timeout, maxOutputBytes)
 * @param params  Command to run
 * @param onChunk  Optional streaming callback
 * @param signal  AbortSignal for cancellation
 */
export async function execShell(
  def: ToolDef,
  params: ToolParams,
  onChunk?: StreamCallback,
  signal?: AbortSignal,
): Promise<ShellResult> {
  const startedAt = Date.now();
  const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
  const shellFlag = process.platform === 'win32' ? '/c' : '-c';

  const command = params.command ?? '';
  const argv = params.args ?? [];
  const fullCommand =
    argv.length > 0 ? `${command} ${argv.map((a) => escapeShellArg(a)).join(' ')}` : command;

  const child = spawn(shell, [shellFlag, fullCommand], {
    cwd: params.cwd ?? process.cwd(),
    env: params.env ? { ...process.env, ...params.env } : process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    signal,
    // Do not let Node re-quote our already-quoted command line on Windows:
    // without this, Node would mangle the command string for cmd.exe.
    ...(process.platform === 'win32' ? { windowsVerbatimArguments: true } : {}),
  });

  return collectOutput(child, def, startedAt, onChunk);
}

/**
 * Execute a shell command inside a Docker container.
 * Requires the docker CLI to be available.
 */
export async function execShellDocker(
  def: ToolDef,
  params: ToolParams,
  onChunk?: StreamCallback,
  signal?: AbortSignal,
): Promise<ShellResult> {
  const startedAt = Date.now();
  const image = params.image ?? 'alpine:latest';
  const command = params.command ?? '';
  const argv = params.args ?? [];

  const dockerArgs = ['run', '--rm', '-i'];
  if (params.cwd) dockerArgs.push('-w', params.cwd);
  if (params.env) {
    for (const [k, v] of Object.entries(params.env)) {
      dockerArgs.push('-e', `${k}=${v}`);
    }
  }
  dockerArgs.push(image);
  dockerArgs.push(command, ...argv);

  const child = spawn('docker', dockerArgs, {
    stdio: ['pipe', 'pipe', 'pipe'],
    signal,
  });

  return collectOutput(child, def, startedAt, onChunk);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Escape a single argument for a shell invocation.
 *
 * POSIX shells quote with single quotes. cmd.exe has no quote semantics for
 * single quotes (they are passed through literally), so on Windows we wrap in
 * double quotes and caret-escape the metacharacters that stay active inside
 * them (`%` expansion, delayed-expansion `!`, and the caret itself, ahead of
 * quote doubling). Exported so the per-platform logic is unit-testable on any
 * host OS.
 */
export function escapeShellArg(arg: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') {
    // Order matters: escape the caret first so the carets we inject below
    // are never themselves re-escaped, then expansion metachars, then quotes.
    // CR/LF are stripped outright so embedded newlines cannot split the
    // command line cmd.exe builds.
    const escaped = arg
      .replace(/[\r\n]/g, ' ')
      .replace(/\^/g, '^^')
      .replace(/%/g, '^%')
      .replace(/!/g, '^!')
      .replace(/"/g, '""');
    return `"${escaped}"`;
  }
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

async function collectOutput(
  child: ChildProcess,
  def: ToolDef,
  startedAt: number,
  onChunk?: StreamCallback,
): Promise<ShellResult> {
  const timeoutMs = def.timeoutMs;
  const maxBytes = def.maxOutputBytes;
  let timedOut = false;
  let truncated = false;

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  let stdoutLen = 0;
  let stderrLen = 0;

  const pushStdout = (chunk: Buffer) => {
    const remaining = maxBytes - stdoutLen;
    if (remaining <= 0) {
      truncated = true;
      return;
    }
    const slice = chunk.subarray(0, remaining);
    stdoutChunks.push(slice);
    stdoutLen += slice.length;
    if (onChunk) {
      void onChunk({
        kind: 'stdout',
        data: slice.toString('utf-8'),
        timestamp: Date.now(),
      });
    }
  };

  const pushStderr = (chunk: Buffer) => {
    const remaining = maxBytes - stderrLen;
    if (remaining <= 0) {
      truncated = true;
      return;
    }
    const slice = chunk.subarray(0, remaining);
    stderrChunks.push(slice);
    stderrLen += slice.length;
    if (onChunk) {
      void onChunk({
        kind: 'stderr',
        data: slice.toString('utf-8'),
        timestamp: Date.now(),
      });
    }
  };

  // Timeout timer
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
    // Give process 3 s to respond to SIGTERM before SIGKILL
    setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already dead */
      }
    }, 3000).unref();
  }, timeoutMs).unref();

  // Wire up stdin if provided (only for Docker mode where stdin matters)
  // For regular shell mode, stdin is not piped by default.

  return new Promise<ShellResult>((resolve) => {
    if (child.stdout) {
      child.stdout.on('data', pushStdout);
    }
    if (child.stderr) {
      child.stderr.on('data', pushStderr);
    }

    child.on('error', (err) => {
      clearTimeout(timer);
      if (onChunk) {
        void onChunk({
          kind: 'error',
          data: err.message,
          timestamp: Date.now(),
        });
      }
      resolve({
        exitCode: -1,
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: `${err.message}\n`,
        durationMs: Date.now() - startedAt,
        timedOut: false,
        truncated,
      });
    });

    child.on('close', (exitCode) => {
      clearTimeout(timer);
      if (onChunk) {
        void onChunk({
          kind: 'exit',
          data: String(exitCode),
          timestamp: Date.now(),
        });
      }
      resolve({
        exitCode: exitCode ?? -1,
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
        durationMs: Date.now() - startedAt,
        timedOut,
        truncated,
      });
    });
  });
}
