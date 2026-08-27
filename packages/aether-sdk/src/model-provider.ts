/**
 * AetherModelProvider — wraps Aether's ProviderInterface as an OpenAI Agents SDK
 * compatible Model and ModelProvider.
 *
 * @module @aether/sdk
 */

import type { ProviderInterface } from '@aether/providers';
import type {
  CompletionRequest,
  CompletionResponse,
  Message,
  ToolDefinition as ProviderToolDefinition,
} from '@aether/providers';

import {
  Usage,
  type Model,
  type ModelRequest,
  type ModelResponse,
  type ModelProvider,
  type StreamEvent,
  type StreamEventTextStream,
  type StreamEventResponseCompleted,
} from './internal-types.js';

// ── Helpers ──────────────────────────────────────────────────────────

function toProviderMessages(
  input: string | Array<Record<string, unknown>>,
  systemInstructions?: string,
): Message[] {
  const messages: Message[] = [];

  if (systemInstructions) {
    messages.push({ role: 'system', content: systemInstructions });
  }

  if (typeof input === 'string') {
    messages.push({ role: 'user', content: input });
    return messages;
  }

  for (const item of input) {
    const type = String(item.type ?? '');
    switch (type) {
      case 'message': {
        const role = String(item.role ?? 'user');
        const content = item.content;
        if (role === 'assistant' && Array.isArray(content)) {
          for (const block of content) {
            const b = block as Record<string, unknown>;
            if (b.type === 'output_text') {
              messages.push({ role: 'assistant', content: String(b.text ?? '') });
            }
          }
        } else if (role === 'user') {
          if (typeof content === 'string') {
            messages.push({ role: 'user', content });
          } else if (Array.isArray(content)) {
            const parts: string[] = [];
            for (const block of content) {
              const b = block as Record<string, unknown>;
              if (b.type === 'input_text') parts.push(String(b.text ?? ''));
            }
            if (parts.length > 0) messages.push({ role: 'user', content: parts.join('\n') });
          }
        }
        break;
      }
      case 'function_call':
        messages.push({
          role: 'assistant',
          content: `[tool_call: ${String(item.name ?? 'unknown')}]`,
        });
        break;
      case 'function_call_result':
        messages.push({
          role: 'tool',
          content:
            typeof item.output === 'string' ? item.output : JSON.stringify(item.output ?? ''),
          name: String(item.name ?? 'unknown'),
        });
        break;
      case 'reasoning':
      case 'compaction':
      case 'unknown':
        break;
      default:
        if (typeof item.content === 'string')
          messages.push({ role: 'user', content: item.content as string });
    }
  }

  return messages;
}

function toProviderTools(tools: ModelRequest['tools']): ProviderToolDefinition[] {
  return tools
    .filter((t: Record<string, unknown>) => {
      const type = String(t.type ?? '');
      return type === 'function' || type === '';
    })
    .map((t: Record<string, unknown>) => ({
      name: String(t.name ?? ''),
      description: String(t.description ?? ''),
      inputSchema: (t.parameters ?? t.inputSchema ?? {}) as Record<string, unknown>,
    }));
}

function toProviderToolChoice(toolChoice: string | undefined): CompletionRequest['toolChoice'] {
  if (!toolChoice || toolChoice === 'auto') return 'auto';
  if (toolChoice === 'none') return 'none';
  if (toolChoice === 'required') return 'any';
  return { type: 'function', function: { name: toolChoice } };
}

function toModelResponse(completion: CompletionResponse): ModelResponse {
  return {
    usage: new Usage({
      inputTokens: completion.usage.promptTokens,
      outputTokens: completion.usage.completionTokens,
      totalTokens: completion.usage.totalTokens,
    }),
    output: buildOutputItems(completion),
    responseId: completion.id,
  } as unknown as ModelResponse;
}

