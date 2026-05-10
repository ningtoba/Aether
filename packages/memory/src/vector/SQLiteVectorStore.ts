import { type IVectorStore } from "./IVectorStore.js";

// Stub — full SQLite FTS5 + vector extension implementation
// Will use better-sqlite3 with a simple cosine-similarity SQL function
export class SQLiteVectorStore implements IVectorStore {
  async upsert(_entry: { id: string; vector: Float64Array; metadata: Record<string, unknown> }): Promise<void> {
    throw new Error("SQLiteVectorStore not yet implemented");
  }
  async upsertMany(_entries: { id: string; vector: Float64Array; metadata: Record<string, unknown> }[]): Promise<void> {
    throw new Error("SQLiteVectorStore not yet implemented");
  }
  async search(_vector: Float64Array, _options?: { limit?: number; minScore?: number }): Promise<Array<{ id: string; score: number }>> {
    throw new Error("SQLiteVectorStore not yet implemented");
  }
  async delete(_id: string): Promise<void> {
    throw new Error("SQLiteVectorStore not yet implemented");
  }
  async deleteByFilter(_filter: Record<string, unknown>): Promise<number> {
    throw new Error("SQLiteVectorStore not yet implemented");
  }
  async count(): Promise<number> {
    throw new Error("SQLiteVectorStore not yet implemented");
  }
  async clear(): Promise<void> {
    throw new Error("SQLiteVectorStore not yet implemented");
  }
}
