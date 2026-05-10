import type {
  MemoryEntry,
  MemoryQuery,
  MemorySearchResult,
  ChunkingConfig,
} from "./types.js";
import { MemoryStore } from "./store.js";
import { InMemoryVectorStore, cosineSimilarity } from "./vector.js";
import type { VectorStoreConfig } from "./types.js";

/**
 * RAGEngine provides retrieval-augmented generation primitives:
 * document chunking, indexing into a vector store, and hybrid
 * (keyword + vector) retrieval.
 */
export class RAGEngine {
  private store: MemoryStore;
  private vectorStore: InMemoryVectorStore;
  private chunking: ChunkingConfig;

  constructor(
    store: MemoryStore,
    vectorConfig: VectorStoreConfig,
    chunking?: Partial<ChunkingConfig>,
  ) {
    this.store = store;
    this.vectorStore = new InMemoryVectorStore(vectorConfig);
    this.chunking = {
      maxChunkSize: 512,
      overlap: 64,
      separator: "\n",
      strategy: "fixed",
      ...chunking,
    };
  }

  /**
   * Index a document: chunk it, generate embeddings (simulated),
   * and store both in the memory store and vector store.
   *
   * @param content - Raw document text
   * @param metadata - Associated metadata
   * @param type - Memory type bucket
   * @returns Array of created entry ids
   */
  async index(
    content: string,
    metadata: Record<string, unknown> = {},
    type: MemoryEntry["type"] = "semantic",
  ): Promise<string[]> {
    const chunks = this.chunkDocument(content);
    const ids: string[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const entry = await this.store.add({
        type,
        content: chunks[i],
        metadata: { ...metadata, chunkIndex: i, totalChunks: chunks.length },
        ttl: undefined,
      });

      // Simulated embedding — in production this would call an embedding API
      const simulatedEmbedding = this.simulateEmbedding(chunks[i]);
      await this.vectorStore.insert(entry.id, simulatedEmbedding, {
        ...metadata,
        chunkIndex: i,
      });

      ids.push(entry.id);
    }

    return ids;
  }

  /**
   * Retrieve relevant entries via hybrid search.
   *
   * Combines keyword search (MemoryStore) and vector similarity search
   * (InMemoryVectorStore), scoring and merging results.
   *
   * @param query - Query parameters
   * @returns Scored search results, deduplicated and sorted
   */
  async retrieve(query: MemoryQuery): Promise<MemorySearchResult[]> {
    // 1. Keyword search
    const keywordResults = await this.store.search(query);

    // 2. Simulate embedding and vector search
    const queryEmbedding = this.simulateEmbedding(query.query);
    const vectorResults = await this.vectorStore.search(
      queryEmbedding,
      query.limit,
      query.threshold,
    );

    // 3. Hybrid merge — keyword results take priority with a boost
    const merged = new Map<string, MemorySearchResult>();

    for (const r of keywordResults) {
      merged.set(r.entry.id, { ...r, score: r.score * 1.2 }); // keyword boost
    }

    for (const r of vectorResults) {
      const existing = merged.get(r.entry.id);
      if (existing) {
        existing.score = Math.max(existing.score, r.score);
      } else {
        merged.set(r.entry.id, r);
      }
    }

    // Sort by score descending, limit
    const results = Array.from(merged.values());
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, query.limit);
  }

  /**
   * End-to-end query: retrieve relevant context and return it formatted.
   *
   * @param query - The user query
   * @returns An object with the original query, context, and scored entries
   */
  async query(query: MemoryQuery): Promise<{
    query: string;
    context: string;
    results: MemorySearchResult[];
  }> {
    const results = await this.retrieve(query);
    const context = results
      .map((r) => r.entry.content)
      .join("\n---\n");

    return {
      query: query.query,
      context,
      results,
    };
  }

  /**
   * Split a document into chunks according to the configured strategy.
   */
  private chunkDocument(text: string): string[] {
    if (this.chunking.strategy === "fixed") {
      return this.chunkFixed(text);
    }
    if (this.chunking.strategy === "sentence") {
      return this.chunkBySeparator(text, /[.!?]\s+/);
    }
    if (this.chunking.strategy === "paragraph") {
      return this.chunkBySeparator(text, /\n\s*\n/);
    }
    // fallback
    return this.chunkFixed(text);
  }

  private chunkFixed(text: string): string[] {
    const { maxChunkSize, overlap, separator } = this.chunking;
    const chunks: string[] = [];
    let start = 0;

    while (start < text.length) {
      const end = Math.min(start + maxChunkSize, text.length);
      let chunk = text.slice(start, end);

      // Try to break at separator boundary
      if (end < text.length) {
        const breakAt = chunk.lastIndexOf(separator);
        if (breakAt > maxChunkSize / 2) {
          chunk = text.slice(start, start + breakAt);
          start += breakAt;
        } else {
          start = end;
        }
      } else {
        start = end;
      }

      chunks.push(chunk.trim());
      start -= overlap; // slide window
      if (start < 0) start = 0;
    }

    return chunks.filter(Boolean);
  }

  private chunkBySeparator(text: string, regex: RegExp): string[] {
    const { maxChunkSize } = this.chunking;
    const parts = text.split(regex).filter(Boolean);
    const chunks: string[] = [];
    let current = "";

    for (const part of parts) {
      if ((current + part).length <= maxChunkSize) {
        current += (current ? " " : "") + part;
      } else {
        if (current) chunks.push(current.trim());
        current = part;
      }
    }
    if (current) chunks.push(current.trim());

    return chunks;
  }

  /**
   * Generate a deterministic pseudo-embedding for a text snippet.
   *
   * In production this would call an embedding model API (OpenAI, Ollama, etc.).
   * For the abstraction layer we produce a hash-based vector.
   */
  private simulateEmbedding(text: string): number[] {
    const dim = this.vectorStore.dimension;
    const vec: number[] = new Array(dim);
    let hash = 0;

    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    }

    for (let i = 0; i < dim; i++) {
      // Use hash as seed to produce deterministic pseudo-random values
      const seed = hash * (i + 1) * 1103515245 + 12345;
      vec[i] = ((seed & 0x7fffffff) / 0x7fffffff) * 2 - 1; // normalise roughly
    }

    // Normalise
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    return norm > 0 ? vec.map((v) => v / norm) : vec;
  }
}
