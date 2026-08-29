/** Resource limits for a sandbox execution */
export interface SandboxLimits {
  /** Max CPU time in seconds */
  cpuSeconds: number;
  /** Max memory in MB */
  memoryMb: number;
  /** Max disk usage in MB (temporary files) */
  diskMb: number;
  /** Max number of processes */
  processes: number;
  /** Allowed network access */
  network: boolean;
  /** Allowed file writes outside sandbox */
  writeAccess: boolean;
}

/** Default resource limits */
export const DEFAULT_LIMITS: SandboxLimits = {
  cpuSeconds: 30,
  memoryMb: 512,
  diskMb: 100,
  processes: 50,
  network: false,
  writeAccess: false,
};

/** Sandbox profile presets */
export const SANDBOX_PROFILES = {
  minimal: {
    cpuSeconds: 5,
    memoryMb: 128,
    diskMb: 10,
    processes: 10,
    network: false,
    writeAccess: false,
  } satisfies SandboxLimits,
  standard: {
    cpuSeconds: 30,
    memoryMb: 512,
    diskMb: 100,
    processes: 50,
    network: false,
    writeAccess: false,
  } satisfies SandboxLimits,
  heavy: {
    cpuSeconds: 120,
    memoryMb: 2048,
    diskMb: 500,
    processes: 200,
    network: true,
    writeAccess: false,
  } satisfies SandboxLimits,
  unrestricted: {
    cpuSeconds: 600,
    memoryMb: 8096,
    diskMb: 2000,
    processes: 1000,
    network: true,
    writeAccess: true,
  } satisfies SandboxLimits,
} as const;

export type SandboxProfile = keyof typeof SANDBOX_PROFILES;
