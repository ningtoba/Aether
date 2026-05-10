import { ProviderInterface } from "../provider-interface.js";
import {
  CompletionRequest,
  CompletionResponse,
  EmbeddingRequest,
  EmbeddingResponse,
  ProviderConfig,
  StreamEvent,
  ModelCapabilities,
} from "../types.js";
import { ModelCapabilityRegistry } from "../model-capabilities.js";

/**
 * Anthropic provider stub.
 *
 * TODO: Implement the Anthropic Messages API.
 */
export class AnthropicProvider extends ProviderInterface {
  constructor(
    config: ProviderConfig,
    protected registry: ModelCapabilityRegistry,
  ) {
    super(config);
  }

  async complete(_request: CompletionRequest): Promise<CompletionResponse> {
    throw new Error("AnthropicProvider.complete: not implemented");
  }

  async *completeStream(
    _request: CompletionRequest,
  ): AsyncIterableIterator<StreamEvent> {
    throw new Error("AnthropicProvider.completeStream: not implemented");
  }

  async embed(_request: EmbeddingRequest): Promise<EmbeddingResponse> {
    throw new Error("AnthropicProvider.embed: not implemented");
  }

  async listModels(): Promise<string[]> {
    return this.config.models;
  }

  async getModelCapabilities(model: string): Promise<ModelCapabilities> {
    return this.registry.get(model, this.type);
  }
}
