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
 * vLLM provider stub.
 *
 * TODO: Implement the vLLM API (OpenAI-compatible, may need custom handling).
 */
export class VLLMProvider extends ProviderInterface {
  constructor(
    config: ProviderConfig,
    protected registry: ModelCapabilityRegistry,
  ) {
    super(config);
  }

  async complete(_request: CompletionRequest): Promise<CompletionResponse> {
    throw new Error("VLLMProvider.complete: not implemented");
  }

  async *completeStream(
    _request: CompletionRequest,
  ): AsyncIterableIterator<StreamEvent> {
    throw new Error("VLLMProvider.completeStream: not implemented");
  }

  async embed(_request: EmbeddingRequest): Promise<EmbeddingResponse> {
    throw new Error("VLLMProvider.embed: not implemented");
  }

  async listModels(): Promise<string[]> {
    return this.config.models;
  }

  async getModelCapabilities(model: string): Promise<ModelCapabilities> {
    return this.registry.get(model, this.type);
  }
}
