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
  ToolCall,
  TokenUsage,
} from '../types.js';
import { ModelCapabilityRegistry } from '../model-capabilities.js';

/**
 * Anthropic provider.
 *
 * Maps the internal unified API to the Anthropic Messages API:
 *   POST https://api.anthropic.com/v1/messages
 *
 * Key differences from OpenAI:
 *  - Auth: x-api-key header (not Bearer token)
 *  - System message is a separate top-level field, not in messages array
 *  - Messages use "user" and "assistant" roles (no "system" in messages)
 *  - Content is an array of content blocks (text, tool_use, tool_result)
 *  - Different finish reason names
 *  - Streaming uses SSE with different event types
 */
export class AnthropicProvider extends ProviderInterface {
  constructor(
    config: ProviderConfig,
    protected registry: ModelCapabilityRegistry,
  ) {
    super(config);
  }

  // ── Override headers for Anthropic auth ─────────────────────────────

  protected buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    };
    if (this.config.apiKey) {
      headers['x-api-key'] = this.config.apiKey;
    }
    return headers;
  }

  // ── Core completions ────────────────────────────────────────────────

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    return this.withRetry(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeout ?? 60_000);

      try {
        const res = await fetch(this.resolveUrl('messages'), {
          method: 'POST',
          headers: this.buildHeaders(),
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
      const res = await fetch(this.resolveUrl('messages'), {
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
      // Accumulate content deltas for building the final response
      let accumulatedContent = '';
      const accumulatedToolCalls: { id: string; name: string; input: string }[] = [];
      const responseId = '';
      const responseModel = request.model;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          // Anthropic sends SSE events in the format: event: <type>\ndata: <json>
          if (trimmed.startsWith('event: ')) {
            // Event type line — consume but don't process directly
            continue;
          }

          if (trimmed.startsWith('data: ')) {
            try {
              const data = JSON.parse(trimmed.slice(6));
              const event = this.parseStreamEvent(data);
              if (event) {
                yield event;

                // Accumulate for potential done event
                if (event.type === 'delta') {
                  accumulatedContent += event.content;
                } else if (event.type === 'tool_call_delta') {
                  const existing = accumulatedToolCalls.find((tc) => tc.id === event.id);
                  if (existing) {
                    existing.input += event.input;
                  } else {
                    accumulatedToolCalls.push({
                      id: event.id,
                      name: event.name,
                      input: event.input,
                    });
                  }
                } else if (event.type === 'done') {
                  return; // Stream complete
                }
              }
            } catch {
              // Malformed chunk — skip
            }
          }
        }
      }

      // If we never got a done event, send one
      yield {
        type: 'done',
        response: {
          id: responseId,
          model: responseModel,
          content: accumulatedContent || null,
          toolCalls:
            accumulatedToolCalls.length > 0
              ? accumulatedToolCalls.map((tc) => ({
                  id: tc.id,
                  name: tc.name,
                  input: (() => {
                    try {
                      return JSON.parse(tc.input);
                    } catch {
                      return {};
                    }
                  })(),
                }))
              : undefined,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          finishReason: 'stop',
        },
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  // ── Embeddings ───────────────────────────────────────────────────────

  async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    // Anthropic does not have an embeddings API currently
    throw new ProviderError(
      ProviderErrorCode.BadRequest,
      'Anthropic does not support embeddings',
      undefined,
      false,
    );
  }

  // ── Model introspection ──────────────────────────────────────────────

  async listModels(): Promise<string[]> {
    if (this.config.models.length > 0) {
      return this.config.models;
    }

    // Anthropic doesn't have a public /models endpoint like OpenAI
    // Use the known models from the registry
    return this.registry.listModels().filter((m) => m.startsWith('claude'));
  }

  async getModelCapabilities(model: string) {
    return this.registry.get(model, this.type);
  }

  // ── Internal helpers ─────────────────────────────────────────────────

  /**
   * Build the Anthropic Messages API payload from our internal format.
   */
  protected buildPayload(request: CompletionRequest): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      model: request.model,
      messages: this.serializeMessages(request.messages),
      max_tokens: request.maxTokens ?? 1024,
    };

    // System message is a top-level field in Anthropic's API
    const systemMessages = request.messages.filter((m) => m.role === 'system');
    if (systemMessages.length > 0) {
      const systemContent = systemMessages
        .map((m) => (typeof m.content === 'string' ? m.content : ''))
        .filter(Boolean)
        .join('\n');
      if (systemContent) {
        payload.system = systemContent;
      }
    }

    if (request.temperature !== undefined) payload.temperature = request.temperature;
    if (request.topP !== undefined) payload.top_p = request.topP;
    if (request.stop !== undefined) payload.stop = request.stop;
    if (request.stream !== undefined) payload.stream = request.stream;

    // Anthropic uses a different tool format
    if (request.tools && request.tools.length > 0) {
      payload.tools = request.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      }));
    }

    if (request.toolChoice) {
      if (request.toolChoice === 'any' || request.toolChoice === 'required') {
        payload.tool_choice = { type: 'any' };
      } else if (request.toolChoice === 'auto') {
        payload.tool_choice = { type: 'auto' };
      } else if (request.toolChoice === 'none') {
        payload.tool_choice = { type: 'none' };
      } else if (typeof request.toolChoice === 'object') {
        payload.tool_choice = {
          type: 'tool',
          name: request.toolChoice.function?.name ?? '',
        };
      }
    }

    // Pass through any extra params (e.g. metadata)
    if (request.extra) {
      Object.assign(payload, request.extra);
    }

    // Remove system messages from messages array since they're handled above
    payload.messages = (payload.messages as any[]).filter((m: any) => m.role !== 'system');

    return payload;
  }

  /**
   * Convert internal messages to Anthropic message format.
   * System messages are excluded — they are handled separately as
   * a top-level field.
   */
  protected serializeMessages(messages: any[]): Record<string, unknown>[] {
    const result: Record<string, unknown>[] = [];

    for (const msg of messages) {
      // Skip system messages (handled separately in buildPayload)
      if (msg.role === 'system') continue;

      const role = msg.role === 'tool' ? 'user' : msg.role;

      if (typeof msg.content === 'string') {
        // Single text content block
        result.push({
          role,
          content: [{ type: 'text', text: msg.content }],
        });
      } else if (Array.isArray(msg.content)) {
        // Content blocks array
        const blocks = msg.content.map((block: any) => {
          switch (block.type) {
            case 'text':
              return { type: 'text', text: block.text };
            case 'image_url':
              // Anthropic uses "image" with a "source" object
              return {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: this.guessMediaType(block.imageUrl),
                  data: this.extractBase64Data(block.imageUrl),
                },
              };
            case 'tool_use':
              return {
                type: 'tool_use',
                id: block.id,
                name: block.name,
                input: block.input,
              };
            case 'tool_result':
              return {
                type: 'tool_result',
                tool_use_id: block.toolUseId,
                content: block.content,
              };
            default:
              return { type: 'text', text: JSON.stringify(block) };
          }
        });

        result.push({ role, content: blocks });
      }
    }

    return result;
  }

  /**
   * Parse an Anthropic Messages API response into our internal format.
   */
  protected parseResponse(json: any): CompletionResponse {
    const content = json.content ?? [];
    const textBlocks = content.filter((b: any) => b.type === 'text');
    const toolUseBlocks = content.filter((b: any) => b.type === 'tool_use');

    return {
      id: json.id ?? '',
      model: json.model ?? '',
      content: textBlocks.map((b: any) => b.text).join('') || null,
      toolCalls:
        toolUseBlocks.length > 0
          ? toolUseBlocks.map((b: any) => ({
              id: b.id,
              name: b.name,
              input: b.input as Record<string, unknown>,
            }))
          : undefined,
      usage: {
        promptTokens: json.usage?.input_tokens ?? 0,
        completionTokens: json.usage?.output_tokens ?? 0,
        totalTokens: (json.usage?.input_tokens ?? 0) + (json.usage?.output_tokens ?? 0),
      },
      finishReason: this.mapFinishReason(json.stop_reason ?? json.stop_sequence),
      raw: json,
    };
  }

  /**
   * Parse an Anthropic streaming SSE event.
   *
   * Anthropic sends events like:
   *   event: message_start
   *   data: {"type":"message_start","message":{...}}
   *
   *   event: content_block_start
   *   data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":"Hello"}}
   *
   *   event: content_block_delta
   *   data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}
   *
   *   event: content_block_stop
   *   data: {"type":"content_block_stop","index":0}
   *
   *   event: message_delta
   *   data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":10}}
   *
   *   event: message_stop
   *   data: {"type":"message_stop"}
   */
  protected parseStreamEvent(data: any): StreamEvent | null {
    if (!data || !data.type) return null;

    switch (data.type) {
      case 'message_start': {
        // Capture the message ID and model from the start event
        if (data.message) {
          // We handle the accumulation in completeStream, so just return null
          // to not emit a spurious event at this point
        }
        return null;
      }

      case 'content_block_start': {
        const block = data.content_block;
        if (block?.type === 'tool_use') {
          return {
            type: 'tool_call_delta',
            id: block.id,
            name: block.name,
            input: block.input ? JSON.stringify(block.input) : '',
          };
        }
        return null;
      }

      case 'content_block_delta': {
        const delta = data.delta;
        if (delta?.type === 'text_delta') {
          return {
            type: 'delta',
            content: delta.text ?? '',
          };
        }
        if (delta?.type === 'input_json_delta') {
          // Tool call partial JSON delta — we need to find the tool use block
          // Since Anthropic sends tool_use start with complete name but partial input,
          // we just accumulate the partial JSON here
          return {
            type: 'tool_call_delta',
            id: '', // Will be filled by content_block_start
            name: '',
            input: delta.partial_json ?? '',
          };
        }
        return null;
      }

      case 'message_delta': {
        const stopReason = data.delta?.stop_reason;
        const usage = data.usage;
        return {
          type: 'done',
          response: {
            id: '',
            model: '',
            content: null,
            usage: {
              promptTokens: 0,
              completionTokens: usage?.output_tokens ?? 0,
              totalTokens: usage?.output_tokens ?? 0,
            },
            finishReason: this.mapFinishReason(stopReason),
            raw: data,
          },
        };
      }

      case 'message_stop':
      case 'content_block_stop':
        return null;

      case 'error': {
        return {
          type: 'error',
          error: new ProviderError(
            ProviderErrorCode.Internal,
            data.error?.message ?? 'Unknown Anthropic error',
            0,
            false,
          ),
        };
      }

      default:
        return null;
    }
  }

  protected mapFinishReason(reason?: string): CompletionResponse['finishReason'] {
    switch (reason) {
      case 'end_turn':
        return 'stop';
      case 'max_tokens':
        return 'length';
      case 'tool_use':
        return 'tool_calls';
      case 'stop_sequence':
        return 'stop';
      case 'content_filtered':
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

    // Anthropic error format: { error: { type: "...", message: "..." } }
    const errorObj = body?.error ?? body;
    const message = errorObj?.message ?? errorObj?.type ?? res.statusText;
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
      if (
        msg.includes('context length') ||
        msg.includes('too long') ||
        msg.includes('too many tokens')
      )
        return ProviderErrorCode.ContextTooLong;

      // Anthropic-specific: "invalid_api_key" or "authentication_error"
      if (msg.includes('invalid') && (msg.includes('api') || msg.includes('key')))
        return ProviderErrorCode.Authentication;

      return ProviderErrorCode.BadRequest;
    }

    if (status === 408) return ProviderErrorCode.Timeout;
    return ProviderErrorCode.Internal;
  }

  // ── Utility helpers ─────────────────────────────────────────────────

  /**
   * Guess media type from a data URI or image URL.
   */
  private guessMediaType(url: string): string {
    if (url.startsWith('data:')) {
      const match = url.match(/^data:([^;]+);/);
      if (match) return match[1];
    }
    const ext = url.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'png':
        return 'image/png';
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'gif':
        return 'image/gif';
      case 'webp':
        return 'image/webp';
      default:
        return 'image/png';
    }
  }

  /**
   * Extract base64 data from a data URI.
   */
  private extractBase64Data(url: string): string {
    if (url.startsWith('data:')) {
      const commaIdx = url.indexOf(',');
      if (commaIdx !== -1) return url.slice(commaIdx + 1);
    }
    return url;
  }
}