function buildOutputItems(completion: CompletionResponse): ModelResponse['output'] {
  const items: unknown[] = [];

  if (completion.content) {
    items.push({
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: completion.content }],
    });
  }

  if (completion.toolCalls && completion.toolCalls.length > 0) {
    for (const tc of completion.toolCalls) {
      items.push({
        type: 'function_call',
        callId: tc.id,
        name: tc.name,
        arguments: JSON.stringify(tc.input),
      });
    }
  }

  return items as ModelResponse['output'];
}

// ── AetherModel ───────────────────────────────────────────────────────

export class AetherModel implements Model {
  constructor(
    private readonly provider: ProviderInterface,
    private readonly modelName: string,
  ) {}

  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    const providerRequest = this.buildRequest(request, false);
    const response = await this.provider.complete(providerRequest as CompletionRequest);
    return toModelResponse(response);
  }

  async *getStreamedResponse(request: ModelRequest): AsyncIterable<StreamEvent> {
    const providerRequest = this.buildRequest(request, true);
    const stream = this.provider.completeStream(providerRequest as CompletionRequest);

    let finalResponse: CompletionResponse | null = null;

    for await (const event of stream) {
      switch (event.type) {
        case 'delta': {
          yield { type: 'output_text_delta', delta: event.content } as unknown as StreamEvent;
          break;
        }
        case 'done': {
          finalResponse = event.response;
          break;
        }
        case 'error': {
          yield {
            type: 'output_text_delta',
            delta: `[Error: ${event.error.message}]`,
          } as unknown as StreamEvent;
          return;
        }
        case 'tool_call_delta':
          // Tool call deltas are accumulated; final tool calls come in the "done" event
          break;
      }
    }

    // Emit final response event
    if (finalResponse) {
      const response = toModelResponse(finalResponse);
      yield {
        type: 'response_done',
        response: {
          id: response.responseId ?? '',
          usage: response.usage,
          output: response.output,
        },
      } as unknown as StreamEvent;
    }
  }

  getRetryAdvice(_args: {
    request: ModelRequest;
    error: unknown;
    stream: boolean;
    attempt: number;
  }): { retry?: boolean; retryAfterMs?: number } | undefined {
    if (_args.error && _args.attempt < 3) {
      return { retry: true, retryAfterMs: 1000 * Math.pow(2, _args.attempt) };
    }
    return undefined;
  }

  private buildRequest(request: ModelRequest, stream: boolean): Partial<CompletionRequest> {
    return {
      model: this.modelName,
      messages: toProviderMessages(
        request.input as string | Array<Record<string, unknown>>,
        request.systemInstructions,
      ),
      maxTokens: request.modelSettings?.maxTokens,
      temperature: request.modelSettings?.temperature,
      topP: request.modelSettings?.topP,
      tools: toProviderTools(request.tools),
      toolChoice: toProviderToolChoice(request.modelSettings?.toolChoice),
      stream,
    };
  }
}

// ── AetherModelProvider ───────────────────────────────────────────────

export class AetherModelProvider implements ModelProvider {
  readonly defaultModel: string;

  constructor(
    private readonly providerRegistry: {
      get: (name: string) => Promise<ProviderInterface>;
      has: (name: string) => boolean;
      list: () => string[];
    },
    private readonly providerName: string = 'default',
    defaultModel?: string,
  ) {
    this.defaultModel = defaultModel ?? 'gpt-4o';
  }

  async getModel(modelName?: string): Promise<AetherModel> {
    const resolvedName = modelName || this.defaultModel;

    if (!this.providerRegistry.has(this.providerName)) {
      throw new Error(
        `Aether provider "${this.providerName}" is not registered. ` +
          `Register it first via providerRegistry.register(). ` +
          `Available: ${this.providerRegistry.list().join(', ') || '(none)'}`,
      );
    }

    const provider = await this.providerRegistry.get(this.providerName);
    return new AetherModel(provider, resolvedName);
  }
}
