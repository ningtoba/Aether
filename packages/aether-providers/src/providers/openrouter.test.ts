import { describe, it, expect, beforeEach, vi } from "vitest";
import { OpenRouterProvider } from "./openrouter.js";
import { ModelCapabilityRegistry } from "../model-capabilities.js";
import {
  ProviderConfig,
  ProviderError,
  ProviderErrorCode,
  CompletionRequest,
  EmbeddingRequest,
} from "../types.js";

function makeConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    name: "openrouter-test",
    provider: "openrouter" as const,
    apiKey: "sk-or-test123",
    baseUrl: "https://openrouter.ai/api/v1",
    models: [],
    extra: {
      "HTTP-Referer": "https://example.com",
      "X-Title": "Aether Test",
    },
    ...overrides,
  };
}

function makeProvider(config?: ProviderConfig) {
  const registry = new ModelCapabilityRegistry();
  return new OpenRouterProvider(config ?? makeConfig(), registry);
}

function mockFetch(response: Partial<Response>, body?: unknown): void {
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: response.ok ?? true,
    status: response.status ?? 200,
    statusText: response.statusText ?? "OK",
    headers: new Headers({ "Content-Type": "application/json" }),
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
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    headers: new Headers({ "Content-Type": "text/event-stream" }),
    body: stream,
    json: async () => ({}),
  } as unknown as Response);
}

function mockFetchError(status: number, body: unknown): void {
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: false,
    status,
    statusText: "Error",
    headers: new Headers({ "Content-Type": "application/json" }),
    json: async () => body,
    text: async () => JSON.stringify(body),
    body: null,
  } as Response);
}

describe("OpenRouterProvider", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("complete()", () => {
    it("should send a completion request with OpenRouter headers", async () => {
      const provider = makeProvider();
      mockFetch({ ok: true, status: 200 }, {
        id: "chatcmpl-123",
        model: "openai/gpt-4o",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Hello from OpenRouter!" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });

      const request: CompletionRequest = {
        model: "openai/gpt-4o",
        messages: [{ role: "user", content: "Say hello" }],
      };

      const response = await provider.complete(request);

      expect(response.content).toBe("Hello from OpenRouter!");
      expect(response.model).toBe("openai/gpt-4o");
      expect(response.usage.promptTokens).toBe(10);
      expect(response.usage.completionTokens).toBe(5);
      expect(response.finishReason).toBe("stop");

      // Verify OpenRouter-specific headers
      const fetchCall = vi.mocked(fetch).mock.calls[0];
      const opts = fetchCall[1] as RequestInit;
      const headers = opts.headers as Record<string, string>;
      expect(headers["HTTP-Referer"]).toBe("https://example.com");
      expect(headers["X-Title"]).toBe("Aether Test");
      expect(headers["Authorization"]).toBe("Bearer sk-or-test123");
    });

    it("should parse tool calls", async () => {
      const provider = makeProvider();
      mockFetch({ ok: true, status: 200 }, {
        id: "chatcmpl-456",
        model: "openai/gpt-4o",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "get_weather",
                    arguments: '{"location":"NYC"}',
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });

      const request: CompletionRequest = {
        model: "openai/gpt-4o",
        messages: [{ role: "user", content: "Weather?" }],
        tools: [
          {
            name: "get_weather",
            description: "Get weather",
            inputSchema: { type: "object", properties: { location: { type: "string" } } },
          },
        ],
      };

      const response = await provider.complete(request);
      expect(response.content).toBeNull();
      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls![0].name).toBe("get_weather");
      expect(response.toolCalls![0].input).toEqual({ location: "NYC" });
      expect(response.finishReason).toBe("tool_calls");
    });
  });

  describe("completeStream()", () => {
    it("should yield delta events", async () => {
      const provider = makeProvider();
      const chunks = [
        'data: {"id":"1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}\n',
        'data: {"id":"1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":" world"},"finish_reason":null}]}\n',
        'data: {"id":"1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n',
        "data: [DONE]\n",
      ];
      mockFetchStream(chunks);

      const request: CompletionRequest = {
        model: "openai/gpt-4o",
        messages: [{ role: "user", content: "Hi" }],
        stream: true,
      };

      const events: any[] = [];
      for await (const event of provider.completeStream(request)) {
        events.push(event);
      }

      expect(events.length).toBeGreaterThanOrEqual(2);
      expect(events[0]).toEqual({ type: "delta", content: "Hello" });
      expect(events[1]).toEqual({ type: "delta", content: " world" });
    });
  });

  describe("embed()", () => {
    it("should send an embeddings request and parse response", async () => {
      const provider = makeProvider();
      mockFetch({ ok: true, status: 200 }, {
        model: "text-embedding-3-small",
        data: [
          { object: "embedding", embedding: [0.1, 0.2, 0.3], index: 0 },
        ],
        usage: { prompt_tokens: 3, total_tokens: 3 },
      });

      const response = await provider.embed({
        model: "text-embedding-3-small",
        input: "test",
      });

      expect(response.embeddings).toHaveLength(1);
      expect(response.embeddings[0]).toEqual([0.1, 0.2, 0.3]);
      expect(response.model).toBe("text-embedding-3-small");
    });
  });

  describe("listModels()", () => {
    it("should return models from config if provided", async () => {
      const provider = makeProvider({
        ...makeConfig(),
        models: ["openai/gpt-4o", "anthropic/claude-sonnet-4"],
      });
      const models = await provider.listModels();
      expect(models).toHaveLength(2);
    });

    it("should fetch models from API when config is empty", async () => {
      const provider = makeProvider();
      mockFetch({ ok: true, status: 200 }, {
        data: [
          { id: "openai/gpt-4o" },
          { id: "anthropic/claude-sonnet-4" },
          { id: "google/gemini-2.5-pro" },
        ],
      });
      const models = await provider.listModels();
      expect(models).toContain("openai/gpt-4o");
      expect(models).toContain("anthropic/claude-sonnet-4");
    });
  });

  describe("error handling", () => {
    it("should handle 401 auth errors", async () => {
      const provider = makeProvider();
      mockFetchError(401, {
        error: { message: "Invalid API key" },
      });

      try {
        await provider.complete({
          model: "openai/gpt-4o",
          messages: [{ role: "user", content: "test" }],
        });
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err).toBeInstanceOf(ProviderError);
        expect(err.code).toBe(ProviderErrorCode.Authentication);
      }
    });

    it("should handle rate limits", async () => {
      const provider = makeProvider();
      mockFetchError(429, {
        error: { message: "Rate limit exceeded" },
      });

      try {
        await provider.complete({
          model: "openai/gpt-4o",
          messages: [{ role: "user", content: "test" }],
        });
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err).toBeInstanceOf(ProviderError);
        expect(err.code).toBe(ProviderErrorCode.RateLimited);
        expect(err.retryable).toBe(true);
      }
    });
  });
});
