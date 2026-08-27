import { ProviderInterface } from '../provider-interface.js';
import {
  CompletionRequest,
  CompletionResponse,
  EmbeddingRequest,
  EmbeddingResponse,
  ProviderConfig,
  ProviderError,
  ProviderErrorCode,
  StreamEvent,
  ContentBlock,
  ToolCall,
  Message,
  TextBlock,
  ImageUrlBlock,
} from '../types.js';
import { ModelCapabilityRegistry } from '../model-capabilities.js';

/**
 * OpenAI-compatible provider.
 *
 * Covers OpenAI, Groq, Together AI, DeepSeek, xAI, Mistral, and any
 * endpoint speaking the OpenAI chat completions API shape.
 *
 * Embeddings are supported if the configured endpoint has an `/embeddings`
 * route (some local servers do, some don't — we let the 404 propagate).
 */
export class OpenAICompatibleProvider extends ProviderInterface {
  constructor(
    config: ProviderConfig,
    protected registry: ModelCapabilityRegistry,
  ) {
    super(config);
  }

  // ── Core completions ──────────────────────────────────────────────────

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    return this.withRetry(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeout ?? 60_000);

      try {
        const res = await fetch(this.resolveUrl('chat/completions'), {
          method: 'POST',
          headers: this.buildHeaders(),
          body: JSON.stringify(this.buildPayload(request)),
          signal: controller.signal,
        });

        if (!res.ok) {
          throw await this.parseError(res);
        }

        const json: any = await res.json();
        return this.parseResponse(json.code ?? json);
      } finally {
        clearTimeout(timeout);
      }
    });
  }

  async *completeStream(request: CompletionRequest): AsyncIterableIterator<StreamEvent> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeout ?? 60_000);

    try {
      const res = await fetch(this.resolveUrl('chat/completions'), {
        method: 'POST',
        headers: {
          ...this.buildHeaders(),
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({ ...this.buildPayload(request), stream: true }),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw await this.parseError(res);
      }

      const reader = res.body?.getReader();
      if (!reader) {
        throw new ProviderError(
          ProviderErrorCode.Internal,
          'Response body is null',
          undefined,
          false,
        );
      }

      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;

          if (trimmed === 'data: [DONE]') return;

          if (trimmed.startsWith('data: ')) {
            try {
              const data = JSON.parse(trimmed.slice(6));
              const parsed = this.parseStreamChunk(data);
              if (parsed) yield parsed;
            } catch {
              // Malformed chunk — skip
            }
          }
        }
      }

      yield { type: 'done', response: await this.buildEmptyResponse(request.model) };
    } finally {
      clearTimeout(timeout);
    }
  }

  // ── Embeddings ─────────────────────────────────────────────────────────

  async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    return this.withRetry(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeout ?? 60_000);

      try {
        const res = await fetch(this.resolveUrl('embeddings'), {
          method: 'POST',
          headers: this.buildHeaders(),
          body: JSON.stringify({
            model: request.model,
            input: request.input,
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          throw await this.parseError(res);
        }

        const json: any = await res.json();

        return {
          model: json.model ?? request.model,
          embeddings: json.data?.map((d: any) => d.embedding) ?? [],
          usage: {
            promptTokens: json.usage?.prompt_tokens ?? 0,
            completionTokens: 0,
            totalTokens: json.usage?.total_tokens ?? 0,
          },
        };
      } finally {
        clearTimeout(timeout);
      }
    });
  }

  // ── Model introspection ────────────────────────────────────────────────

  async listModels(): Promise<string[]> {
    if (this.config.models.length > 0) {
      return this.config.models;
    }

    // Try the /models endpoint
    try {
      const res = await fetch(this.resolveUrl('models'), {
        headers: this.buildHeaders(),
        signal: AbortSignal.timeout(10_000),
      });

      if (res.ok) {
        const json: any = await res.json();
        return json.data?.map((m: any) => m.id) ?? [];
      }
    } catch {
      // Fall through
    }

    return this.config.models;
  }

  async getModelCapabilities(model: string) {
    return this.registry.get(model, this.type);
  }

  // ── Internal helpers ───────────────────────────────────────────────────

  /** Build the JSON payload for the OpenAI API shape */
  protected buildPayload(request: CompletionRequest): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      model: request.model,
      messages: this.serializeMessages(request.messages),
    };

    if (request.maxTokens !== undefined) payload.max_tokens = request.maxTokens;
    if (request.temperature !== undefined) payload.temperature = request.temperature;
    if (request.topP !== undefined) payload.top_p = request.topP;
    if (request.stop !== undefined) payload.stop = request.stop;
    if (request.stream !== undefined) payload.stream = request.stream;
    if (request.jsonMode) payload.response_format = { type: 'json_object' };

    if (request.tools && request.tools.length > 0) {
      payload.tools = request.tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        },
      }));

      if (request.toolChoice) {
        payload.tool_choice = request.toolChoice;
      }
    }

    if (request.reasoningEffort) {
      payload.reasoning_effort = request.reasoningEffort;
    }

    if (request.extra) {
      Object.assign(payload, request.extra);
    }

    return payload;
  }

  /** Convert internal messages to OpenAI message format */
  protected serializeMessages(messages: Message[]): Record<string, unknown>[] {
    return messages.map((msg) => {
      const base: Record<string, unknown> = { role: msg.role };

      if (typeof msg.content === 'string') {
        base.content = msg.content;
      } else {
        // Multi-modal content array
        base.content = msg.content.map((block) => {
          switch (block.type) {
            case 'text': {
              const tb = block as TextBlock;
              return { type: 'text', text: tb.text };
            }
            case 'image_url': {
              const ib = block as ImageUrlBlock;
              return {
                type: 'image_url',
                image_url: {
                  url: ib.imageUrl,
                  detail: ib.detail ?? 'auto',
                },
              };
            }
            case 'tool_use': {
              const tb = block as any;
              return {
                type: 'tool_use',
                id: tb.id,
                function: { name: tb.name, arguments: JSON.stringify(tb.input) },
              };
            }
            case 'tool_result': {
              const tb = block as any;
              return {
                type: 'tool_result',
                tool_call_id: tb.toolUseId,
                content: tb.content,
              };
            }
            default:
              return { type: 'text', text: JSON.stringify(block) };
          }
        });
      }

      if (msg.name) base.name = msg.name;
      return base;
    });
  }

  /** Parse a non-streaming response from the OpenAI API */
  protected parseResponse(json: any): CompletionResponse {
    const choice = json.choices?.[0];
    const message = choice?.message ?? {};

    return {
      id: json.id ?? '',
      model: json.model ?? '',
      content: message.content ?? null,
      toolCalls: this.parseToolCalls(message.tool_calls),
      usage: {
        promptTokens: json.usage?.prompt_tokens ?? 0,
        completionTokens: json.usage?.completion_tokens ?? 0,
        totalTokens: json.usage?.total_tokens ?? 0,
      },
      finishReason: this.mapFinishReason(choice?.finish_reason),
      raw: json,
    };
  }

  /** Parse a streaming SSE chunk */
  protected parseStreamChunk(data: any): StreamEvent | null {
    const choice = data.choices?.[0];

    if (choice?.finish_reason) {
      return {
        type: 'done',
        response: {
          id: data.id ?? '',
          model: data.model ?? '',
          content: null,
          usage: {
            promptTokens: data.usage?.prompt_tokens ?? 0,
            completionTokens: data.usage?.completion_tokens ?? 0,
            totalTokens: data.usage?.total_tokens ?? 0,
          },
          finishReason: this.mapFinishReason(choice.finish_reason),
          raw: data,
        },
      };
    }

    const delta = choice?.delta ?? {};

    if (delta.tool_calls) {
      const tc = delta.tool_calls[0];
      if (tc?.function?.name) {
        return {
          type: 'tool_call_delta',
          id: tc.id ?? '',
          name: tc.function.name,
          input: tc.function.arguments ?? '',
        };
      }
    }

    if (delta.content) {
      return { type: 'delta', content: delta.content };
    }

    return null;
  }

  /** Build a minimal response for when streaming ends without a final chunk */
  protected async buildEmptyResponse(model: string): Promise<CompletionResponse> {
    return {
      id: '',
      model,
      content: null,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      finishReason: 'stop',
    };
  }

  /** Parse tool_calls from an OpenAI response message */
  protected parseToolCalls(toolCalls?: any[]): ToolCall[] | undefined {
    if (!toolCalls || toolCalls.length === 0) return undefined;

    return toolCalls.map((tc: any) => ({
      id: tc.id,
      name: tc.function?.name ?? 'unknown',
      input: (() => {
        try {
          return JSON.parse(tc.function?.arguments ?? '{}');
        } catch {
          return {};
        }
      })(),
    }));
  }

  /** Map OpenAI finish_reason to our enum */
  protected mapFinishReason(reason?: string): CompletionResponse['finishReason'] {
    switch (reason) {
      case 'stop':
        return 'stop';
      case 'length':
        return 'length';
      case 'tool_calls':
        return 'tool_calls';
      case 'content_filter':
        return 'content_filter';
      default:
        return 'stop';
    }
  }

  /** Parse an error response from the API */
  protected async parseError(res: Response): Promise<ProviderError> {
    let body: any;
    try {
      body = await res.json();
    } catch {
      body = { error: { message: res.statusText } };
    }

    const message = body?.error?.message ?? body?.error ?? res.statusText;
    const code = this.mapErrorCode(res.status, message);

    return new ProviderError(
      code,
      typeof message === 'string' ? message : JSON.stringify(message),
      res.status,
      code === ProviderErrorCode.RateLimited ||
        code === ProviderErrorCode.Timeout ||
        code === ProviderErrorCode.Network,
    );
  }

  /** Map HTTP status + message to our error codes */
  protected mapErrorCode(status: number, message: unknown): ProviderErrorCode {
    if (status === 401) return ProviderErrorCode.Authentication;
    if (status === 429) return ProviderErrorCode.RateLimited;
    if (status === 402) return ProviderErrorCode.QuotaExceeded;
    if (status === 404) return ProviderErrorCode.ModelNotFound;
    if (status === 503) return ProviderErrorCode.ModelUnavailable;
    if (status >= 500) return ProviderErrorCode.Internal;
    if (status === 400) {
      const msg = String(message).toLowerCase();
      if (msg.includes('context length') || msg.includes('maximum context'))
        return ProviderErrorCode.ContextTooLong;
      return ProviderErrorCode.BadRequest;
    }
    if (status === 408) return ProviderErrorCode.Timeout;
    return ProviderErrorCode.Internal;
  }
}
