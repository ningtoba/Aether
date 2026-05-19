/**
 * @aether/tools — Tool runtime, registry, sandbox execution, and streaming.
 *
 * Provides a tool registry system, local and Docker-based shell executors,
 * an event bus for tool lifecycle events, and stream channels for
 * streaming output.
 *
 * @module @aether/tools
 */

export const VERSION = "0.1.0";

// ── Shell executors ───────────────────────────────────────────────────────────
export { execShell, execShellDocker } from "./shell.js";
export type { ShellResult } from "./shell.js";

// ── Tool Registry ─────────────────────────────────────────────────────────────
export { ToolRegistry, ToolRegistryError, ToolNotFoundError, ToolAlreadyRegisteredError } from "./registry/index.js";

// ── Streaming / Event Bus ─────────────────────────────────────────────────────
export { EventBus, StreamChannel } from "./streaming/event-bus.js";

// ── Types (flat) ──────────────────────────────────────────────────────────────
export type {
  // Permission model
  PermissionScope,
  ToolPermissions,

  // Tool definition
  ToolKind,
  ToolParams,
  ToolDef,
  ToolOutput,
  ToolChunk,
  StreamCallback,

  // Internal helpers
  SpawnedProcess,
  ToolExecution,
} from "./types.js";

// ── Types (index) ─────────────────────────────────────────────────────────────
export type {
  // Tool Identity
  ToolId,
  ToolName,
  ToolIdentity,

  // Execution Results
  ToolResultStatus,
  ToolResult,
  ToolStreamChunk,

  // Permission Model
  PermissionLevel,
  PermissionRule,
  PermissionRequest,
  PermissionResponse,

  // Runtime Config
  ToolRuntimeConfig,
  DockerSandboxConfig,
  BrowserSandboxConfig,
  PythonSandboxConfig,
  NodeSandboxConfig,

  // Tool Definition
  RuntimeKind,
  ToolHandler,
  ToolExecutionContext,
  ToolDefinition as ToolDefIndex,
  ToolRegistration,
  ToolRegistryOptions,

  // Event System
  ToolEventType,
  ToolEvent,

  // Parameter Schema
  ToolParameterType,
  ToolParameter,
  ToolParameterSchema,
} from "./types/index.js";

export {
  DEFAULT_RUNTIME_CONFIG,
  DEFAULT_DOCKER_SANDBOX,
  DEFAULT_BROWSER_SANDBOX,
} from "./types/index.js";
