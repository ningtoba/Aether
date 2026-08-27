import type { IndexedEntry } from './scoped-types.js';

/**
 * Vector store abstraction for similarity search.
 * This is a generic interface that can be backed by in-memory,
 * Qdrant, SQLite, or any other vector database.
 */
export interface IVectorStore {
  /** Upsert a vector entry */
  upsert(entry: IndexedEntry): Promise<void>;

  /** Batch upsert */
  upsertMany(entries: IndexedEntry[]): Promise<void>;

  /** Search for nearest neighbors by vector */
  search(
    vector: Float64Array,
    options?: { limit?: number; minScore?: number },
  ): Promise<Array<{ id: string; score: number }>>;

  /** Delete by ID */
  delete(id: string): Promise<void>;

  /** Delete by metadata filter */
  deleteByFilter(filter: Record<string, unknown>): Promise<number>;

  /** Get count of stored vectors */
  count(): Promise<number>;

  /** Clear all vectors */
  clear(): Promise<void>;
}
