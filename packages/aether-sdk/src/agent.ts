import type { AgentConfig, RunConfig, RunResult } from "./types.js";
import { ToolRegistry } from "./tools.js";

/**
 * AetherAgent wraps configuration for an AI agent, mirroring the
 * OpenAI Agents SDK Agent class.
 *
 * Each agent has a name, system instructions, a model identifier,
 * tools, handoff targets, optional output type, and guardrails.
 */
export class AetherAgent {
  /** Agent display name */
  readonly name: string;
  /** System instructions */
  readonly instructions: string;
  /** Model identifier */
  readonly model: string;
  /** Tool definitions */
  readonly tools: ToolRegistry;
  /** Handoff targets (names of agents this can delegate to) */
  readonly handoffs: string[];
  /** Optional output schema name */
  readonly outputType?: string;
  /** Guardrail names */
  readonly guardrails: string[];
  /** Maximum execution turns */
  readonly maxTurns: number;
  /** Static context injected into instructions */
  readonly context: Record<string, unknown>;

  constructor(config: AgentConfig) {
    this.name = config.name;
    this.instructions = config.instructions;
    this.model = config.model;
    this.tools = new ToolRegistry();
    for (const tool of config.tools) {
      this.tools.register(tool);
    }
    this.handoffs = config.handoffs;
    this.outputType = config.outputType;
    this.guardrails = config.guardrails;
    this.maxTurns = config.maxTurns;
    this.context = config.context ?? {};
  }

  /**
   * Human-readable representation.
   */
  toString(): string {
    return `AetherAgent("${this.name}", model="${this.model}", tools=${this.tools.list().length})`;
  }

  /**
   * Serialise the agent back to a config object.
   */
  toJSON(): AgentConfig {
    return {
      name: this.name,
      instructions: this.instructions,
      model: this.model,
      tools: this.tools.list(),
      handoffs: this.handoffs,
      outputType: this.outputType,
      guardrails: this.guardrails,
      maxTurns: this.maxTurns,
      context: { ...this.context },
    };
  }
}

/**
 * AetherRunner manages the execution lifecycle of an AetherAgent.
 *
 * Analogous to the OpenAI Agents SDK Runner class. Handles running
 * an agent with a given input, respecting max_turns and context.
 */
export class AetherRunner {
  /**
   * Run an agent synchronously (simulated).
   *
   * In a real implementation this would send the agent's config to the
   * LLM provider, execute tool calls in a loop up to maxTurns, and
   * return the final result.
   *
   * @param agent - The agent to run
   * @param input - User / system input message
   * @param config - Optional runtime configuration overrides
   * @returns A RunResult summarising the execution
   */
  static async run(
    agent: AetherAgent,
    input: string,
    config?: Partial<RunConfig>,
  ): Promise<RunResult> {
    const resolvedConfig: RunConfig = {
      maxTurns: config?.maxTurns ?? agent.maxTurns,
      context: { ...agent.context, ...config?.context },
    };

    // ─── Simulated execution ────────────────────────────
    // In production this would:
    //   1. Build a chat completion with the agent's instructions + input
    //   2. Iterate tool calls up to maxTurns
    //   3. Collect token usage and turn count
    //   4. Return the final output

    await new Promise((r) => setTimeout(r, 10));

    return {
      output: `[${agent.name}] processed: "${input}"`,
      turns: 1,
      tokenUsage: { prompt: 100, completion: 50, total: 150 },
      toolCalls: [],
    };
  }

  /**
   * Run an agent and stream the output (simulated).
   *
   * @param agent - The agent to run
   * @param input - User input message
   * @param config - Optional runtime configuration overrides
   * @returns An async generator yielding string chunks
   */
  static async *runStreamed(
    agent: AetherAgent,
    input: string,
    config?: Partial<RunConfig>,
  ): AsyncGenerator<string, RunResult, void> {
    const resolvedConfig: RunConfig = {
      maxTurns: config?.maxTurns ?? agent.maxTurns,
      context: { ...agent.context, ...config?.context },
    };

    // Simulate streaming chunks
    const chunks = [
      `[${agent.name}] `,
      `processing: `,
      `"${input}"`,
    ];

    for (const chunk of chunks) {
      await new Promise((r) => setTimeout(r, 5));
      yield chunk;
    }

    return {
      output: `[${agent.name}] processed: "${input}"`,
      turns: 1,
      tokenUsage: { prompt: 100, completion: 50, total: 150 },
      toolCalls: [],
    } as RunResult;
  }
}
