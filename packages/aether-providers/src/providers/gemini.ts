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
} from '../types.js';
import { ModelCapabilityRegistry } from '../model-capabilities.js';

/**
 * Gemini provider.
 *
 * Google's Gemini API uses a different format from OpenAI at:
 *   POST /v1beta/models/{model}:generateContent
 *
 * Key differences:
 *  - Base URL: https://generativelanguage.googleapis.com/v1beta
 *  - Auth: API key passed as query parameter (?key=...)
 *  - Request format: { contents: [...], system_instruction: {...} }
 *  - Different message structure with "role" and "parts"
 *  - Different tool format
 *  - Safety settings are top-level
 *  - Response format uses candidates[].content.parts[]
 */
export class GeminiProvider extends ProviderInterface {
  constructor(
    config: ProviderConfig,
    protected registry: ModelCapabilityRegistry,
  ) {
    super(config);
  }

  // ── Override auth: API key goes in query param ──────────────────────

  protected buildHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
    };
  }

  /**
   * Build URL with API key as query parameter.
   * Gemini uses: https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key=...
   */
  protected resolveGeminiUrl(model: string, action: string = 'generateContent'): string {
    const base = this.config.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta';
    const cleanBase = base.replace(/\/+$/, '');
    const key = this.config.apiKey ? `?key=${encodeURIComponent(this.config.apiKey)}` : '';
    return `${cleanBase}/models/${encodeURIComponent(model)}:${action}${key}`;
  }

  // ── Core completions ────────────────────────────────────────────────

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    return this.withRetry(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeout ?? 60_000);

      try {
        const url = this.resolveGeminiUrl(request.model, 'generateContent');
        const res = await fetch(url, {
          method: 'POST',
          headers: this.buildHeaders(),
          body: JSON.stringify(this.buildPayload(request)),
          signal: controller.signal,
        });

        if (!res.ok) {
          throw await this.parseError(res);
        }

        const json: any = await res.json();
        return this.parseResponse(json, request.model);
      } finally {
        clearTimeout(timeout);
      }
    });
  }

  async *completeStream(request: CompletionRequest): AsyncIterableIterator<StreamEvent> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeout ?? 60_000);

    try {
      // Gemini streaming uses SSE via the same endpoint with alt=sse
      const url = this.resolveGeminiUrl(request.model, 'streamGenerateContent?alt=sse');
      const res = await fetch(url, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(this.buildPayload(request)),
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
          if (!trimmed) continue;

          if (trimmed.startsWith('data: ')) {
            try {
              const data = JSON.parse(trimmed.slice(6));
              const parsed = this.parseStreamChunk(data, request.model);
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
        const input = Array.isArray(request.input) ? request.input.join('\n') : request.input;
        const url = this.resolveGeminiUrl(request.model, 'embedContent');
        const res = await fetch(url, {
          method: 'POST',
          headers: this.buildHeaders(),
          body: JSON.stringify({
            model: `models/${request.model}`,
            content: {
              parts: [{ text: input }],
            },
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          throw await this.parseError(res);
        }

        const json: any = await res.json();

        // Gemini returns: { embedding: { values: [0.1, 0.2, ...] } }
        // For batch, Gemini uses batchEmbedContents
        return {
          model: request.model,
          embeddings: json.embedding?.values ? [json.embedding.values] : [],
          usage: {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
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
      // Gemini models endpoint: GET /v1beta/models?key=...
      const base = this.config.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta';
      const cleanBase = base.replace(/\/+$/, '');
      const key = this.config.apiKey ? `?key=${encodeURIComponent(this.config.apiKey)}` : '';
      const url = `${cleanBase}/models${key}`;

      const res = await fetch(url, {
        signal: AbortSignal.timeout(10_000),
      });

      if (res.ok) {
        const json: any = await res.json();
        // Gemini returns: { models: [{ name: "models/gemini-pro", ... }] }
        if (Array.isArray(json.models)) {
          return json.models
            .map((m: any) => m.name?.replace(/^models\//, '') ?? '')
            .filter(Boolean);
        }
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

  /**
   * Build the Gemini API payload from our internal format.
   */
  protected buildPayload(request: CompletionRequest): Record<string, unknown> {
    const payload: Record<string, unknown> = {};

    // Convert messages to Gemini contents
    const { contents, systemInstruction } = this.serializeContents(request.messages);
    payload.contents = contents;

    if (systemInstruction) {
      payload.system_instruction = {
        parts: [{ text: systemInstruction }],
      };
    }

    if (request.maxTokens !== undefined) {
      payload.generationConfig = {
        ...((payload.generationConfig as Record<string, unknown>) ?? {}),
        maxOutputTokens: request.maxTokens,
      };
    }
    if (request.temperature !== undefined) {
      payload.generationConfig = {
        ...((payload.generationConfig as Record<string, unknown>) ?? {}),
        temperature: request.temperature,
      };
    }
    if (request.topP !== undefined) {
      payload.generationConfig = {
        ...((payload.generationConfig as Record<string, unknown>) ?? {}),
        topP: request.topP,
      };
    }
    if (request.stop !== undefined) {
      payload.generationConfig = {
        ...((payload.generationConfig as Record<string, unknown>) ?? {}),
        stopSequences: request.stop,
      };
    }

    // Tools (Gemini uses a different format)
    if (request.tools && request.tools.length > 0) {
      payload.tools = request.tools.map((t) => ({
        functionDeclarations: [
          {
            name: t.name,
            description: t.description,
            parameters: t.inputSchema,
          },
        ],
      }));
    }

    if (request.toolChoice) {
      if (request.toolChoice === 'none') {
        payload.tool_config = { function_calling_config: { mode: 'NONE' } };
      } else if (request.toolChoice === 'auto') {
        payload.tool_config = { function_calling_config: { mode: 'AUTO' } };
      } else if (request.toolChoice === 'any') {
        payload.tool_config = { function_calling_config: { mode: 'ANY' } };
      } else if (typeof request.toolChoice === 'object' && request.toolChoice.function) {
        payload.tool_config = {
          function_calling_config: {
            mode: 'ANY',
            allowed_function_names: [request.toolChoice.function.name],
          },
        };
      }
    }

    // Safety settings from config.extra
    if (request.extra?.safety_settings) {
      payload.safetySettings = request.extra.safety_settings;
    }

    // Pass through remaining extra params
    if (request.extra) {
      const cleanExtra = { ...request.extra };
      delete (cleanExtra as any).safety_settings;
      Object.assign(payload, cleanExtra);
    }

    return payload;
  }

  /**
   * Convert internal messages to Gemini contents format.
   *
   * Gemini uses:
   *   { contents: [{ role: "user", parts: [{ text: "hello" }] }] }
   *
   * Roles are "user" or "model" (not "assistant").
   * System messages are extracted and returned separately.
   */
  protected serializeContents(messages: any[]): {
    contents: Record<string, unknown>[];
    systemInstruction: string | null;
  } {
    const contents: Record<string, unknown>[] = [];
    let systemInstruction: string | null = null;

    for (const msg of messages) {
      if (msg.role === 'system') {
        // Accumulate system messages
        const text = typeof msg.content === 'string' ? msg.content : '';
        systemInstruction = systemInstruction ? `${systemInstruction}\n${text}` : text;
        continue;
      }

      // Map internal roles to Gemini roles
      let role: string;
      switch (msg.role) {
        case 'assistant':
          role = 'model';
          break;
        case 'tool':
          // Tool results are sent as "function" role in Gemini or as user with functionResponse
          role = 'function';
          break;
        default:
          role = 'user';
      }

      const parts = this.serializeParts(msg.content);
      if (parts.length > 0) {
        contents.push({ role, parts });
      }
    }

    return { contents, systemInstruction };
  }

  /**
   * Convert content blocks to Gemini parts.
   */
  protected serializeParts(content: any): Record<string, unknown>[] {
    if (typeof content === 'string') {
      return [{ text: content }];
    }

    if (!Array.isArray(content)) {
      return [{ text: String(content) }];
    }

    return content.map((block: any) => {
      switch (block.type) {
        case 'text':
          return { text: block.text };
        case 'image_url':
          // Gemini supports inline_data with base64
          return {
            inline_data: {
              mime_type: this.guessMimeType(block.imageUrl),
              data: this.extractBase64(block.imageUrl),
            },
          };
        case 'tool_use':
          return {
            functionCall: {
              name: block.name,
              args: block.input as Record<string, unknown>,
            },
          };
        case 'tool_result':
          return {
            functionResponse: {
              name: block.name ?? 'unknown',
              response: { content: block.content },
            },
          };
        default:
          return { text: JSON.stringify(block) };
      }
    });
  }

  /**
   * Parse a Gemini generateContent response.
   */
  protected parseResponse(json: any, model: string): CompletionResponse {
    const candidate = json.candidates?.[0];
    const content = candidate?.content ?? {};
    const parts = content?.parts ?? [];

    const textParts = parts.filter((p: any) => p.text);
    const text = textParts.map((p: any) => p.text).join('') || null;

    const functionCallParts = parts.filter((p: any) => p.functionCall);
    const toolCalls: ToolCall[] | undefined =
      functionCallParts.length > 0
        ? functionCallParts.map((p: any, i: number) => ({
            id: p.functionCall.name ?? `fc_${i}`,
            name: p.functionCall.name ?? 'unknown',
            input: (p.functionCall.args ?? {}) as Record<string, unknown>,
          }))
        : undefined;

    const usage = json.usageMetadata ?? {};
    const finishReason = candidate?.finishReason ?? candidate?.finish_reason;

    return {
      id: '',
      model,
      content: text,
      toolCalls,
      usage: {
        promptTokens: usage.promptTokenCount ?? usage.prompt_tokens ?? 0,
        completionTokens: usage.candidatesTokenCount ?? usage.completion_tokens ?? 0,
        totalTokens: usage.totalTokenCount ?? usage.total_tokens ?? 0,
      },
      finishReason: this.mapFinishReason(finishReason),
      raw: json,
    };
  }

  /**
   * Parse a streaming chunk from Gemini.
   */
  protected parseStreamChunk(data: any, model: string): StreamEvent | null {
    if (!data) return null;

    const candidate = data.candidates?.[0];
    if (!candidate) return null;

    const content = candidate.content ?? {};
    const parts = content?.parts ?? [];

    // Check for finish reason
    if (candidate.finishReason) {
      return {
        type: 'done',
        response: {
          id: '',
          model,
          content: null,
          usage: {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
          },
          finishReason: this.mapFinishReason(candidate.finishReason),
          raw: data,
        },
      };
    }

    // Function call
    const functionCallPart = parts.find((p: any) => p.functionCall);
    if (functionCallPart) {
      const fc = functionCallPart.functionCall;
      return {
        type: 'tool_call_delta',
        id: fc.name ?? '',
        name: fc.name ?? '',
        input: JSON.stringify(fc.args ?? {}),
      };
    }

    // Text delta
    const textPart = parts.find((p: any) => p.text);
    if (textPart?.text) {
      return { type: 'delta', content: textPart.text };
    }

    return null;
  }

  protected mapFinishReason(reason?: string): CompletionResponse['finishReason'] {
    if (!reason) return 'stop';

    switch (reason) {
      case 'STOP':
        return 'stop';
      case 'MAX_TOKENS':
        return 'length';
      case 'SAFETY':
      case 'BLOCKLIST':
      case 'PROHIBITED_CONTENT':
      case 'SPII':
        return 'content_filter';
      case 'RECITATION':
      case 'OTHER':
        return 'error';
      case 'TOOL_CALLS':
      case 'FUNCTION_CALL':
        return 'tool_calls';
      default:
        return 'stop';
    }
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

  protected async parseError(res: Response): Promise<ProviderError> {
    let body: any;
    try {
      body = await res.json();
    } catch {
      body = { error: { message: res.statusText } };
    }

    // Gemini error format: { error: { code: 400, message: "...", status: "INVALID_ARGUMENT" } }
    const errorObj = body?.error ?? body;
    const message = errorObj?.message ?? res.statusText;
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
    if (status === 401 || status === 403) return ProviderErrorCode.Authentication;
    if (status === 429) return ProviderErrorCode.RateLimited;
    if (status === 402) return ProviderErrorCode.QuotaExceeded;
    if (status === 404) return ProviderErrorCode.ModelNotFound;
    if (status === 503) return ProviderErrorCode.ModelUnavailable;
    if (status >= 500) return ProviderErrorCode.Internal;

    if (status === 400) {
      const msg = String(message).toLowerCase();
      if (
        msg.includes('context length') ||
        msg.includes('maximum context') ||
        msg.includes('too many tokens')
      )
        return ProviderErrorCode.ContextTooLong;
      return ProviderErrorCode.BadRequest;
    }

    if (status === 408) return ProviderErrorCode.Timeout;
    return ProviderErrorCode.Internal;
  }

  // ── Utility helpers ─────────────────────────────────────────────────

  private guessMimeType(url: string): string {
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

  private extractBase64(url: string): string {
    if (url.startsWith('data:')) {
      const commaIdx = url.indexOf(',');
      if (commaIdx !== -1) return url.slice(commaIdx + 1);
    }
    return url;
  }
}
