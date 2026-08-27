import type { FunctionCallItem, FunctionCallResultItem } from '@openai/agents';
import type { CompletionResponse, ProviderInterface } from '@aether/providers';
import { AetherModel, AetherModelProvider } from './model-provider.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @aether/providers
vi.mock('@aether/providers', () => ({}));

// Mock internal-types
vi.mock('./internal-types.js', () => ({
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

describe('AetherModelProvider', () => {
  const mockProvider: ProviderInterface = {
    complete: vi.fn().mockResolvedValue({
      id: 'resp-1',
      content: 'Hello from mock',
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      toolCalls: [],
    }),
    completeStream: vi.fn(),
  } as any;

  const mockProviderRegistry = {
    get: vi.fn().mockResolvedValue(mockProvider),
    has: vi.fn().mockReturnValue(true),
    list: vi.fn().mockReturnValue(['default']),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create with default model name', () => {
    const provider = new AetherModelProvider(mockProviderRegistry);
    expect(provider.defaultModel).toBe('gpt-4o');
  });

  it('should create with custom default model', () => {
    const provider = new AetherModelProvider(mockProviderRegistry, 'default', 'claude-3-5-sonnet');
    expect(provider.defaultModel).toBe('claude-3-5-sonnet');
  });

  it('should get a model by name', async () => {
    const provider = new AetherModelProvider(mockProviderRegistry);
    const model = await provider.getModel('gpt-4o');
    expect(model).toBeDefined();
    expect(mockProviderRegistry.get).toHaveBeenCalledWith('default');
  });

  it('should use default model when no name given', async () => {
    const provider = new AetherModelProvider(mockProviderRegistry);
    const model = await provider.getModel();
    expect(model).toBeDefined();
  });

  it('should throw when provider is not registered', async () => {
    const emptyRegistry = {
      get: vi.fn(),
      has: vi.fn().mockReturnValue(false),
      list: vi.fn().mockReturnValue([]),
    };
    const provider = new AetherModelProvider(emptyRegistry);

    await expect(provider.getModel('test')).rejects.toThrow('not registered');
  });
});

describe('AetherModel', () => {
  const mockProvider: ProviderInterface = {
    complete: vi.fn().mockResolvedValue({
      id: 'resp-123',
      content: 'Mock response content',
      usage: { promptTokens: 5, completionTokens: 15, totalTokens: 20 },
      toolCalls: [],
    }),
    completeStream: vi.fn(),
  } as any;

  it('threads tool_call_id through a sequential tool loop (real SDK item types)', async () => {
    const model = new (AetherModel as any)(mockProvider, 'gpt-4o');
    const call: FunctionCallItem = {
      type: 'function_call',
      callId: 'call_1',
      name: 'get_weather',
      arguments: '{"city":"SF"}',
    };
    const result: FunctionCallResultItem = {
      type: 'function_call_result',
      callId: 'call_1',
      name: 'get_weather',
      status: 'completed',
      output: '72',
    };
    const request = {
      input: [
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'weather?' }] },
        call,
        result,
      ],
      tools: [],
      modelSettings: {},
    };
    await model.getResponse(request);

    const providerRequest = (mockProvider.complete as any).mock.calls[0][0];
    const messages = providerRequest.messages as Array<Record<string, unknown>>;
    // The assistant call is a structured tool_calls entry, not a text placeholder.
    const assistant = messages.find((m) => (m as any).role === 'assistant');
    expect((assistant as any).toolCalls).toEqual([
      { id: 'call_1', name: 'get_weather', input: { city: 'SF' } },
    ]);
    // The result carries the id of the call it answers.
    const tool = messages.find((m) => (m as any).role === 'tool');
    expect((tool as any).toolCallId).toBe('call_1');
    expect((tool as any).content).toBe('72');
  });

  it('should suggest retry for transient provider errors (429/5xx/timeout)', () => {
    const model = new (AetherModel as any)(mockProvider, 'gpt-4o');
    const advice = model.getRetryAdvice({
      request: { input: 'test', tools: [] },
      error: Object.assign(new Error('rate limit'), { statusCode: 429 }),
      stream: false,
      attempt: 1,
    });
    expect(advice).toBeDefined();
    expect(advice.suggested).toBe(true);
    expect(advice.retryAfterMs).toBeGreaterThan(0);
  });

  it('should not suggest retry for permanent errors (400/auth)', () => {
    const model = new (AetherModel as any)(mockProvider, 'gpt-4o');
    const advice = model.getRetryAdvice({
      request: { input: 'test', tools: [] },
      error: Object.assign(new Error('bad request'), { statusCode: 400 }),
      stream: false,
      attempt: 1,
    });
    expect(advice).toBeUndefined();
  });

  it('should not retry after max attempts', () => {
    const model = new (AetherModel as any)(mockProvider, 'gpt-4o');
    const advice = model.getRetryAdvice({
      request: { input: 'test', tools: [] },
      error: new Error('persistent error'),
      stream: false,
      attempt: 3,
    });
    expect(advice).toBeUndefined();
  });
});
