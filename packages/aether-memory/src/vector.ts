import type { VectorStoreConfig, MemoryEntry, MemorySearchResult } from "./types.js";

/**
 * VectorStore interface for embedding-based similarity search.
 */
export interface VectorStore {
  /** Store dimension of the embedding vectors */
  readonly dimension: number;

  /**
   * Insert a vector entry with associated metadata.
   */
  insert(id: string, vector: number[], metadata: Record<string, unknown>): Promise<void>;

  /**
   * Search for the top-k most similar vectors by cosine similarity.
   */
  search(vector: number[], topK: number, threshold?: number): Promise<MemorySearchResult[]>;

  /**
   * Delete a vector entry by id.
   */
  delete(id: string): Promise<boolean>;

  /**
   * Get total count of stored vectors.
   */
  count(): Promise<number>;
}

/**
 * Pure-JS in-memory vector store using cosine similarity.
 *
 * No external dependencies — implements brute-force nearest neighbour
 * search over all stored vectors.
 */
export class InMemoryVectorStore implements VectorStore {
  readonly dimension: number;
  private vectors: Map<string, { vector: number[]; metadata: Record<string, unknown> }> = new Map();

  constructor(config: VectorStoreConfig) {
    this.dimension = config.embeddingDimension;
  }

  async insert(
    id: string,
    vector: number[],
    metadata: Record<string, unknown>,
  ): Promise<void> {
    if (vector.length !== this.dimension) {
      throw new Error(
        `Vector dimension ${vector.length} does not match store dimension ${this.dimension}`,
      );
    }
    this.vectors.set(id, { vector, metadata });
  }

  async search(
    queryVector: number[],
    topK: number,
    threshold = 0.0,
  ): Promise<MemorySearchResult[]> {
    const results: Array<{ id: string; score: number }> = [];

    for (const [id, { vector, metadata }] of Array.from(this.vectors.entries())) {
      const sim = cosineSimilarity(queryVector, vector);
      if (sim >= threshold) {
        results.push({ id, score: sim });
      }
    }

    results.sort((a, b) => b.score - a.score);
    const topResults = results.slice(0, topK);

    return topResults.map((r) => ({
      entry: {
        id: r.id,
        type: "semantic" as const,
        content: "",
        metadata: this.vectors.get(r.id)?.metadata ?? {},
        timestamp: Date.now(),
      },
      score: r.score,
    }));
  }

  async delete(id: string): Promise<boolean> {
    return this.vectors.delete(id);
  }

  async count(): Promise<number> {
    return this.vectors.size;
  }
}

/**
 * Compute cosine similarity between two vectors.
 *
 * Returns a value in [-1, 1] where 1 is identical direction.
 * If either vector is zero-magnitude, returns 0.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(
      `Vector dimension mismatch: ${a.length} vs ${b.length}`,
    );
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude === 0 ? 0 : dot / magnitude;
}
