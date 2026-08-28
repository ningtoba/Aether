import type { IVectorStore } from './IVectorStore.js';

/**
 * In-memory vector store using brute-force cosine similarity.
 * Excellent for testing, prototyping, and small-scale use.
 *
 * Uses Float64Array for vector storage and naive nearest-neighbour
 * search over all stored vectors.  O(n) per query.
 */
export class MemoryVectorStore implements IVectorStore {
  private vectors = new Map<string, Float64Array>();
  private metadata = new Map<string, Record<string, unknown>>();

  async upsert(entry: {
    id: string;
    vector: Float64Array;
    metadata: Record<string, unknown>;
  }): Promise<void> {
    this.vectors.set(entry.id, entry.vector);
    this.metadata.set(entry.id, entry.metadata);
  }

  async upsertMany(
    entries: { id: string; vector: Float64Array; metadata: Record<string, unknown> }[],
  ): Promise<void> {
    for (const e of entries) await this.upsert(e);
  }

  async search(
    vector: Float64Array,
    options?: { limit?: number; minScore?: number },
  ): Promise<Array<{ id: string; score: number }>> {
    const limit = options?.limit ?? 10;
    const minScore = options?.minScore ?? 0;

    const scores: Array<{ id: string; score: number }> = [];

    for (const [id, v] of this.vectors) {
      const score = cosineSimilarity(vector, v);
      if (score >= minScore) {
        scores.push({ id, score });
      }
    }

    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, limit);
  }

  async delete(id: string): Promise<void> {
    this.vectors.delete(id);
    this.metadata.delete(id);
  }

  async deleteByFilter(filter: Record<string, unknown>): Promise<number> {
    let count = 0;
    for (const [id, meta] of this.metadata) {
      let matches = true;
      for (const [key, value] of Object.entries(filter)) {
        if (meta[key] !== value) {
          matches = false;
          break;
        }
      }
      if (matches) {
        this.vectors.delete(id);
        this.metadata.delete(id);
        count++;
      }
    }
    return count;
  }

  async count(): Promise<number> {
    return this.vectors.size;
  }

  async clear(): Promise<void> {
    this.vectors.clear();
    this.metadata.clear();
  }
}

function cosineSimilarity(a: Float64Array, b: Float64Array): number {
  // A dimension mismatch would silently produce NaN ranks (dropped
  // results) or wrong scores; treat a mismatched query as not similar.
  if (a.length !== b.length) return 0;
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
