import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AnthropicProvider } from './anthropic.js';
import { ModelCapabilityRegistry } from '../model-capabilities.js';
import {
  ProviderConfig,
  ProviderError,
  ProviderErrorCode,
  CompletionRequest,
  EmbeddingRequest,
} from '../types.js';

function makeConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    name: 'anthropic-test',
    provider: 'anthropic' as const,
    apiKey: 'sk-ant-test123',
    baseUrl: 'https://api.anthropic.com/v1',
    models: [],
    ...overrides,
  };
}

function makeProvider(config?: ProviderConfig) {
  const registry = new ModelCapabilityRegistry();
  const provider = new AnthropicProvider(config ?? makeConfig(), registry);
  return provider;
}

// ── Helpers for mocking fetch ─────────────────────────────────────────

function mockFetch(response: Partial<Response>, body?: unknown): void {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: response.ok ?? true,
    status: response.status ?? 200,
    statusText: response.statusText ?? 'OK',
    headers: new Headers({ 'Content-Type': 'application/json' }),
    json: async () => body ?? {},
    text: async () => JSON.stringify(body ?? {}),
    body: null,
    ...response,
  } as Response);
}

function mockFetchStream(chunks: string[]): void {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({
      'Content-Type': 'text/event-stream',
    }),
    body: stream,
    json: async () => ({}),
  } as unknown as Response);
}

