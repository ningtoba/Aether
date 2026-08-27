import Dockerode from "dockerode";
import { Writable } from "node:stream";

// ---------------------------------------------------------------------------
// Local type definitions (replaces @aether/types dependency)
// ---------------------------------------------------------------------------

export interface BaseExecOptions {
  timeout?: number;
  limits?: SandboxProfile | Partial<SandboxLimits>;
  files?: SandboxFile[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  signal: NodeJS.Signals | null;
  duration: number;
  timedOut: boolean;
}

export interface SandboxFile {
  path: string;
  content: string;
  mode?: number;
}

export interface SandboxLimits {
  memoryMb: number;
  cpuSeconds: number;
  processes: number;
  network: boolean;
  writeAccess: boolean;
}

export type SandboxProfile = "minimal" | "standard" | "high" | "unrestricted";

export interface EnvStatus {
  ready: boolean;
  type: string;
  error?: string;
  version?: string;
  info?: Record<string, unknown>;
}

export const SANDBOX_PROFILES: Record<SandboxProfile, SandboxLimits> = {
  minimal: { memoryMb: 128, cpuSeconds: 10, processes: 20, network: false, writeAccess: false },
  standard: { memoryMb: 512, cpuSeconds: 30, processes: 50, network: false, writeAccess: false },
  high: { memoryMb: 2048, cpuSeconds: 120, processes: 100, network: true, writeAccess: true },
  unrestricted: { memoryMb: 8192, cpuSeconds: 600, processes: 500, network: true, writeAccess: true },
};

export const DEFAULT_LIMITS: SandboxLimits = { memoryMb: 512, cpuSeconds: 30, processes: 50, network: false, writeAccess: false };
/**
 * Validate a sandbox-relative destination path and return it normalized to
 * forward slashes. Absolute paths and `..` traversal segments are rejected so
 * a caller cannot write outside the sandbox working directory.
 */
export function assertSafeSandboxPath(relPath: string): string {
  if (!relPath || relPath.length === 0) {
    throw new Error("Empty sandbox file path");
  }
  if (relPath.startsWith("/") || /^[a-zA-Z]:/.test(relPath)) {
    throw new Error(`Absolute paths are not allowed in sandbox files: "${relPath}"`);
  }
  const normalized = relPath.replace(/\\/g, "/");
  const segments = normalized.split("/");
  if (segments.includes("..")) {
    throw new Error(`Path traversal is not allowed in sandbox files: "${relPath}"`);
  }
  return normalized;
}

/** Single-quote a string for POSIX /bin/sh, neutralizing embedded quotes. */
export function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

// ---------------------------------------------------------------------------
// Docker sandbox — isolated code execution via ephemeral containers
// ---------------------------------------------------------------------------

export interface DockerSandboxOptions {
  /** Base Docker image (default: 'node:22-alpine') */
  image?: string;
  /** Resource limits profile or custom limits */
  limits?: SandboxProfile | Partial<SandboxLimits>;
  /** Volume mounts: host_path -> container_path */
  volumes?: Record<string, string>;
  /** Working directory inside the container */
  workdir?: string;
  /** Container name prefix for easy identification */
  namePrefix?: string;
  /** Timeout for container operations (default: 30_000 ms) */
  operationTimeout?: number;
}

const DEFAULT_OPTIONS: Required<DockerSandboxOptions> = {
  image: "node:22-alpine",
  limits: "standard",
  volumes: {},
  workdir: "/workspace",
  namePrefix: "aether-sandbox",
  operationTimeout: 30_000,
};

let _docker: Dockerode | null = null;

function getDocker(): Dockerode {
  if (!_docker) {
    _docker = new Dockerode();
  }
  return _docker;
}

function resolveLimits(limits?: SandboxProfile | Partial<SandboxLimits>): SandboxLimits {
  if (!limits || (typeof limits === "string" && limits in SANDBOX_PROFILES)) {
    return SANDBOX_PROFILES[(limits as SandboxProfile) ?? "standard"];
  }
  if (typeof limits === "object") {
    return { ...DEFAULT_LIMITS, ...limits };
  }
  return DEFAULT_LIMITS;
}

function limitsToDockerHostConfig(limits: SandboxLimits): Dockerode.HostConfig {
  const hostConfig: Dockerode.HostConfig = {
    Memory: limits.memoryMb * 1024 * 1024,
    MemorySwap: limits.memoryMb * 1024 * 1024, // no swap
    NanoCpus: Math.max(1, Math.round(limits.cpuSeconds / 30)) * 1e9,
    PidsLimit: limits.processes,
    Init: true,
    ReadonlyRootfs: !limits.writeAccess,
    AutoRemove: true,
  };

  if (!limits.network) {
    hostConfig.NetworkMode = "none";
  }

  return hostConfig;
}

function mergeOptions(user?: DockerSandboxOptions): Required<DockerSandboxOptions> {
  if (!user) return DEFAULT_OPTIONS;
  return {
    image: user.image ?? DEFAULT_OPTIONS.image,
    limits: user.limits ?? DEFAULT_OPTIONS.limits,
    volumes: user.volumes ?? DEFAULT_OPTIONS.volumes,
    workdir: user.workdir ?? DEFAULT_OPTIONS.workdir,
    namePrefix: user.namePrefix ?? DEFAULT_OPTIONS.namePrefix,
    operationTimeout: user.operationTimeout ?? DEFAULT_OPTIONS.operationTimeout,
  };
}

// ---------------------------------------------------------------------------
// Helpers — stream & exec
// ---------------------------------------------------------------------------

/**
 * Demultiplex a Docker attach/exec stream into stdout and stderr strings.
 *
 * Docker's streaming API multiplexes stdout (fd 1) and stderr (fd 2) over a
 * single stream using 8-byte headers.  dockerode exposes `modem.demuxStream()`
 * to split them.
 */
function demuxStream(
  container: Dockerode.Container,
  stream: NodeJS.ReadableStream,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];

