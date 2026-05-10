import { execSync, type ExecSyncOptionsWithBufferEncoding } from "node:child_process";
import type { ExecResult, SandboxFile, BaseExecOptions, SandboxLimits, SandboxProfile, EnvStatus } from "@aether/types";
import { SANDBOX_PROFILES, DEFAULT_LIMITS } from "@aether/types";

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

function resolveLimits(limits?: SandboxProfile | Partial<SandboxLimits>): SandboxLimits {
  if (!limits || (typeof limits === "string" && limits in SANDBOX_PROFILES)) {
    return SANDBOX_PROFILES[(limits as SandboxProfile) ?? "standard"];
  }
  if (typeof limits === "object") {
    return { ...DEFAULT_LIMITS, ...limits };
  }
  return DEFAULT_LIMITS;
}

function limitsToDockerArgs(limits: SandboxLimits): string[] {
  const args: string[] = [];
  args.push("--memory", `${limits.memoryMb}m`);
  args.push("--memory-swap", `${limits.memoryMb}m`); // no swap
  args.push("--cpus", `${Math.max(1, Math.round(limits.cpuSeconds / 30))}`);
  args.push("--pids-limit", String(limits.processes));
  if (!limits.network) args.push("--network", "none");
  if (!limits.writeAccess) args.push("--read-only");
  return args;
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

// ─── Shell helper ──────────────────────────────────────────────────────────

function dockerCmd(
  args: string[],
  timeout?: number,
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const opts: ExecSyncOptionsWithBufferEncoding = {
      encoding: "utf-8",
      timeout: timeout ?? 30_000,
      maxBuffer: 10 * 1024 * 1024, // 10 MB
    };
    const stdout = execSync(`docker ${args.join(" ")}`, opts);
    return { stdout: stdout.trim(), stderr: "", exitCode: 0 };
  } catch (err: unknown) {
    const error = err as {
      stdout?: string;
      stderr?: string;
      status?: number;
      message?: string;
    };
    return {
      stdout: (error.stdout ?? "").toString().trim(),
      stderr: (error.stderr ?? error.message ?? "").toString().trim(),
      exitCode: error.status ?? 1,
    };
  }
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
  const config = mergeOptions(opts);
  const limits = resolveLimits(config.limits);
  const name = `${config.namePrefix}-${++containerCounter}-${Date.now()}`;

  // Check if Docker is available
  const ping = dockerCmd(["info", "--format", "{{.ServerVersion}}"], 10_000);
  if (ping.exitCode !== 0) {
    throw new Error(
      `Docker is not available: ${ping.stderr || ping.stdout}\n` +
        "Make sure Docker is installed and the daemon is running.",
    );
  }

  const limitArgs = limitsToDockerArgs(limits);
  const volumeArgs = Object.entries(config.volumes).flatMap(([host, container]) => [
    "-v",
    `${host}:${container}`,
  ]);

  const createArgs = [
    "run",
    "-d",                           // detach
    "--rm",                         // auto-clean on stop
    "--name", name,
    "--init",                       // tini init for proper signal handling
    ...limitArgs,
    ...volumeArgs,
    "-w", config.workdir,
    config.image,
    "sleep", "infinity",             // keep alive
  ];

  const result = dockerCmd(createArgs, config.operationTimeout);
  if (result.exitCode !== 0) {
    throw new Error(`Failed to create sandbox: ${result.stderr || result.stdout}`);
  }

  return { containerId: result.stdout.trim(), name };
}

/** Destroy a sandbox container */
export async function destroySandbox(containerId: string): Promise<void> {
  dockerCmd(["rm", "-f", containerId], 15_000);
}

// ─── File operations ───────────────────────────────────────────────────────

/** Copy files into the sandbox container before execution */
export async function copyFilesToSandbox(
  containerId: string,
  files: SandboxFile[],
  destDir: string = "/workspace",
): Promise<void> {
  for (const file of files) {
    // Build a tar stream on stdin for 'docker cp -'
    const parentDir = file.path.includes("/")
      ? file.path.substring(0, file.path.lastIndexOf("/"))
      : "";

    let createCmd = `mkdir -p '${destDir}/${parentDir}'`;
    let modeCmd = "";
    if (file.mode) {
      modeCmd = ` && chmod ${file.mode.toString(8)} '${destDir}/${file.path}'`;
    }

    const dockerExec = dockerCmd([
      "exec", containerId, "sh", "-c",
      `'${createCmd}${modeCmd}'`,
    ], 10_000 );

    if (dockerExec.exitCode !== 0) {
      throw new Error(`Failed to prepare directory for ${file.path}: ${dockerExec.stderr}`);
    }

    // Write content via heredoc to avoid escaping issues
    const escapedContent = file.content
      .replace(/'/g, "'\\''"); // single-quote escaping
    const writeResult = dockerCmd([
      "exec", containerId, "sh", "-c",
      `cat > '${destDir}/${file.path}' << 'AETHER_EOF'\n${file.content}\nAETHER_EOF`,
    ], 15_000);

    if (writeResult.exitCode !== 0) {
      throw new Error(`Failed to write ${file.path}: ${writeResult.stderr}`);
    }

    // Set mode after writing
    if (file.mode) {
      dockerCmd([
        "exec", containerId, "chmod", file.mode.toString(8),
        `'${destDir}/${file.path}'`,
      ], 5_000);
    }
  }
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
  const envArgs: string[] = [];
  if (opts?.env) {
    for (const [key, value] of Object.entries(opts.env)) {
      envArgs.push("-e", `${key}=${value}`);
    }
  }

  const workdir = opts?.cwd ?? "/workspace";
  const shell = opts?.shell ?? "/bin/sh";
  const fullCmd = [
    "exec",
    "-w", workdir,
    ...envArgs,
    containerId,
    shell, "-c",
    // Use timeout command inside container
    `timeout ${Math.ceil(limits.cpuSeconds)} ${command}`,
  ];

  const result = dockerCmd(fullCmd, timeout + 5_000);

  const duration = Date.now() - startTime;
  const timedOut = result.exitCode === 124; // GNU timeout exit code

  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    signal: null,
    duration,
    timedOut,
  };
}

// ─── Status check ──────────────────────────────────────────────────────────

export async function checkDockerEnv(): Promise<EnvStatus> {
  const ping = dockerCmd(["info", "--format", "{{.ServerVersion}}"], 10_000);
  if (ping.exitCode !== 0) {
    return {
      ready: false,
      type: "docker",
      error: ping.stderr || "Docker daemon not reachable",
    };
  }

  return {
    ready: true,
    type: "docker",
    version: ping.stdout,
    info: { serverVersion: ping.stdout },
  };
}
