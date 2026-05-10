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
 * OpenRouter provider stub.
 *
 * TODO: Implement the OpenRouter API (OpenAI-compatible with custom
 *       headers for app URLs, referrers, and model routing).
 */
export class OpenRouterProvider extends ProviderInterface {
  constructor(
    config: ProviderConfig,
    protected registry: ModelCapabilityRegistry,
  ) {
    super(config);
  }

  async complete(_request: CompletionRequest): Promise<CompletionResponse> {
    throw new Error("OpenRouterProvider.complete: not implemented");
  }

  async *completeStream(
    _request: CompletionRequest,
  ): AsyncIterableIterator<StreamEvent> {
    throw new Error("OpenRouterProvider.completeStream: not implemented");
  }

  async embed(_request: EmbeddingRequest): Promise<EmbeddingResponse> {
    throw new Error("OpenRouterProvider.embed: not implemented");
  }

  async listModels(): Promise<string[]> {
    return this.config.models;
  }

  async getModelCapabilities(model: string): Promise<ModelCapabilities> {
    return this.registry.get(model, this.type);
  }
}
