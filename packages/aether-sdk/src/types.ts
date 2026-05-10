/**
 * Configuration for an AI agent, wrapping OpenAI Agents SDK Agent params.
 */
export interface AgentConfig {
  /** Agent name / identifier */
  name: string;
  /** Model identifier (e.g. "gpt-4o", "claude-3-5-sonnet") */
  model: string;
  /** System instructions for the agent */
  instructions: string;
  /** Tools registered to this agent */
  tools: Array<{
    id?: string;
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    enabled: boolean;
    timeout: number;
    sandboxed: boolean;
  }>;
  /** Handoff targets (agent names this agent can delegate to) */
  handoffs: string[];
  /** Optional output type / schema name */
  outputType?: string;
  /** Guardrail configuration names */
  guardrails: string[];
  /** Maximum number of turns before forced handoff */
  maxTurns: number;
  /** Context / extra instructions injected at runtime */
  context?: Record<string, unknown>;
}

/**
 * Configuration for running an agent.
 */
export interface RunConfig {
  /** Maximum execution turns */
  maxTurns: number;
  /** Optional trace / span ID for observability */
  tracingId?: string;
  /** Additional context injected into the agent's instructions */
  context?: Record<string, unknown>;
}

/**
 * Outcome of a single agent run.
 */
export interface RunResult {
  /** Final output from the agent */
  output: string;
  /** Number of turns consumed */
  turns: number;
  /** Total token usage across the run */
  tokenUsage: { prompt: number; completion: number; total: number };
  /** Tool calls made during the run */
  toolCalls: Array<{ name: string; args: Record<string, unknown> }>;
}

/**
 * Metadata describing a function tool for the SDK.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** The actual implementation function */
  handler?: (...args: unknown[]) => unknown | Promise<unknown>;
  /** Whether the tool is enabled */
  enabled?: boolean;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Whether the tool runs in a sandbox */
  sandboxed?: boolean;
}