    const outStream = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        outChunks.push(chunk);
        callback();
      },
    });

    const errStream = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        errChunks.push(chunk);
        callback();
      },
    });

    // modem.demuxStream is untyped on the Dockerode types but exists at runtime
    const modem = (container as unknown as { modem: { demuxStream: (s: NodeJS.ReadableStream, o: Writable, e: Writable) => void } }).modem;
    modem.demuxStream(stream, outStream, errStream);

    stream.on("end", () => {
      resolve({
        stdout: Buffer.concat(outChunks).toString("utf-8").trimEnd(),
        stderr: Buffer.concat(errChunks).toString("utf-8").trimEnd(),
      });
    });
    stream.on("error", reject);
  });
}

/** Collect a raw (non-multiplexed) stream into a string. */
function streamToString(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8").trimEnd()));
  });
}

/** Wait for a container to reach 'running' status with timeout. */
async function waitForContainerRunning(
  container: Dockerode.Container,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const info = await container.inspect();
    if (info.State.Running) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Container did not reach running status within timeout");
}

// ─── Container lifecycle ───────────────────────────────────────────────────

let containerCounter = 0;

/**
 * Create and start an ephemeral sandbox container.
 * The container stays alive as a background daemon so we can exec into it,
 * avoiding per-command spawn overhead.
 */
export async function createSandbox(
  opts?: DockerSandboxOptions,
): Promise<{ containerId: string; name: string }> {
  const docker = getDocker();
  const config = mergeOptions(opts);
  const limits = resolveLimits(config.limits);
  const name = `${config.namePrefix}-${++containerCounter}-${Date.now()}`;

  // Check if Docker is available
  try {
    await docker.ping();
  } catch {
    throw new Error(
      "Docker is not available. Make sure Docker is installed and the daemon is running.",
    );
  }

  const hostConfig = limitsToDockerHostConfig(limits);

  // Build volume binds
  const binds: string[] = Object.entries(config.volumes).map(
    ([host, cont]) => `${host}:${cont}`,
  );
  if (binds.length > 0) {
    hostConfig.Binds = binds;
  }

  const createOptions: Dockerode.ContainerCreateOptions = {
    Image: config.image,
    name,
    WorkingDir: config.workdir,
    HostConfig: hostConfig,
    Cmd: ["sleep", "infinity"],
    AttachStdin: false,
    AttachStdout: false,
    AttachStderr: false,
    OpenStdin: false,
    StdinOnce: false,
  };

  const container = await docker.createContainer(createOptions);
  await container.start();
  await waitForContainerRunning(container, config.operationTimeout);

  return { containerId: container.id, name };
}

/** Destroy a sandbox container */
export async function destroySandbox(containerId: string): Promise<void> {
  const docker = getDocker();
  const container = docker.getContainer(containerId);
  try {
    await container.kill();
  } catch {
    // Container may already be stopped — that's fine
  }
  try {
    await container.remove({ force: true });
  } catch {
    // Best-effort cleanup
  }
}

// ─── File operations ───────────────────────────────────────────────────────