function mockFetchError(status: number, body: unknown): void {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: false,
    status,
    statusText: 'Error',
    headers: new Headers({ 'Content-Type': 'application/json' }),
    json: async () => body,
    text: async () => JSON.stringify(body),
    body: null,
  } as Response);
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('AnthropicProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('complete()', () => {
    it('should send a completion request and parse the response', async () => {
      const provider = makeProvider();
      const mockResponse = {
        id: 'msg_123',
        model: 'claude-sonnet-4-20250514',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello from Claude!' }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 5 },
      };

      mockFetch({ ok: true, status: 200 }, mockResponse);

      const request: CompletionRequest = {
        model: 'claude-sonnet-4-20250514',
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Say hello' },
        ],
        maxTokens: 100,
      };

      const response = await provider.complete(request);

      expect(response.id).toBe('msg_123');
      expect(response.content).toBe('Hello from Claude!');
      expect(response.usage.promptTokens).toBe(10);
      expect(response.usage.completionTokens).toBe(5);
      expect(response.finishReason).toBe('stop');

      // Verify correct URL and headers
      const fetchCall = vi.mocked(fetch).mock.calls[0];
      const [url, opts] = fetchCall;
      expect(url).toContain('/v1/messages');
      expect((opts as RequestInit).headers).toHaveProperty('x-api-key');
      expect((opts as RequestInit).headers).not.toHaveProperty('Authorization');

      // Verify system message is in top-level field
      const body = JSON.parse((opts as RequestInit).body as string);
      expect(body.system).toBe('You are helpful.');
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0].role).toBe('user');
    });
    it('maps toolChoice required to forced tool use ({ type: "any" })', async () => {
      const provider = makeProvider();
      mockFetch(
        { ok: true, status: 200 },
        {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: 'claude-sonnet-4-20250514',
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      );
      await provider.complete({
        model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'call a function' }],
        tools: [{ name: 'get_weather', description: 'weather', inputSchema: {} }],
        toolChoice: 'required',
      });
      const fetchCall = vi.mocked(fetch).mock.calls[0];
      const body = JSON.parse((fetchCall[1] as RequestInit).body as string);
      expect(body.tool_choice).toEqual({ type: 'any' });
    });

    it('should handle tool_use responses', async () => {
      const provider = makeProvider();
      const mockResponse = {
        id: 'msg_456',
        model: 'claude-sonnet-4-20250514',
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_123',
            name: 'get_weather',
            input: { location: 'San Francisco' },
          },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 15, output_tokens: 8 },
      };

      mockFetch({ ok: true, status: 200 }, mockResponse);

      const request: CompletionRequest = {
        model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: "What's the weather?" }],
        tools: [
          {
            name: 'get_weather',
            description: 'Get weather for a location',
            inputSchema: {
              type: 'object',
              properties: { location: { type: 'string' } },
            },
          },
        ],
      };

      const response = await provider.complete(request);

      expect(response.content).toBeNull();
      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls![0].name).toBe('get_weather');
      expect(response.toolCalls![0].input).toEqual({ location: 'San Francisco' });
      expect(response.finishReason).toBe('tool_calls');
    });

    it('should map end_turn to stop', async () => {
      const provider = makeProvider();
      mockFetch(
        { ok: true, status: 200 },
        {
          id: 'msg_1',
          model: 'claude-sonnet-4-20250514',
          content: [{ type: 'text', text: 'Hi' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      );

      const response = await provider.complete({
        model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'Hi' }],
      });

      expect(response.finishReason).toBe('stop');
    });

    it('should map max_tokens to length', async () => {
      const provider = makeProvider();
      mockFetch(
        { ok: true, status: 200 },
        {
          id: 'msg_2',
          model: 'claude-sonnet-4-20250514',
          content: [{ type: 'text', text: 'Partial' }],
          stop_reason: 'max_tokens',
          usage: { input_tokens: 1, output_tokens: 100 },
        },
      );

      const response = await provider.complete({
        model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'Write a long essay' }],
        maxTokens: 100,
      });

      expect(response.finishReason).toBe('length');
    });
  });

  describe('completeStream()', () => {
    it('should yield delta events from content_block_delta', async () => {
      const provider = makeProvider();
      const chunks = [
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}\n',
        'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":3}}\n',
      ];
      mockFetchStream(chunks);

      const request: CompletionRequest = {
        model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'Say hi' }],
        stream: true,
      };

      const events: any[] = [];
      for await (const event of provider.completeStream(request)) {
        events.push(event);
      }

      expect(events).toHaveLength(3);
      expect(events[0]).toEqual({ type: 'delta', content: 'Hello' });
      expect(events[1]).toEqual({ type: 'delta', content: ' world' });
      expect(events[2].type).toBe('done');
      expect(events[2].response.finishReason).toBe('stop');
    });

    it('should yield tool_call_delta from content_block_start', async () => {
      const provider = makeProvider();
      const chunks = [
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"get_weather","input":{}}}\n',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"location\\":\\"SF\\"}"}}\n',
        'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":10}}\n',
      ];
      mockFetchStream(chunks);

      const request: CompletionRequest = {
        model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'Weather?' }],
        stream: true,
      };

      const events: any[] = [];
      for await (const event of provider.completeStream(request)) {
        events.push(event);
      }

      // The assembled tool call arrives in the final done event.
      const done = events.find((e) => e.type === 'done');
      expect(done).toBeDefined();
      expect(done.response.content).toBeNull();
      expect(done.response.toolCalls).toEqual([
        { id: 'toolu_1', name: 'get_weather', input: { location: 'SF' } },
      ]);
      expect(done.response.finishReason).toBe('tool_calls');
    });
  });

  describe('embed()', () => {
    it('should throw ProviderError since Anthropic has no embeddings', async () => {
      const provider = makeProvider();
      const request: EmbeddingRequest = {
        model: 'claude-sonnet-4-20250514',
        input: 'test',
      };

      await expect(provider.embed(request)).rejects.toThrow(ProviderError);
      await expect(provider.embed(request)).rejects.toThrow(
        'Anthropic does not support embeddings',
      );
    });
  });

  describe('listModels()', () => {
    it('should return models from config if provided', async () => {
      const provider = makeProvider({
        ...makeConfig(),
        models: ['claude-sonnet-4', 'claude-haiku-3-5'],
      });
      const models = await provider.listModels();
      expect(models).toEqual(['claude-sonnet-4', 'claude-haiku-3-5']);
    });

    it('should return filtered models from registry when no config models', async () => {
      const provider = makeProvider();
      const models = await provider.listModels();
      expect(models.length).toBeGreaterThan(0);
      expect(models.every((m) => m.startsWith('claude'))).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should handle 401 auth errors', async () => {
      const provider = makeProvider();
      mockFetchError(401, {
        error: { type: 'authentication_error', message: 'Invalid API key' },
      });

      try {
        await provider.complete({
          model: 'claude-sonnet-4-20250514',
          messages: [{ role: 'user', content: 'test' }],
        });
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err).toBeInstanceOf(ProviderError);
        expect(err.code).toBe(ProviderErrorCode.Authentication);
      }
    });

    it('should handle 429 rate limit errors', async () => {
      const provider = makeProvider();
      mockFetchError(429, {
        error: { type: 'rate_limit_error', message: 'Too many requests' },
      });

      try {
        await provider.complete({
          model: 'claude-sonnet-4-20250514',
          messages: [{ role: 'user', content: 'test' }],
        });
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err).toBeInstanceOf(ProviderError);
        expect(err.code).toBe(ProviderErrorCode.RateLimited);
        expect(err.retryable).toBe(true);
      }
    });
  });
});
describe('AnthropicProvider tool-loop serialization', () => {
  it('emits tool_use blocks and tool_result with tool_use_id on the wire', async () => {
    const provider = makeProvider();
    mockFetch(
      { ok: true, status: 200 },
      {
        id: 'msg_tool',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-4-20250514',
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    );

    await provider.complete({
      model: 'claude-sonnet-4-20250514',
      messages: [
        {
          role: 'assistant',
          content: 'thinking',
          toolCalls: [{ id: 'call_9', name: 'get_weather', input: { city: 'SF' } }],
        },
        { role: 'tool', content: '"sunny"', name: 'get_weather', toolCallId: 'call_9' },
      ],
    });

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse((fetchCall[1] as RequestInit).body as string);

    expect(body.messages[0].role).toBe('assistant');
    expect(body.messages[0].content[0]).toEqual({ type: 'text', text: 'thinking' });
    expect(body.messages[0].content[1]).toEqual({
      type: 'tool_use',
      id: 'call_9',
      name: 'get_weather',
      input: { city: 'SF' },
    });

    expect(body.messages[1].role).toBe('user');
    expect(body.messages[1].content[0]).toEqual({
      type: 'tool_result',
      tool_use_id: 'call_9',
      content: '"sunny"',
    });
  });
});
describe('AnthropicProvider streamed tool calls', () => {
  it('assembles streamed tool_use fragments into the final done event', async () => {
    const provider = makeProvider();
    const sse = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;
    const chunks = [
      `event: message_start\n${sse({ type: 'message_start', message: { id: 'msg_1', model: 'claude-x' } })}`,
      `event: content_block_start\n${sse({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: {} } })}`,
      `event: content_block_delta\n${sse({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"city":"SF"}' } })}`,
      `event: content_block_delta\n${sse({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'done' } })}`,
      `event: message_delta\n${sse({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 7 } })}`,
      `event: message_stop\n${sse({ type: 'message_stop' })}`,
    ];
    mockFetchStream(chunks);

    const events: any[] = [];
    for await (const event of provider.completeStream({
      model: 'claude-x',
      messages: [{ role: 'user', content: 'weather?' }],
    })) {
      events.push(event);
    }

    const done = events.find((e) => e.type === 'done');
    expect(done).toBeDefined();
    expect(done.response.id).toBe('msg_1');
    expect(done.response.content).toBe('done');
    expect(done.response.toolCalls).toEqual([
      { id: 'toolu_1', name: 'get_weather', input: { city: 'SF' } },
    ]);
    expect(done.response.finishReason).toBe('tool_calls');
  });
});
describe('AnthropicProvider mid-stream errors', () => {
  it('surfaces a provider error event instead of a success-looking done', async () => {
    const provider = makeProvider();
    const sse = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;
    const chunks = [
      `event: message_start\n${sse({ type: 'message_start', message: { id: 'msg_1', model: 'claude-x' } })}`,
      `event: content_block_delta\n${sse({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'partial ' } })}`,
      `event: error\n${sse({ type: 'error', error: { type: 'overloaded_error', message: 'overloaded' } })}`,
      `event: message_stop\n${sse({ type: 'message_stop' })}`,
    ];
    mockFetchStream(chunks);

    const events: any[] = [];
    for await (const event of provider.completeStream({
      model: 'claude-x',
      messages: [{ role: 'user', content: 'hi' }],
    })) {
      events.push(event);
    }

    const err = events.find((e) => e.type === 'error');
    expect(err).toBeDefined();
    expect(err.error.message).toContain('overloaded');
    // After an error the stream must NOT continue to a success-looking done.
    expect(events.some((e) => e.type === 'done')).toBe(false);
  });
});
