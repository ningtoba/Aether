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
} from '../types.js';
import { ModelCapabilityRegistry } from '../model-capabilities.js';

/**
 * OpenRouter provider.
 *
 * OpenRouter speaks the OpenAI chat completions API at /v1/chat/completions
 * and /v1/models. Key differences from plain OpenAI:
 *  - Requires extra headers: HTTP-Referer (your site URL) and X-Title (app name)
 *  - The /v1/models endpoint returns models from many providers, filtered
 *    by the requesting app
 *
 * This implementation extends OpenAI-compatible patterns with these
 * OpenRouter-specific customizations.
 */
export class OpenRouterProvider extends ProviderInterface {
  constructor(
    config: ProviderConfig,
    protected registry: ModelCapabilityRegistry,
  ) {
    super(config);
  }

  // ── Core completions ────────────────────────────────────────────────

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    return this.withRetry(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeout ?? 60_000);

      try {
        const res = await fetch(this.resolveUrl('chat/completions'), {
          method: 'POST',
          headers: this.buildHeadersWithExtra(),
          body: JSON.stringify(this.buildPayload(request)),
          signal: controller.signal,
        });

        if (!res.ok) {
          throw await this.parseError(res);
        }

        const json: any = await res.json();
        return this.parseResponse(json);
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
          ...this.buildHeadersWithExtra(),
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

  // ── Embeddings ───────────────────────────────────────────────────────

  async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    return this.withRetry(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeout ?? 60_000);

      try {
        const res = await fetch(this.resolveUrl('embeddings'), {
          method: 'POST',
          headers: this.buildHeadersWithExtra(),
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

  // ── Model introspection ──────────────────────────────────────────────

  async listModels(): Promise<string[]> {
    if (this.config.models.length > 0) {
      return this.config.models;
    }

    try {
      const res = await fetch(this.resolveUrl('models'), {
        headers: this.buildHeadersWithExtra(),
        signal: AbortSignal.timeout(10_000),
      });

      if (res.ok) {
        const json: any = await res.json();
        // OpenRouter /v1/models returns { data: [{ id, name, ... }] }
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

  // ── Internal helpers ─────────────────────────────────────────────────

  /** Build headers that include OpenRouter-specific metadata headers */
  protected buildHeadersWithExtra(): Record<string, string> {
    const headers = this.buildHeaders();

    // OpenRouter-specific headers from config.extra
    if (this.config.extra) {
      if (typeof this.config.extra['HTTP-Referer'] === 'string') {
        headers['HTTP-Referer'] = this.config.extra['HTTP-Referer'];
      }
      if (typeof this.config.extra['X-Title'] === 'string') {
        headers['X-Title'] = this.config.extra['X-Title'];
      }
    }

    return headers;
  }

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

    // Pass through any OpenRouter-specific extra params
    if (request.extra) {
      // Don't pass through the headers as payload params
      const payloadExtra = { ...request.extra };
      delete (payloadExtra as any)['HTTP-Referer'];
      delete (payloadExtra as any)['X-Title'];
      Object.assign(payload, payloadExtra);
    }

    return payload;
  }

  protected serializeMessages(messages: any[]): Record<string, unknown>[] {
    return messages.map((msg) => {
      const base: Record<string, unknown> = { role: msg.role };

      if (typeof msg.content === 'string') {
        base.content = msg.content;
      } else if (Array.isArray(msg.content)) {
        base.content = msg.content.map((block: any) => {
          switch (block.type) {
            case 'text':
              return { type: 'text', text: block.text };
            case 'image_url':
              return {
                type: 'image_url',
                image_url: { url: block.imageUrl, detail: block.detail ?? 'auto' },
              };
            case 'tool_use':
              return {
                type: 'tool_use',
                id: block.id,
                function: { name: block.name, arguments: JSON.stringify(block.input) },
              };
            case 'tool_result':
              return {
                type: 'tool_result',
                tool_call_id: block.toolUseId,
                content: block.content,
              };
            default:
              return { type: 'text', text: JSON.stringify(block) };
          }
        });
      }

      if (msg.name) base.name = msg.name;
      return base;
    });
  }

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

  protected async buildEmptyResponse(model: string): Promise<CompletionResponse> {
    return {
      id: '',
      model,
      content: null,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      finishReason: 'stop',
    };
  }

  protected parseToolCalls(toolCalls?: any[]): any[] | undefined {
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
