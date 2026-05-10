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
 * LlamaCpp provider stub.
 *
 * TODO: Implement the llama.cpp server API (OpenAI-compatible with
 *       potential extra endpoints for completion-only models).
 */
export class LlamaCppProvider extends ProviderInterface {
  constructor(
    config: ProviderConfig,
    protected registry: ModelCapabilityRegistry,
  ) {
    super(config);
  }

  async complete(_request: CompletionRequest): Promise<CompletionResponse> {
    throw new Error("LlamaCppProvider.complete: not implemented");
  }

  async *completeStream(
    _request: CompletionRequest,
  ): AsyncIterableIterator<StreamEvent> {
    throw new Error("LlamaCppProvider.completeStream: not implemented");
  }

  async embed(_request: EmbeddingRequest): Promise<EmbeddingResponse> {
    throw new Error("LlamaCppProvider.embed: not implemented");
  }

  async listModels(): Promise<string[]> {
    return this.config.models;
  }

  async getModelCapabilities(model: string): Promise<ModelCapabilities> {
    return this.registry.get(model, this.type);
  }
}
