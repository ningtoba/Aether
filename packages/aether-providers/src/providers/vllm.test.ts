import { describe, it, expect, beforeEach, vi } from "vitest";
import { VLLMProvider } from "./vllm.js";
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
    name: "vllm-test",
    provider: "vllm" as const,
    baseUrl: "http://localhost:8000/v1",
    models: [],
    ...overrides,
  };
}

function makeProvider(config?: ProviderConfig) {
  const registry = new ModelCapabilityRegistry();
  return new VLLMProvider(config ?? makeConfig(), registry);
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

describe("VLLMProvider", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("complete()", () => {
    it("should send a chat completion request and parse response", async () => {
      const provider = makeProvider();
      mockFetch({ ok: true, status: 200 }, {
        id: "cmpl-123",
        model: "mistralai/Mistral-7B-Instruct-v0.3",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Hello from vLLM!" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });

      const response = await provider.complete({
        model: "mistralai/Mistral-7B-Instruct-v0.3",
        messages: [{ role: "user", content: "Say hello" }],
      });

      expect(response.content).toBe("Hello from vLLM!");
      expect(response.usage.promptTokens).toBe(10);
      expect(response.finishReason).toBe("stop");
    });

    it("should handle JSON mode", async () => {
      const provider = makeProvider();
      mockFetch({ ok: true, status: 200 }, {
        id: "cmpl-456",
        model: "mistralai/Mistral-7B-Instruct-v0.3",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: '{"name": "John", "age": 30}',
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
      });

      const response = await provider.complete({
        model: "mistralai/Mistral-7B-Instruct-v0.3",
        messages: [{ role: "user", content: "Return JSON" }],
        jsonMode: true,
      });

      expect(response.content).toBe('{"name": "John", "age": 30}');
    });
  });

  describe("completeStream()", () => {
    it("should yield delta events", async () => {
      const provider = makeProvider();
      const chunks = [
        'data: {"id":"1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Stream"},"finish_reason":null}]}\n',
        'data: {"id":"1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"ing"},"finish_reason":null}]}\n',
        'data: {"id":"1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n',
        "data: [DONE]\n",
      ];
      mockFetchStream(chunks);

      const events: any[] = [];
      for await (const event of provider.completeStream({
        model: "mistralai/Mistral-7B-Instruct-v0.3",
        messages: [{ role: "user", content: "Hi" }],
        stream: true,
      })) {
        events.push(event);
      }

      expect(events.length).toBeGreaterThanOrEqual(2);
      expect(events[0]).toEqual({ type: "delta", content: "Stream" });
      expect(events[1]).toEqual({ type: "delta", content: "ing" });
    });
  });

  describe("embed()", () => {
    it("should send embeddings request and parse response", async () => {
      const provider = makeProvider();
      mockFetch({ ok: true, status: 200 }, {
        model: "BAAI/bge-base-en-v1.5",
        data: [
          { object: "embedding", embedding: [0.5, 0.6, 0.7], index: 0 },
        ],
        usage: { prompt_tokens: 4, total_tokens: 4 },
      });

      const response = await provider.embed({
        model: "BAAI/bge-base-en-v1.5",
        input: "test text",
      });

      expect(response.embeddings).toHaveLength(1);
      expect(response.embeddings[0]).toEqual([0.5, 0.6, 0.7]);
    });
  });

  describe("listModels()", () => {
    it("should return models from config if provided", async () => {
      const provider = makeProvider({
        ...makeConfig(),
        models: ["model-a", "model-b"],
      });
      const models = await provider.listModels();
      expect(models).toEqual(["model-a", "model-b"]);
    });

    it("should parse models from API response", async () => {
      const provider = makeProvider();
      mockFetch({ ok: true, status: 200 }, {
        data: [
          { id: "mistralai/Mistral-7B-Instruct-v0.3" },
          { id: "meta-llama/Llama-2-7b-chat-hf" },
        ],
      });

      const models = await provider.listModels();
      expect(models).toContain("mistralai/Mistral-7B-Instruct-v0.3");
      expect(models).toContain("meta-llama/Llama-2-7b-chat-hf");
    });
  });

  describe("error handling", () => {
    it("should handle rate limits", async () => {
      const provider = makeProvider();
      mockFetchError(429, { error: { message: "Rate limit exceeded" } });

      try {
        await provider.complete({
          model: "mistralai/Mistral-7B-Instruct-v0.3",
          messages: [{ role: "user", content: "test" }],
        });
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err).toBeInstanceOf(ProviderError);
        expect(err.code).toBe(ProviderErrorCode.RateLimited);
        expect(err.retryable).toBe(true);
      }
    });

    it("should handle context too long", async () => {
      const provider = makeProvider();
      mockFetchError(400, {
        error: { message: "This model's maximum context length is 32768 tokens" },
      });

      try {
        await provider.complete({
          model: "mistralai/Mistral-7B-Instruct-v0.3",
          messages: [{ role: "user", content: "test" }],
        });
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err).toBeInstanceOf(ProviderError);
        expect(err.code).toBe(ProviderErrorCode.ContextTooLong);
      }
    });
  });
});