/** Copy files into the sandbox container before execution */
export async function copyFilesToSandbox(
  containerId: string,
  files: SandboxFile[],
  destDir: string = "/workspace",
): Promise<void> {
  const docker = getDocker();
  const container = docker.getContainer(containerId);

  for (const file of files) {
    const safePath = assertSafeSandboxPath(file.path);
    const parentDir = safePath.includes("/")
      ? safePath.substring(0, safePath.lastIndexOf("/"))
      : "";
    const dirTarget = parentDir ? `${destDir}/${parentDir}` : destDir;

    await execInContainer(container, ["sh", "-c", `mkdir -p ${shQuote(dirTarget)}`]);

    // Send content as base64 so no byte sequence in the payload can break out
    // of a shell string or terminate a heredoc early.
    const base64 = Buffer.from(file.content, "utf-8").toString("base64");
    await execInContainer(container, [
      "sh", "-c",
      `printf %s ${shQuote(base64)} | base64 -d > ${shQuote(`${destDir}/${safePath}`)}`,
    ]);

    // Set mode after writing
    if (file.mode) {
      await execInContainer(container, [
        "chmod", file.mode.toString(8), `${destDir}/${safePath}`,
      ]);
    }
  }
}

/** Low-level exec helper that throws on non-zero exit. */
async function execInContainer(
  container: Dockerode.Container,
  cmd: string[],
): Promise<string> {
  const exec = await container.exec({
    Cmd: cmd,
    AttachStdout: true,
    AttachStderr: true,
  });
  const execStream = await exec.start({ Detach: false, Tty: false });
  const output = await streamToString(execStream);

  const inspectResult = await exec.inspect();
  if (inspectResult.ExitCode !== 0) {
    throw new Error(`Command failed (exit ${inspectResult.ExitCode}): ${output}`);
  }

  return output;
}

// ─── Command execution ─────────────────────────────────────────────────────

export interface DockerExecOptions extends BaseExecOptions {
  /** Shell to use (default: /bin/sh) */
  shell?: string;
}

/**
 * Execute a command inside a running sandbox container.
 */
export async function execInSandbox(
  containerId: string,
  command: string,
  opts?: DockerExecOptions,
): Promise<ExecResult> {
  const startTime = Date.now();
  const timeout = opts?.timeout ?? 30_000;
  const limits = opts?.limits ? resolveLimits(opts.limits) : DEFAULT_LIMITS;

  // 1. Copy files in
  if (opts?.files && opts.files.length > 0) {
    await copyFilesToSandbox(containerId, opts.files, opts?.cwd ?? "/workspace");
  }

  // 2. Build docker exec command
  const docker = getDocker();
  const container = docker.getContainer(containerId);

  const env: string[] = [];
  if (opts?.env) {
    for (const [key, value] of Object.entries(opts.env)) {
      env.push(`${key}=${value}`);
    }
  }

  const workdir = opts?.cwd ?? "/workspace";
  const shell = opts?.shell ?? "/bin/sh";

  // Use timeout command inside container
  const execCmd = [
    shell, "-c",
    `timeout ${Math.ceil(limits.cpuSeconds)} ${command}`,
  ];

  const exec = await container.exec({
    Cmd: execCmd,
    Env: env.length > 0 ? env : undefined,
    WorkingDir: workdir,
    AttachStdout: true,
    AttachStderr: true,
  });

  const execStream = await exec.start({ Detach: false, Tty: false });

  // Demultiplex stdout/stderr from the raw Docker stream
  const { stdout, stderr } = await demuxStream(container, execStream);

  // Get exit code by inspecting the exec instance
  let exitCode = 0;
  let timedOut = false;
  try {
    const inspectResult = await exec.inspect();
    exitCode = inspectResult.ExitCode ?? 0;
    timedOut = exitCode === 124; // GNU timeout exit code
  } catch {
    // If inspect fails, use defaults
  }

  const duration = Date.now() - startTime;

  return {
    stdout,
    stderr,
    exitCode,
    signal: null,
    duration,
    timedOut,
  };
}

// ─── Status check ──────────────────────────────────────────────────────────

export async function checkDockerEnv(): Promise<EnvStatus> {
  const docker = getDocker();
  try {
    const version = await docker.version();
    return {
      ready: true,
      type: "docker",
      version: version.Version,
      info: { serverVersion: version.Version, apiVersion: version.ApiVersion },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Docker daemon not reachable";
    return {
      ready: false,
      type: "docker",
      error: message,
    };
  }
}
