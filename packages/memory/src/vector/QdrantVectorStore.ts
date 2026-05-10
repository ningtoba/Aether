import { type IVectorStore } from "./IVectorStore.js";
import { type IndexedEntry } from "../types/index.js";

/**
 * QdrantVectorStore stub — placeholder for Qdrant-backed vector storage.
 *
 * TODO: Implement actual Qdrant client integration.
 */
export class QdrantVectorStore implements IVectorStore {
  private entries = new Map<string, IndexedEntry>();

  constructor(_options?: { url?: string; collectionName?: string; apiKey?: string }) {
    // Stub — no-op
  }

  async upsert(entry: IndexedEntry): Promise<void> {
    this.entries.set(entry.id, entry);
  }

  async upsertMany(entries: IndexedEntry[]): Promise<void> {
    for (const entry of entries) {
      await this.upsert(entry);
    }
  }

  async search(
    _vector: Float64Array,
    options?: { limit?: number; minScore?: number },
  ): Promise<Array<{ id: string; score: number }>> {
    // Stub — returns empty results
    return [];
  }

  async delete(id: string): Promise<void> {
    this.entries.delete(id);
  }

  async deleteByFilter(_filter: Record<string, unknown>): Promise<number> {
    // Stub — no actual filtering
    const count = this.entries.size;
    this.entries.clear();
    return count;
  }

  async count(): Promise<number> {
    return this.entries.size;
  }

  async clear(): Promise<void> {
    this.entries.clear();
  }
}
