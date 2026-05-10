/**
 * Shared memory types for @aether/memory
 */

export type MemoryScope = "episodic" | "semantic" | "task" | "conversation";
export type MemoryStatus = "active" | "archived" | "deleted";

export interface MemoryEntry {
  id: string;
  scope: MemoryScope;
  content: string;
  metadata: Record<string, unknown>;
  status: MemoryStatus;
  relevanceScore?: number;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryQuery {
  scope?: MemoryScope;
  text?: string;
  after?: string;
  filter?: Record<string, unknown>;
  status?: MemoryStatus;
  limit?: number;
}

export interface MemoryQueryResult {
  entry: MemoryEntry;
  score: number;
}

export interface IndexedEntry {
  id: string;
  vector: Float64Array;
  metadata: Record<string, unknown>;
}
