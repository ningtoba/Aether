/**
 * AetherAgent wrapping the OpenAI Agents SDK Agent class, plus
 * AetherRunner that uses the SDK's Runner with AetherModelProvider.
 *
 * @module @aether/sdk
 */

import { ToolRegistry } from './tools.js';
import type { AgentConfig, RunConfig, RunResult, OutputSchema } from './types.js';
import type { ProviderInterface } from '@aether/providers';
import { withTimeout } from '@aether/utils';

/** Minimal provider registry interface */
export interface ProviderRegistry {
  get: (name: string) => Promise<ProviderInterface>;
  has: (name: string) => boolean;
  list: () => string[];
}

import {
  Agent as SdkAgent,
  Runner as SdkRunner,
  handoff,
  sdkTool,
  type Tool,
} from './internal-types.js';
import { AetherModelProvider } from './model-provider.js';

// ── AetherAgent ───────────────────────────────────────────────────────

export class AetherAgent {
  readonly name: string;
  readonly instructions: string;
  readonly model: string;
  readonly tools: ToolRegistry;
  readonly handoffs: string[];
  readonly outputType?: string;
  readonly outputSchema?: OutputSchema;
  readonly guardrails: string[];
  readonly maxTurns: number;
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

  toSdkAgent(handoffAgents?: Map<string, AetherAgent>): InstanceType<typeof SdkAgent> {
    const tools = this.buildTools();

    const config: Record<string, unknown> = {
      name: this.name,
      instructions: this.instructions,
      model: this.model,
      tools,
      maxTurns: this.maxTurns,
    };

    // Structured output
    if (this.outputSchema) {
      config.outputType = this.outputSchema.jsonSchema;
      config.outputSchemaName = this.outputSchema.name;
    }

    // Handoffs
    if (handoffAgents && this.handoffs.length > 0) {
      const handoffs: ReturnType<typeof handoff>[] = [];
      for (const targetName of this.handoffs) {
        const target = handoffAgents.get(targetName);
        if (target) {
          handoffs.push(handoff(target.toSdkAgent(handoffAgents)));
        }
      }
      if (handoffs.length > 0) {
        config.handoffs = handoffs;
      }
    }

    return new SdkAgent(config as ConstructorParameters<typeof SdkAgent>[0]);
  }

  private buildTools(): Tool[] {
    return (
      this.tools
        .list()
        // A disabled tool must not be exposed to the model.
        .filter((toolDef) => toolDef.enabled !== false)
        .map((toolDef) => {
          return sdkTool({
            name: toolDef.name,
            description: toolDef.description,
            parameters: toolDef.parameters as Record<string, unknown>,
            execute: async (args: unknown) => {
              if (!toolDef.handler) {
                return `[tool: ${toolDef.name}] no handler registered`;
              }
              try {
                const run = Promise.resolve(toolDef.handler(args));
                // Honor the per-tool timeout so a hung handler cannot hang
                // the whole agent run.
                const result =
                  toolDef.timeout !== undefined
                    ? await withTimeout(run, toolDef.timeout, `Tool "${toolDef.name}" timed out`)
                    : await run;
                return typeof result === 'string' ? result : JSON.stringify(result);
              } catch (err) {
                return `[tool: ${toolDef.name}] error: ${err instanceof Error ? err.message : String(err)}`;
              }
            },
          } as Parameters<typeof sdkTool>[0]);
        })
    );
  }

  toString(): string {
    return `AetherAgent("${this.name}", model="${this.model}", tools=${this.tools.list().length})`;
  }

  toJSON(): AgentConfig {
    return {
      name: this.name,
      instructions: this.instructions,
      model: this.model,
      tools: this.tools.list().map((t) => ({
        id: undefined,
        name: t.name,
        description: t.description,
        parameters: t.parameters,
        enabled: t.enabled ?? true,
        timeout: t.timeout ?? 30000,
        sandboxed: t.sandboxed ?? false,
      })),
      handoffs: this.handoffs,
      outputType: this.outputType,
      guardrails: this.guardrails,
      maxTurns: this.maxTurns,
      context: { ...this.context },
    };
  }
}

// ── AetherRunner ──────────────────────────────────────────────────────

export interface AetherRunnerOptions {
  providerRegistry: ProviderRegistry;
  providerName?: string;
  defaultModel?: string;
  maxTurns?: number;
  tracingDisabled?: boolean;
}

export class AetherRunner {
  private readonly runner: InstanceType<typeof SdkRunner>;
  private readonly modelProvider: AetherModelProvider;
  private readonly options: Required<AetherRunnerOptions>;

  constructor(options: AetherRunnerOptions) {
    this.options = {
      maxTurns: 10,
      tracingDisabled: true,
      providerName: 'default',
      defaultModel: 'gpt-4o',
      ...options,
    };

    this.modelProvider = new AetherModelProvider(
      this.options.providerRegistry,
      this.options.providerName,
      this.options.defaultModel,
    );

    this.runner = new SdkRunner({
      modelProvider: this.modelProvider,
      tracingDisabled: this.options.tracingDisabled,
    } as ConstructorParameters<typeof SdkRunner>[0]);
  }

  async run(agent: AetherAgent, input: string, config?: Partial<RunConfig>): Promise<RunResult> {
    const sdkAgent = agent.toSdkAgent();

    const result = await this.runner.run(sdkAgent as any, input, {
      maxTurns: config?.maxTurns ?? agent.maxTurns,
    });

    return this.toRunResult(result);
  }

  async runWithAgents(
    primaryAgent: AetherAgent,
    input: string,
    agents: AetherAgent[],
    config?: Partial<RunConfig>,
  ): Promise<RunResult> {
    const agentMap = new Map<string, AetherAgent>();
    for (const a of agents) {
      agentMap.set(a.name, a);
    }

    const sdkAgent = primaryAgent.toSdkAgent(agentMap);

    const result = await this.runner.run(sdkAgent as any, input, {
      maxTurns: config?.maxTurns ?? primaryAgent.maxTurns,
    });

    return this.toRunResult(result);
  }

  private toRunResult(result: unknown): RunResult {
    const r = result as Record<string, unknown>;

    // The OpenAI Agents SDK result exposes finalOutput/newItems/rawResponses —
    // there is no top-level `turns` or `usage`. Derive the Aether contract from
    // what the result actually carries so real runs report real numbers.
    const rawResponses = (Array.isArray(r.rawResponses) ? r.rawResponses : []) as Array<{
      usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
    }>;
    const newItems = Array.isArray(r.newItems) ? (r.newItems as unknown[]) : [];

    const prompt = rawResponses.reduce((sum, resp) => sum + (resp.usage?.inputTokens ?? 0), 0);
    const completion = rawResponses.reduce((sum, resp) => sum + (resp.usage?.outputTokens ?? 0), 0);
    const total = rawResponses.reduce((sum, resp) => sum + (resp.usage?.totalTokens ?? 0), 0);

    // Each model call is one turn.
    const turns = rawResponses.length;

    // { type: 'function_call', name, arguments } items carry the tool use.
    const toolCalls: RunResult['toolCalls'] = newItems
      .filter((item): item is { name: string; arguments: string } => {
        if (typeof item !== 'object' || item === null) return false;
        return 'type' in item && item.type === 'function_call';
      })
      .map((item) => {
        let args: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(item.arguments || '{}') as unknown;
          args = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
        } catch {
          args = {};
        }
        return { name: item.name, args };
      });

    return {
      output: String(r.finalOutput ?? r.output ?? ''),
      turns,
      tokenUsage: { prompt, completion, total },
      toolCalls,
    };
  }
}
