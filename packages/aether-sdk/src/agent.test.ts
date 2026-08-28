import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AetherAgent, AetherRunner } from './agent.js';
import type { AgentConfig, ToolDefinition } from './types.js';

// Mock internal-types (the @openai/agents dependency)
vi.mock('./internal-types.js', () => ({
  Agent: class MockSdkAgent {
    constructor(config: any) {
      (this as any)._config = config;
    }
  },
  Runner: class MockSdkRunner {
    constructor(config: any) {
      (this as any)._config = config;
    }
    async run(_agent: any, _input: string, _opts?: any) {
      return {
        finalOutput: 'Mock response',
        rawResponses: [
          { usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 }, output: [] },
        ],
        newItems: [{ type: 'message', role: 'assistant', content: [] }],
      };
    }
  },
  handoff: vi.fn((_agent: any) => ({ type: 'handoff', agent: { _config: { name: 'mock' } } })),
  tool: vi.fn((def: any) => ({ type: 'sdk_tool', ...def })),
  sdkTool: vi.fn((def: any) => ({ type: 'sdk_tool', ...def })),
  Usage: class {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    constructor(opts: any) {
      this.inputTokens = opts.inputTokens;
      this.outputTokens = opts.outputTokens;
      this.totalTokens = opts.totalTokens;
    }
  },
}));

describe('AetherAgent', () => {
  const createSampleConfig = (): AgentConfig => ({
    name: 'test-agent',
    model: 'gpt-4o',
    instructions: 'You are a test agent',
    tools: [
      {
        id: undefined,
        name: 'get_weather',
        description: 'Get weather',
        parameters: { type: 'object', properties: { location: { type: 'string' } } },
        enabled: true,
        timeout: 30000,
        sandboxed: false,
      },
    ],
    handoffs: [],
    outputType: undefined,
    guardrails: [],
    maxTurns: 10,
    context: { sessionId: 'sess-1' },
  });

  it('should create an agent with the given config', () => {
    const config = createSampleConfig();
    const agent = new AetherAgent(config);

    expect(agent.name).toBe('test-agent');
    expect(agent.model).toBe('gpt-4o');
    expect(agent.instructions).toBe('You are a test agent');
    expect(agent.handoffs).toEqual([]);
    expect(agent.maxTurns).toBe(10);
    expect(agent.context).toEqual({ sessionId: 'sess-1' });
  });

  it('should register tools from config', () => {
    const config = createSampleConfig();
    const agent = new AetherAgent(config);

    const tools = agent.tools.list();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('get_weather');
  });

  it('should handle empty tools array', () => {
    const config = { ...createSampleConfig(), tools: [] };
    const agent = new AetherAgent(config);
    expect(agent.tools.list()).toHaveLength(0);
  });

  it('should provide a string representation', () => {
    const agent = new AetherAgent(createSampleConfig());
    const str = agent.toString();
    expect(str).toContain('test-agent');
    expect(str).toContain('gpt-4o');
    expect(str).toContain('tools=1');
  });

  it('should convert to JSON config', () => {
    const config = createSampleConfig();
    const agent = new AetherAgent(config);
    const json = agent.toJSON();

    expect(json.name).toBe('test-agent');
    expect(json.model).toBe('gpt-4o');
    expect(json.tools).toHaveLength(1);
    expect(json.context!.sessionId).toBe('sess-1');
  });

  it('should convert to SDK agent via toSdkAgent', () => {
    const agent = new AetherAgent(createSampleConfig());
    const sdkAgent = agent.toSdkAgent();

    expect(sdkAgent).toBeDefined();
    expect((sdkAgent as any)._config.name).toBe('test-agent');
  });

  it('should handle handoffs in toSdkAgent', () => {
    const config: AgentConfig = {
      name: 'primary',
      model: 'gpt-4o',
      instructions: 'Primary agent',
      tools: [],
      handoffs: ['secondary'],
      outputType: undefined,
      guardrails: [],
      maxTurns: 10,
    };
    const primary = new AetherAgent(config);
    const secondary = new AetherAgent({
      name: 'secondary',
      model: 'gpt-4o',
      instructions: 'Secondary agent',
      tools: [],
      handoffs: [],
      outputType: undefined,
      guardrails: [],
      maxTurns: 10,
    });

    const handoffMap = new Map();
    handoffMap.set('secondary', secondary);
    const sdkAgent = primary.toSdkAgent(handoffMap);

    expect(sdkAgent).toBeDefined();
  });
});

