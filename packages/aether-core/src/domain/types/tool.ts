/** Tool identification */
export type ToolId = string & { readonly __brand: 'ToolId' };

/** Supported types of execution tools */
export type ToolType = 'shell' | 'docker' | 'python' | 'typescript' | 'browser' | 'mcp' | 'custom';

/** Full definition of a tool available to agents */
export interface ToolDefinition {
  id: ToolId;
  name: string;
  description: string;
  type: ToolType;
  parameters: Record<string, unknown>;
  enabled: boolean;
  timeout: number;
  sandboxed: boolean;
  allowedPaths?: string[];
  deniedCommands?: string[];
}

/** A tool invocation initiated by an agent */
export interface ToolCall {
  id: string;
  toolId: ToolId;
  args: Record<string, unknown>;
  timestamp: number;
}

/** The result of a tool execution */
export interface ToolResult {
  id: string;
  toolCallId: string;
  success: boolean;
  output: string;
  error?: string;
  duration: number;
  exitCode?: number;
}

/** Tool input parameter schema (JSON Schema subset) */
export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required: boolean;
  default?: unknown;
  enum?: string[];
}

/** Tool execution context passed at runtime */
export interface ToolExecutionContext {
  workdir: string;
  env: Record<string, string>;
  timeout: number;
  allowedCommands?: string[];
  deniedCommands?: string[];
}

/** Tool permission for sandboxed execution */
export interface ToolPermission {
  toolId: ToolId;
  allow: boolean;
  maxConcurrency: number;
  maxDuration: number;
  resourceLimits?: {
    cpu?: number;
    memory?: number;
    disk?: number;
  };
}

/** MCP (Model Context Protocol) server configuration */
export interface MCPServerConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  allowedTools: string[];
  enabled: boolean;
}
