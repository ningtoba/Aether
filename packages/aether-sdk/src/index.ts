/**
 * @aether/sdk — Aether SDK wrapping OpenAI Agents SDK concepts.
 *
 * Provides agent construction, execution runner, tool registry,
 * and type definitions that mirror the OpenAI Agents SDK API surface.
 *
 * @module @aether/sdk
 */

export { AetherAgent, AetherRunner } from './agent.js';
export { createTool, ToolRegistry } from './tools.js';

export type { AgentConfig, RunConfig, RunResult, ToolDefinition } from './types.js';