describe('AetherRunner', () => {
  const mockProviderRegistry = {
    get: vi.fn(),
    has: vi.fn(),
    list: vi.fn().mockReturnValue(['default']),
  };

  it('should create a runner with default options', () => {
    const runner = new AetherRunner({
      providerRegistry: mockProviderRegistry,
    });
    expect(runner).toBeDefined();
  });

  it('should create a runner with custom options', () => {
    const runner = new AetherRunner({
      providerRegistry: mockProviderRegistry,
      providerName: 'custom',
      defaultModel: 'claude-3-5-sonnet',
      maxTurns: 20,
      tracingDisabled: false,
    });
    expect(runner).toBeDefined();
  });

  it('should run an agent and return a result', async () => {
    const runner = new AetherRunner({
      providerRegistry: mockProviderRegistry,
    });
    const agent = new AetherAgent({
      name: 'test',
      model: 'gpt-4o',
      instructions: 'Test',
      tools: [],
      handoffs: [],
      outputType: undefined,
      guardrails: [],
      maxTurns: 5,
    });

    const result = await runner.run(agent, 'Hello');

    expect(result).toBeDefined();
    expect(result.output).toBe('Mock response');
    expect(result.turns).toBe(1);
    expect(result.tokenUsage.total).toBe(150);
  });

  it('should run with multiple agents via runWithAgents', async () => {
    const runner = new AetherRunner({
      providerRegistry: mockProviderRegistry,
    });
    const primary = new AetherAgent({
      name: 'primary',
      model: 'gpt-4o',
      instructions: 'Primary',
      tools: [],
      handoffs: ['helper'],
      outputType: undefined,
      guardrails: [],
      maxTurns: 5,
    });
    const helper = new AetherAgent({
      name: 'helper',
      model: 'gpt-4o',
      instructions: 'Helper',
      tools: [],
      handoffs: [],
      outputType: undefined,
      guardrails: [],
      maxTurns: 5,
    });

    const result = await runner.runWithAgents(primary, 'Help me', [helper]);
    expect(result).toBeDefined();
    expect(result.output).toBe('Mock response');
  });
});
describe('AetherRunner result mapping (real SDK shape)', () => {
  const mockProviderRegistry = {
    get: vi.fn(),
    has: vi.fn(),
    list: vi.fn().mockReturnValue(['default']),
  };

  it('derives turns, token usage and tool calls from rawResponses/newItems', async () => {
    const runner = new AetherRunner({
      providerRegistry: mockProviderRegistry,
    });
    const agent = new AetherAgent({
      name: 'map',
      model: 'gpt-4o',
      instructions: 'Map',
      tools: [],
      handoffs: [],
      outputType: undefined,
      guardrails: [],
      maxTurns: 5,
    });

    // The SDK run result carries no top-level `turns`/`usage`; it exposes
    // finalOutput, one rawResponses entry per model call, and newItems that
    // include { type: 'function_call' } items for tool use.
    vi.spyOn((runner as any).runner, 'run').mockResolvedValue({
      finalOutput: '42',
      rawResponses: [
        { usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, output: [] },
        { usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 }, output: [] },
      ],
      newItems: [
        // Real SDK RunItems are class wrappers; the protocol item sits at
        // `.rawItem` as a plain { type: 'function_call', callId, name,
        // arguments } entry.
        {
          type: 'tool_call_item',
          rawItem: {
            type: 'function_call',
            callId: 'call_1',
            name: 'get_weather',
            arguments: '{"city":"SF"}',
          },
        },
        {
          type: 'tool_call_result_item',
          rawItem: { type: 'function_call_result', callId: 'call_1', output: '"sunny"' },
        },
        { type: 'message_item', rawItem: { type: 'message', role: 'assistant', content: [] } },
      ],
    });

    const result = await runner.run(agent, 'what is the weather?');

    expect(result.output).toBe('42');
    expect(result.turns).toBe(2);
    expect(result.tokenUsage).toEqual({ prompt: 30, completion: 15, total: 45 });
    expect(result.toolCalls).toEqual([{ name: 'get_weather', args: { city: 'SF' } }]);
  });

  it('reports zero turns and an empty tool list when nothing ran', async () => {
    const runner = new AetherRunner({
      providerRegistry: mockProviderRegistry,
    });
    const agent = new AetherAgent({
      name: 'empty',
      model: 'gpt-4o',
      instructions: 'Empty',
      tools: [],
      handoffs: [],
      outputType: undefined,
      guardrails: [],
      maxTurns: 5,
    });

    vi.spyOn((runner as any).runner, 'run').mockResolvedValue({
      finalOutput: undefined,
      rawResponses: [],
      newItems: [],
    });

    const result = await runner.run(agent, 'noop');
    expect(result.output).toBe('');
    expect(result.turns).toBe(0);
    expect(result.toolCalls).toEqual([]);
    expect(result.tokenUsage).toEqual({ prompt: 0, completion: 0, total: 0 });
  });
  it('stringifies an object finalOutput instead of emitting [object Object]', async () => {
    const runner = new AetherRunner({ providerRegistry: mockProviderRegistry });
    const agent = new AetherAgent({
      name: 'obj',
      model: 'gpt-4o',
      instructions: 'Obj',
      tools: [],
      handoffs: [],
      outputType: undefined,
      guardrails: [],
      maxTurns: 5,
    });

    vi.spyOn((runner as any).runner, 'run').mockResolvedValue({
      finalOutput: { result: 'ok', count: 2 },
      rawResponses: [],
      newItems: [],
    });

    const result = await runner.run(agent, 'x');
    expect(result.output).toBe('{"result":"ok","count":2}');
  });
});
describe('AetherAgent tool metadata handoff', () => {
  it('does not expose disabled tools to the SDK agent', () => {
    const agent = new AetherAgent({
      name: 't',
      model: 'gpt-4o',
      instructions: 'T',
      tools: [],
      handoffs: [],
      outputType: undefined,
      guardrails: [],
      maxTurns: 5,
    });
    agent.tools.register({
      name: 'disabled_tool',
      description: 'd',
      parameters: {},
      enabled: false,
    });
    agent.tools.register({
      name: 'enabled_tool',
      description: 'd',
      parameters: {},
      enabled: true,
      timeout: 500,
      handler: async () => 'ok',
    });

    const sdk = agent.toSdkAgent();
    const names = ((sdk as any)._config.tools as { name: string }[]).map((t) => t.name);
    expect(names).toContain('enabled_tool');
    expect(names).not.toContain('disabled_tool');
  });

  it('enforces the per-tool handler timeout', async () => {
    const agent = new AetherAgent({
      name: 't2',
      model: 'gpt-4o',
      instructions: 'T',
      tools: [],
      handoffs: [],
      outputType: undefined,
      guardrails: [],
      maxTurns: 5,
    });
    agent.tools.register({
      name: 'slow',
      description: 'd',
      parameters: {},
      enabled: true,
      timeout: 20,
      handler: () => new Promise(() => {}), // never settles
    });

    const sdk = agent.toSdkAgent();
    const tool = (
      (sdk as any)._config.tools as {
        name: string;
        execute: (a: unknown) => Promise<string | undefined>;
      }[]
    ).find((t) => t.name === 'slow');
    const result = await tool!.execute({});
    expect(result).toContain('timed out');
  });
});
describe('context injection', () => {
  const baseConfig = (): AgentConfig => ({
    name: 'ctx',
    model: 'gpt-4o',
    instructions: 'You are a test agent',
    tools: [],
    handoffs: [],
    guardrails: [],
    maxTurns: 5,
  });

  it('merges agent-level context into the model instructions', () => {
    const agent = new AetherAgent({
      ...baseConfig(),
      context: { domain: 'finance', language: 'en' },
    });
    const sdk = agent.toSdkAgent() as unknown as { _config: { instructions: string } };
    expect(sdk._config.instructions).toContain('"domain":"finance"');
    expect(sdk._config.instructions).toContain('"language":"en"');
    expect(sdk._config.instructions).toContain('You are a test agent');
  });

  it('leaves instructions untouched when no context is set', () => {
    const agent = new AetherAgent(baseConfig());
    const sdk = agent.toSdkAgent() as unknown as { _config: { instructions: string } };
    expect(sdk._config.instructions).toBe('You are a test agent');
  });
});
