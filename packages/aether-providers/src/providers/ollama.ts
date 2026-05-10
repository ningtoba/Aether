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
 * Ollama provider stub.
 *
 * TODO: Implement the Ollama API.
 */
export class OllamaProvider extends ProviderInterface {
  constructor(
    config: ProviderConfig,
    protected registry: ModelCapabilityRegistry,
  ) {
    super(config);
  }

  async complete(_request: CompletionRequest): Promise<CompletionResponse> {
    throw new Error("OllamaProvider.complete: not implemented");
  }

  async *completeStream(
    _request: CompletionRequest,
  ): AsyncIterableIterator<StreamEvent> {
    throw new Error("OllamaProvider.completeStream: not implemented");
  }

  async embed(_request: EmbeddingRequest): Promise<EmbeddingResponse> {
    throw new Error("OllamaProvider.embed: not implemented");
  }

  async listModels(): Promise<string[]> {
    return this.config.models;
  }

  async getModelCapabilities(model: string): Promise<ModelCapabilities> {
    return this.registry.get(model, this.type);
  }
}
