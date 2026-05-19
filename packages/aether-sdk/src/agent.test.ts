import { describe, it, expect, vi, beforeEach } from "vitest";
import { AetherAgent, AetherRunner } from "./agent.js";
import type { AgentConfig, ToolDefinition } from "./types.js";

// Mock internal-types (the @openai/agents dependency)
vi.mock("./internal-types.js", () => ({
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
        finalOutput: "Mock response",
        turns: 5,
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      };
    }
  },
  handoff: vi.fn((_agent: any) => ({ type: "handoff", agent: { _config: { name: "mock" } } })),
  tool: vi.fn((def: any) => ({ type: "sdk_tool", ...def })),
  sdkTool: vi.fn((def: any) => ({ type: "sdk_tool", ...def })),
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

describe("AetherAgent", () => {
  const createSampleConfig = (): AgentConfig => ({
    name: "test-agent",
    model: "gpt-4o",
    instructions: "You are a test agent",
    tools: [
      {
        id: undefined,
        name: "get_weather",
        description: "Get weather",
        parameters: { type: "object", properties: { location: { type: "string" } } },
        enabled: true,
        timeout: 30000,
        sandboxed: false,
      },
    ],
    handoffs: [],
    outputType: undefined,
    guardrails: [],
    maxTurns: 10,
    context: { sessionId: "sess-1" },
  });

  it("should create an agent with the given config", () => {
    const config = createSampleConfig();
    const agent = new AetherAgent(config);

    expect(agent.name).toBe("test-agent");
    expect(agent.model).toBe("gpt-4o");
    expect(agent.instructions).toBe("You are a test agent");
    expect(agent.handoffs).toEqual([]);
    expect(agent.maxTurns).toBe(10);
    expect(agent.context).toEqual({ sessionId: "sess-1" });
  });

  it("should register tools from config", () => {
    const config = createSampleConfig();
    const agent = new AetherAgent(config);

    const tools = agent.tools.list();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("get_weather");
  });

  it("should handle empty tools array", () => {
    const config = { ...createSampleConfig(), tools: [] };
    const agent = new AetherAgent(config);
    expect(agent.tools.list()).toHaveLength(0);
  });

  it("should provide a string representation", () => {
    const agent = new AetherAgent(createSampleConfig());
    const str = agent.toString();
    expect(str).toContain("test-agent");
    expect(str).toContain("gpt-4o");
    expect(str).toContain("tools=1");
  });

  it("should convert to JSON config", () => {
    const config = createSampleConfig();
    const agent = new AetherAgent(config);
    const json = agent.toJSON();

    expect(json.name).toBe("test-agent");
    expect(json.model).toBe("gpt-4o");
    expect(json.tools).toHaveLength(1);
    expect(json.context!.sessionId).toBe("sess-1");
  });

  it("should convert to SDK agent via toSdkAgent", () => {
    const agent = new AetherAgent(createSampleConfig());
    const sdkAgent = agent.toSdkAgent();

    expect(sdkAgent).toBeDefined();
    expect((sdkAgent as any)._config.name).toBe("test-agent");
  });

  it("should handle handoffs in toSdkAgent", () => {
    const config: AgentConfig = {
      name: "primary",
      model: "gpt-4o",
      instructions: "Primary agent",
      tools: [],
      handoffs: ["secondary"],
      outputType: undefined,
      guardrails: [],
      maxTurns: 10,
    };
    const primary = new AetherAgent(config);
    const secondary = new AetherAgent({
      name: "secondary",
      model: "gpt-4o",
      instructions: "Secondary agent",
      tools: [],
      handoffs: [],
      outputType: undefined,
      guardrails: [],
      maxTurns: 10,
    });

    const handoffMap = new Map();
    handoffMap.set("secondary", secondary);
    const sdkAgent = primary.toSdkAgent(handoffMap);

    expect(sdkAgent).toBeDefined();
  });
});

describe("AetherRunner", () => {
  const mockProviderRegistry = {
    get: vi.fn(),
    has: vi.fn(),
    list: vi.fn().mockReturnValue(["default"]),
  };

  it("should create a runner with default options", () => {
    const runner = new AetherRunner({
      providerRegistry: mockProviderRegistry,
    });
    expect(runner).toBeDefined();
  });

  it("should create a runner with custom options", () => {
    const runner = new AetherRunner({
      providerRegistry: mockProviderRegistry,
      providerName: "custom",
      defaultModel: "claude-3-5-sonnet",
      maxTurns: 20,
      tracingDisabled: false,
    });
    expect(runner).toBeDefined();
  });

  it("should run an agent and return a result", async () => {
    const runner = new AetherRunner({
      providerRegistry: mockProviderRegistry,
    });
    const agent = new AetherAgent({
      name: "test",
      model: "gpt-4o",
      instructions: "Test",
      tools: [],
      handoffs: [],
      outputType: undefined,
      guardrails: [],
      maxTurns: 5,
    });

    const result = await runner.run(agent, "Hello");

    expect(result).toBeDefined();
    expect(result.output).toBe("Mock response");
    expect(result.turns).toBe(5);
    expect(result.tokenUsage.total).toBe(150);
  });

  it("should run with multiple agents via runWithAgents", async () => {
    const runner = new AetherRunner({
      providerRegistry: mockProviderRegistry,
    });
    const primary = new AetherAgent({
      name: "primary",
      model: "gpt-4o",
      instructions: "Primary",
      tools: [],
      handoffs: ["helper"],
      outputType: undefined,
      guardrails: [],
      maxTurns: 5,
    });
    const helper = new AetherAgent({
      name: "helper",
      model: "gpt-4o",
      instructions: "Helper",
      tools: [],
      handoffs: [],
      outputType: undefined,
      guardrails: [],
      maxTurns: 5,
    });

    const result = await runner.runWithAgents(primary, "Help me", [helper]);
    expect(result).toBeDefined();
    expect(result.output).toBe("Mock response");
  });
});
