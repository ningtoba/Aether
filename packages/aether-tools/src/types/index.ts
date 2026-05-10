// ─── Tool Identity ──────────────────────────────────────────────────────────

export type ToolId = string & { __toolId: true };
export type ToolName = string & { __toolName: true };

export interface ToolIdentity {
  id: ToolId;
  name: string;
  description?: string;
  version: string;
}

// ─── Tool Parameter Schema ──────────────────────────────────────────────────

export type ToolParameterType = 'string' | 'number' | 'boolean' | 'integer' | 'array' | 'object';

export interface ToolParameter {
  name: string;
  type: ToolParameterType;
  description?: string;
  required: boolean;
  default?: unknown;
  enum?: string[];
  items?: ToolParameter;
  properties?: Record<string, ToolParameter>;
}

export interface ToolParameterSchema {
  type: 'object';
  properties: Record<string, ToolParameter>;
  required?: string[];
}

// ─── Execution Results ──────────────────────────────────────────────────────

export type ToolResultStatus = 'success' | 'error' | 'timeout' | 'cancelled' | 'permission_denied';

export interface ToolResult {
  status: ToolResultStatus;
  data: unknown;
  error?: string;
  durationMs: number;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  metadata?: Record<string, unknown>;
}

export interface ToolStreamChunk {
  type: 'stdout' | 'stderr' | 'data' | 'error' | 'done';
  data: string | Uint8Array;
  timestamp: number;
  sequence: number;
}

// ─── Permission Model ───────────────────────────────────────────────────────

export type PermissionLevel = 'allow' | 'prompt' | 'deny';
export type PermissionScope = 'network' | 'filesystem' | 'env' | 'process' | 'docker' | 'browser';

export interface PermissionRule {
  scope: PermissionScope;
  level: PermissionLevel;
  patterns?: string[]; // glob patterns for filesystem/net paths
  reason?: string;
}

export interface PermissionRequest {
  toolId: ToolId;
  scope: PermissionScope;
  resource: string;
  reason?: string;
}

export interface PermissionResponse {
  granted: boolean;
  level: PermissionLevel;
  reason?: string;
}

// ─── Runtime Config ─────────────────────────────────────────────────────────

export interface ToolRuntimeConfig {
  timeoutMs: number;
  maxRetries: number;
  retryDelayMs: number;
  maxOutputBytes: number;
  env?: Record<string, string>;
  workdir?: string;
}

export const DEFAULT_RUNTIME_CONFIG: ToolRuntimeConfig = {
  timeoutMs: 30_000,
  maxRetries: 0,
  retryDelayMs: 1_000,
  maxOutputBytes: 1_000_000,
};

// ─── Sandbox Config ─────────────────────────────────────────────────────────

export interface DockerSandboxConfig {
  image: string;
  tag?: string;
  containerName?: string;
  memoryLimit?: string; // e.g. "512m"
  cpuLimit?: number;    // e.g. 1.0 = 1 core
  networkEnabled?: boolean;
  readOnly?: boolean;
  volumes?: Array<{ host: string; container: string; mode?: 'ro' | 'rw' }>;
  workingDir?: string;
  env?: Record<string, string>;
}

export const DEFAULT_DOCKER_SANDBOX: DockerSandboxConfig = {
  image: 'ubuntu',
  tag: '22.04',
  memoryLimit: '512m',
  cpuLimit: 1.0,
  networkEnabled: false,
  readOnly: true,
  workingDir: '/workspace',
};

export interface BrowserSandboxConfig {
  headless: boolean;
  viewport?: { width: number; height: number };
  locale?: string;
  timeout?: number;
  userAgent?: string;
}

export const DEFAULT_BROWSER_SANDBOX: BrowserSandboxConfig = {
  headless: true,
  viewport: { width: 1280, height: 720 },
  timeout: 30_000,
};

export interface PythonSandboxConfig {
  pythonPath?: string;     // default "python3"
  venvPath?: string;       // path to existing venv
  installDeps?: boolean;   // auto pip install before execution
  requirements?: string[]; // pip packages
}

export interface NodeSandboxConfig {
  nodePath?: string;       // default "node"
  installDeps?: boolean;
  packages?: string[];     // npm packages to install
}

// ─── Tool Definition ────────────────────────────────────────────────────────

export type RuntimeKind = 'shell' | 'docker' | 'browser' | 'python' | 'node';

export type ToolHandler = (params: Record<string, unknown>, context: ToolExecutionContext) => Promise<ToolResult>;

export interface ToolExecutionContext {
  config: ToolRuntimeConfig;
  permissions: PermissionRule[];
  requestPermission: (req: PermissionRequest) => Promise<PermissionResponse>;
  emit: (chunk: ToolStreamChunk) => void;
  abortSignal: AbortSignal;
}

export interface ToolDefinition {
  identity: ToolIdentity;
  runtime: RuntimeKind;
  handler: ToolHandler;
  parameters: ToolParameterSchema;
  config: ToolRuntimeConfig;
  permissions: PermissionRule[];
  sandbox?: DockerSandboxConfig | BrowserSandboxConfig | PythonSandboxConfig | NodeSandboxConfig;
}

// ─── Registry Types ─────────────────────────────────────────────────────────

export interface ToolRegistration {
  definition: ToolDefinition;
  enabled: boolean;
  registeredAt: number;
  lastUsedAt?: number;
  useCount: number;
}

export interface ToolRegistryOptions {
  defaultConfig?: Partial<ToolRuntimeConfig>;
  permissionResolver?: (req: PermissionRequest) => Promise<PermissionResponse>;
}

// ─── Event System ───────────────────────────────────────────────────────────

export type ToolEventType =
  | 'tool:registered'
  | 'tool:unregistered'
  | 'tool:started'
  | 'tool:completed'
  | 'tool:failed'
  | 'tool:timedout'
  | 'stream:chunk'
  | 'permission:requested'
  | 'permission:granted'
  | 'permission:denied';

export interface ToolEvent {
  type: ToolEventType;
  toolId?: ToolId;
  timestamp: number;
  data?: unknown;
}
