import { describe, it, expect, beforeEach, vi } from "vitest";
import { LlamaCppProvider } from "./llamacpp.js";
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
    name: "llamacpp-test",
    provider: "llamacpp" as const,
    baseUrl: "http://localhost:8080/v1",
    models: [],
    ...overrides,
  };
}

function makeProvider(config?: ProviderConfig) {
  const registry = new ModelCapabilityRegistry();
  return new LlamaCppProvider(config ?? makeConfig(), registry);
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

describe("LlamaCppProvider", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("complete() - chat endpoint", () => {
    it("should use /v1/chat/completions for role-based messages", async () => {
      const provider = makeProvider();
      mockFetch({ ok: true, status: 200 }, {
        id: "chatcmpl-123",
        model: "llama-3.2-3b",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Hello from llama.cpp!" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });

      const response = await provider.complete({
        model: "llama-3.2-3b",
        messages: [
          { role: "system", content: "Be helpful." },
          { role: "user", content: "Say hello" },
        ],
      });

      expect(response.content).toBe("Hello from llama.cpp!");
      expect(response.usage.promptTokens).toBe(10);
      expect(response.finishReason).toBe("stop");

      // Verify correct endpoint
      const fetchCall = vi.mocked(fetch).mock.calls[0];
      expect(fetchCall[0]).toContain("/v1/chat/completions");
    });

    it("should parse tool calls", async () => {
      const provider = makeProvider();
      mockFetch({ ok: true, status: 200 }, {
        id: "chatcmpl-456",
        model: "llama-3.2-3b",
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
        usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
      });

      const response = await provider.complete({
        model: "llama-3.2-3b",
        messages: [{ role: "user", content: "Weather?" }],
        tools: [
          {
            name: "get_weather",
            description: "Get weather",
            inputSchema: { type: "object", properties: { location: { type: "string" } } },
          },
        ],
      });

      expect(response.content).toBeNull();
      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls![0].name).toBe("get_weather");
      expect(response.finishReason).toBe("tool_calls");
    });
  });

  describe("complete() - completions endpoint", () => {
    it("should use /v1/completions when extra forces it", async () => {
      const provider = makeProvider();
      mockFetch({ ok: true, status: 200 }, {
        id: "cmpl-789",
        model: "llama-3.2-3b",
        choices: [
          {
            index: 0,
            text: "The answer is 42.",
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
      });

      const response = await provider.complete({
        model: "llama-3.2-3b",
        messages: [{ role: "user", content: "What is the answer?" }],
        extra: { use_completion_endpoint: true },
      });

      expect(response.content).toBe("The answer is 42.");

      // Verify correct endpoint
      const fetchCall = vi.mocked(fetch).mock.calls[0];
      expect(fetchCall[0]).toContain("/v1/completions");
    });

    it("should pass concatenated prompt to completions endpoint", async () => {
      const provider = makeProvider();
      mockFetch({ ok: true, status: 200 }, {
        id: "cmpl-101",
        model: "llama-3.2-3b",
        choices: [{ index: 0, text: "Response", finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
      });

      await provider.complete({
        model: "llama-3.2-3b",
        messages: [
          { role: "system", content: "Be helpful." },
          { role: "user", content: "Hello" },
        ],
        extra: { use_completion_endpoint: true },
      });

      const fetchCall = vi.mocked(fetch).mock.calls[0];
      const body = JSON.parse((fetchCall[1] as RequestInit).body as string);
      expect(body.prompt).toContain("system: Be helpful.");
      expect(body.prompt).toContain("user: Hello");
      expect(body.messages).toBeUndefined();
    });
  });

  describe("completeStream()", () => {
    it("should yield delta events from chat endpoint", async () => {
      const provider = makeProvider();
      const chunks = [
        'data: {"id":"1","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}\n',
        'data: {"id":"1","choices":[{"index":0,"delta":{"content":" world"},"finish_reason":null}]}\n',
        'data: {"id":"1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n',
        "data: [DONE]\n",
      ];
      mockFetchStream(chunks);

      const events: any[] = [];
      for await (const event of provider.completeStream({
        model: "llama-3.2-3b",
        messages: [{ role: "user", content: "Hi" }],
        stream: true,
      })) {
        events.push(event);
      }

      expect(events[0]).toEqual({ type: "delta", content: "Hello" });
      expect(events[1]).toEqual({ type: "delta", content: " world" });
    });

    it("should yield text from completion endpoint", async () => {
      const provider = makeProvider();
      const chunks = [
        'data: {"id":"1","choices":[{"index":0,"text":"Once","finish_reason":null}]}\n',
        'data: {"id":"1","choices":[{"index":0,"text":" upon","finish_reason":null}]}\n',
        'data: {"id":"1","choices":[{"index":0,"text":" a time","finish_reason":null}]}\n',
        'data: {"id":"1","choices":[{"index":0,"text":"","finish_reason":"stop"}]}\n',
        "data: [DONE]\n",
      ];
      mockFetchStream(chunks);

      const events: any[] = [];
      for await (const event of provider.completeStream({
        model: "llama-3.2-3b",
        messages: [{ role: "user", content: "Story?" }],
        stream: true,
        extra: { use_completion_endpoint: true },
      })) {
        events.push(event);
      }

      expect(events[0]).toEqual({ type: "delta", content: "Once" });
      expect(events[1]).toEqual({ type: "delta", content: " upon" });
      expect(events[2]).toEqual({ type: "delta", content: " a time" });
    });
  });

  describe("embed()", () => {
    it("should send embeddings request and parse response", async () => {
      const provider = makeProvider();
      mockFetch({ ok: true, status: 200 }, {
        model: "llama-3.2-3b",
        data: [
          { object: "embedding", embedding: [0.1, 0.2, 0.3], index: 0 },
        ],
        usage: { prompt_tokens: 5, total_tokens: 5 },
      });

      const response = await provider.embed({
        model: "llama-3.2-3b",
        input: "test",
      });

      expect(response.embeddings).toHaveLength(1);
      expect(response.embeddings[0]).toEqual([0.1, 0.2, 0.3]);
    });
  });

  describe("listModels()", () => {
    it("should return models from config if provided", async () => {
      const provider = makeProvider({
        ...makeConfig(),
        models: ["llama-3.2-3b", "mistral-7b"],
      });
      const models = await provider.listModels();
      expect(models).toEqual(["llama-3.2-3b", "mistral-7b"]);
    });

    it("should fetch models from API", async () => {
      const provider = makeProvider();
      mockFetch({ ok: true, status: 200 }, {
        data: [
          { id: "llama-3.2-3b" },
          { id: "llama-2-7b" },
        ],
      });

      const models = await provider.listModels();
      expect(models).toContain("llama-3.2-3b");
      expect(models).toContain("llama-2-7b");
    });
  });

  describe("error handling", () => {
    it("should handle auth errors", async () => {
      const provider = makeProvider({
        ...makeConfig(),
        apiKey: "wrong-key",
      });
      mockFetchError(401, { error: { message: "Unauthorized" } });

      try {
        await provider.complete({
          model: "llama-3.2-3b",
          messages: [{ role: "user", content: "test" }],
        });
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err).toBeInstanceOf(ProviderError);
        expect(err.code).toBe(ProviderErrorCode.Authentication);
      }
    });

    it("should handle timeout", async () => {
      const provider = makeProvider();
      mockFetchError(408, { error: { message: "Request timeout" } });

      try {
        await provider.complete({
          model: "llama-3.2-3b",
          messages: [{ role: "user", content: "test" }],
        });
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err).toBeInstanceOf(ProviderError);
        expect(err.code).toBe(ProviderErrorCode.Timeout);
        expect(err.retryable).toBe(true);
      }
    });
  });
});
