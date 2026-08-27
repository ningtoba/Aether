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

      expect(events.length).toBeGreaterThanOrEqual(2);
      // First event should be tool_call_delta from content_block_start
      // or from the partial JSON delta
      const toolDeltas = events.filter((e) => e.type === 'tool_call_delta');
      expect(toolDeltas.length).toBeGreaterThanOrEqual(1);
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
