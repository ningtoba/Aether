import { describe, it, expect, beforeEach, vi } from "vitest";
import { OllamaProvider } from "./ollama.js";
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
    name: "ollama-test",
    provider: "ollama" as const,
    baseUrl: "http://localhost:11434/v1",
    models: [],
    ...overrides,
  };
}

function makeProvider(config?: ProviderConfig) {
  const registry = new ModelCapabilityRegistry();
  return new OllamaProvider(config ?? makeConfig(), registry);
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

describe("OllamaProvider", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("complete()", () => {
    it("should send a chat completion request and parse response", async () => {
      const provider = makeProvider();
      mockFetch({ ok: true, status: 200 }, {
        id: "chatcmpl-123",
        model: "llama3.2",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Hello from Llama!" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });

      const response = await provider.complete({
        model: "llama3.2",
        messages: [{ role: "user", content: "Say hello" }],
      });

      expect(response.content).toBe("Hello from Llama!");
      expect(response.model).toBe("llama3.2");
      expect(response.usage.promptTokens).toBe(10);
      expect(response.finishReason).toBe("stop");
    });

    it("should pass Ollama options in extra", async () => {
      const provider = makeProvider();
      mockFetch({ ok: true, status: 200 }, {
        id: "chatcmpl-456",
        model: "llama3.2",
        choices: [{ index: 0, message: { role: "assistant", content: "Hello" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });

      await provider.complete({
        model: "llama3.2",
        messages: [{ role: "user", content: "Hi" }],
        extra: { num_ctx: 4096, temperature: 0.7 },
      });

      const fetchCall = vi.mocked(fetch).mock.calls[0];
      const body = JSON.parse((fetchCall[1] as RequestInit).body as string);
      expect(body.model).toBe("llama3.2");
      expect(body.messages).toHaveLength(1);
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

      const events: any[] = [];
      for await (const event of provider.completeStream({
        model: "llama3.2",
        messages: [{ role: "user", content: "Hi" }],
        stream: true,
      })) {
        events.push(event);
      }

      expect(events.length).toBeGreaterThanOrEqual(2);
      expect(events[0]).toEqual({ type: "delta", content: "Hello" });
      expect(events[1]).toEqual({ type: "delta", content: " world" });
    });
  });

  describe("embed()", () => {
    it("should use /api/embed endpoint", async () => {
      const provider = makeProvider();
      mockFetch({ ok: true, status: 200 }, {
        model: "llama3.2",
        embeddings: [[0.1, 0.2, 0.3]],
        prompt_eval_count: 5,
      });

      const response = await provider.embed({
        model: "llama3.2",
        input: "test text",
      });

      expect(response.embeddings).toHaveLength(1);
      expect(response.embeddings[0]).toEqual([0.1, 0.2, 0.3]);
      expect(response.usage.promptTokens).toBe(5);

      // Verify it hit /api/embed, not /v1/embeddings
      const fetchCall = vi.mocked(fetch).mock.calls[0];
      expect(fetchCall[0]).toContain("/api/embed");
    });
  });

  describe("listModels()", () => {
    it("should try /v1/models first, then /api/tags", async () => {
      const provider = makeProvider();

      // First call fails (v1/models), second succeeds (api/tags)
      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: "Not Found",
          json: async () => ({}),
          text: async () => "{}",
          headers: new Headers(),
          body: null,
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ models: [{ name: "llama3.2" }, { name: "mistral" }] }),
          text: async () => JSON.stringify({ models: [{ name: "llama3.2" }, { name: "mistral" }] }),
          headers: new Headers({ "Content-Type": "application/json" }),
          body: null,
        } as Response);

      const models = await provider.listModels();
      expect(models).toContain("llama3.2");
      expect(models).toContain("mistral");
    });

    it("should return config models if provided", async () => {
      const provider = makeProvider({
        ...makeConfig(),
        models: ["llama3.2", "mistral"],
      });
      const models = await provider.listModels();
      expect(models).toEqual(["llama3.2", "mistral"]);
    });
  });

  describe("error handling", () => {
    it("should handle auth errors", async () => {
      const provider = makeProvider({
        ...makeConfig(),
        apiKey: "wrong-key",
        baseUrl: "http://localhost:11434/v1",
      });
      mockFetchError(401, { error: { message: "Unauthorized" } });

      try {
        await provider.complete({
          model: "llama3.2",
          messages: [{ role: "user", content: "test" }],
        });
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err).toBeInstanceOf(ProviderError);
        expect(err.code).toBe(ProviderErrorCode.Authentication);
      }
    });

    it("should handle model not found", async () => {
      const provider = makeProvider();
      mockFetchError(404, { error: { message: "model \"nonexistent\" not found" } });

      try {
        await provider.complete({
          model: "nonexistent",
          messages: [{ role: "user", content: "test" }],
        });
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err).toBeInstanceOf(ProviderError);
        expect(err.code).toBe(ProviderErrorCode.ModelNotFound);
      }
    });
  });
});
