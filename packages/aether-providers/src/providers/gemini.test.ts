import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GeminiProvider } from './gemini.js';
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
    name: 'gemini-test',
    provider: 'gemini' as const,
    apiKey: 'AIzaSyTest123',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    models: [],
    ...overrides,
  };
}

function makeProvider(config?: ProviderConfig) {
  const registry = new ModelCapabilityRegistry();
  return new GeminiProvider(config ?? makeConfig(), registry);
}

describe('GeminiProvider URL building', () => {
  it('joins streaming query params and API key with & (no double ?)', () => {
    const provider = makeProvider(makeConfig({ apiKey: 'KEY123' }));
    const url = (
      provider as unknown as {
        resolveGeminiUrl: (m: string, a?: string, q?: string) => string;
      }
    ).resolveGeminiUrl('gemini-test-model', 'streamGenerateContent', 'sse');
    expect(url).toContain(':streamGenerateContent?alt=sse&key=KEY123');
    expect(url).not.toContain('?alt=sse?key=');
  });
});

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
    headers: new Headers({ 'Content-Type': 'text/event-stream' }),
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

describe('GeminiProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('complete()', () => {
    it('should send a generateContent request and parse response', async () => {
      const provider = makeProvider();
      mockFetch(
        { ok: true, status: 200 },
        {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [{ text: 'Hello from Gemini!' }],
              },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 5,
            totalTokenCount: 15,
          },
        },
      );

      const response = await provider.complete({
        model: 'gemini-2.5-pro',
        messages: [
          { role: 'system', content: 'Be helpful.' },
          { role: 'user', content: 'Say hello' },
        ],
      });

      expect(response.content).toBe('Hello from Gemini!');
      expect(response.usage.promptTokens).toBe(10);
      expect(response.usage.completionTokens).toBe(5);
      expect(response.finishReason).toBe('stop');

      // Verify URL contains the API key as query param
      const fetchCall = vi.mocked(fetch).mock.calls[0];
      const url = fetchCall[0] as string;
      expect(url).toContain(':generateContent');
      expect(url).toContain('key=AIzaSyTest123');

      // Verify system instruction is separate
      const body = JSON.parse((fetchCall[1] as RequestInit).body as string);
      expect(body.system_instruction).toBeDefined();
      expect(body.system_instruction.parts[0].text).toBe('Be helpful.');
      expect(body.contents[0].role).toBe('user');
    });
    it('maps toolChoice required to forced function calling (mode ANY)', async () => {
      const provider = makeProvider();
      mockFetch({ ok: true, status: 200 }, {
        candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
      } as never);
      await provider.complete({
        model: 'gemini-test-model',
        messages: [{ role: 'user', content: 'call a function' }],
        tools: [{ name: 'get_weather', description: 'weather', inputSchema: {} }],
        toolChoice: 'required',
      });
      const fetchCall = vi.mocked(fetch).mock.calls[0];
      const body = JSON.parse((fetchCall[1] as RequestInit).body as string);
      expect(body.tool_config.function_calling_config.mode).toBe('ANY');
    });

    it('should handle function call responses', async () => {
      const provider = makeProvider();
      mockFetch(
        { ok: true, status: 200 },
        {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [
                  {
                    functionCall: {
                      name: 'get_weather',
                      args: { location: 'Tokyo' },
                    },
                  },
                ],
              },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 5,
            totalTokenCount: 15,
          },
        },
      );

      const response = await provider.complete({
        model: 'gemini-2.5-pro',
        messages: [{ role: 'user', content: 'Weather?' }],
        tools: [
          {
            name: 'get_weather',
            description: 'Get weather',
            inputSchema: { type: 'object', properties: { location: { type: 'string' } } },
          },
        ],
      });

      expect(response.content).toBeNull();
      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls![0].name).toBe('get_weather');
      expect(response.toolCalls![0].input).toEqual({ location: 'Tokyo' });
    });

    it('should map SAFETY finish reason to content_filter', async () => {
      const provider = makeProvider();
      mockFetch(
        { ok: true, status: 200 },
        {
          candidates: [
            {
              content: { role: 'model', parts: [] },
              finishReason: 'SAFETY',
            },
          ],
          usageMetadata: {},
        },
      );

      const response = await provider.complete({
        model: 'gemini-2.5-pro',
        messages: [{ role: 'user', content: 'Harmful content' }],
      });

      expect(response.finishReason).toBe('content_filter');
    });

    it('should pass safety_settings from extra', async () => {
      const provider = makeProvider();
      mockFetch(
        { ok: true, status: 200 },
        {
          candidates: [
            { content: { role: 'model', parts: [{ text: 'OK' }] }, finishReason: 'STOP' },
          ],
          usageMetadata: {},
        },
      );

      await provider.complete({
        model: 'gemini-2.5-pro',
        messages: [{ role: 'user', content: 'Hello' }],
        extra: {
          safety_settings: [{ category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' }],
        },
      });

      const fetchCall = vi.mocked(fetch).mock.calls[0];
      const body = JSON.parse((fetchCall[1] as RequestInit).body as string);
      expect(body.safetySettings).toBeDefined();
      expect(body.safetySettings[0].category).toBe('HARM_CATEGORY_HARASSMENT');
    });
  });

  describe('completeStream()', () => {
    it('should yield delta events from streaming endpoint', async () => {
      const provider = makeProvider();
      const chunks = [
        'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Hello"}]}}]}\n',
        'data: {"candidates":[{"content":{"role":"model","parts":[{"text":" world"}]}}]}\n',
        'data: {"candidates":[{"content":{"role":"model","parts":[]},"finishReason":"STOP"}]}\n',
      ];
      mockFetchStream(chunks);

      const events: any[] = [];
      for await (const event of provider.completeStream({
        model: 'gemini-2.5-pro',
        messages: [{ role: 'user', content: 'Hi' }],
        stream: true,
      })) {
        events.push(event);
      }

      expect(events.length).toBeGreaterThanOrEqual(2);
      expect(events[0]).toEqual({ type: 'delta', content: 'Hello' });
      expect(events[1]).toEqual({ type: 'delta', content: ' world' });
    });

    it('should use streamGenerateContent endpoint', async () => {
      const provider = makeProvider();
      mockFetchStream([
        'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"OK"}]}}]}\n',
      ]);

      const events: any[] = [];
      for await (const event of provider.completeStream({
        model: 'gemini-2.5-pro',
        messages: [{ role: 'user', content: 'Hi' }],
        stream: true,
      })) {
        events.push(event);
      }

      const fetchCall = vi.mocked(fetch).mock.calls[0];
      const url = fetchCall[0] as string;
      expect(url).toContain('streamGenerateContent');
    });
  });

  describe('embed()', () => {
    it('should send embedContent request and parse response', async () => {
      const provider = makeProvider();
      mockFetch(
        { ok: true, status: 200 },
        {
          embedding: { values: [0.1, 0.2, 0.3] },
        },
      );

      const response = await provider.embed({
        model: 'text-embedding-004',
        input: 'test text',
      });

      expect(response.embeddings).toHaveLength(1);
      expect(response.embeddings[0]).toEqual([0.1, 0.2, 0.3]);
      expect(response.model).toBe('text-embedding-004');

      // Verify correct endpoint
      const fetchCall = vi.mocked(fetch).mock.calls[0];
      expect(fetchCall[0]).toContain(':embedContent');
    });
  });

  describe('listModels()', () => {
    it('should return models from config if provided', async () => {
      const provider = makeProvider({
        ...makeConfig(),
        models: ['gemini-2.5-pro', 'gemini-2.5-flash'],
      });
      const models = await provider.listModels();
      expect(models).toEqual(['gemini-2.5-pro', 'gemini-2.5-flash']);
    });

    it('should fetch models from Gemini API', async () => {
      const provider = makeProvider();
      mockFetch(
        { ok: true, status: 200 },
        {
          models: [{ name: 'models/gemini-2.5-pro' }, { name: 'models/gemini-2.5-flash' }],
        },
      );

      const models = await provider.listModels();
      expect(models).toContain('gemini-2.5-pro');
      expect(models).toContain('gemini-2.5-flash');
    });
  });

  describe('error handling', () => {
    it('should handle auth errors (401)', async () => {
      const provider = makeProvider();
      mockFetchError(403, {
        error: {
          message: 'API key not valid. Please pass a valid API key.',
          status: 'PERMISSION_DENIED',
        },
      });

      try {
        await provider.complete({
          model: 'gemini-2.5-pro',
          messages: [{ role: 'user', content: 'test' }],
        });
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err).toBeInstanceOf(ProviderError);
        expect(err.code).toBe(ProviderErrorCode.Authentication);
      }
    });

    it('should handle rate limits', async () => {
      const provider = makeProvider();
      mockFetchError(429, {
        error: { message: 'Rate limit exceeded', status: 'RESOURCE_EXHAUSTED' },
      });

      try {
        await provider.complete({
          model: 'gemini-2.5-pro',
          messages: [{ role: 'user', content: 'test' }],
        });
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err).toBeInstanceOf(ProviderError);
        expect(err.code).toBe(ProviderErrorCode.RateLimited);
        expect(err.retryable).toBe(true);
      }
    });

    it('should handle model not found', async () => {
      const provider = makeProvider();
      mockFetchError(404, {
        error: { message: "Model 'nonexistent' not found", status: 'NOT_FOUND' },
      });

      try {
        await provider.complete({
          model: 'nonexistent',
          messages: [{ role: 'user', content: 'test' }],
        });
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err).toBeInstanceOf(ProviderError);
        expect(err.code).toBe(ProviderErrorCode.ModelNotFound);
      }
    });
  });
});
describe('GeminiProvider tool-loop serialization', () => {
  it('emits functionCall and functionResponse parts on the wire', async () => {
    const provider = makeProvider();
    mockFetch({ ok: true, status: 200 }, {
      candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
    } as never);

    await provider.complete({
      model: 'gemini-test-model',
      messages: [
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'call_9', name: 'get_weather', input: { city: 'SF' } }],
        },
        { role: 'tool', content: '"sunny"', name: 'get_weather', toolCallId: 'call_9' },
      ],
    });

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse((fetchCall[1] as RequestInit).body as string);

    expect(body.contents[0].role).toBe('model');
    expect(body.contents[0].parts).toEqual([
      { functionCall: { name: 'get_weather', args: { city: 'SF' } } },
    ]);

    expect(body.contents[1].role).toBe('function');
    expect(body.contents[1].parts).toEqual([
      { functionResponse: { name: 'get_weather', response: { output: '"sunny"' } } },
    ]);
  });
});
