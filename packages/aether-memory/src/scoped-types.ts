/**
 * Shared memory types for scoped memory stores.
 * These types are used by the IMemoryStore interface and its
 * scoped implementations (EpisodicStore, SemanticStore, TaskStore, ConversationStore).
 */

export type MemoryScope = "episodic" | "semantic" | "task" | "conversation";
export type MemoryStatus = "active" | "archived" | "deleted";

export interface ScopedMemoryEntry {
  id: string;
  scope: MemoryScope;
  content: string;
  metadata: Record<string, unknown>;
  status: MemoryStatus;
  relevanceScore?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ScopedMemoryQuery {
  scope?: MemoryScope;
  text?: string;
  after?: string;
  filter?: Record<string, unknown>;
  status?: MemoryStatus;
  limit?: number;
}

export interface ScopedMemoryQueryResult {
  entry: ScopedMemoryEntry;
  score: number;
}

export interface IndexedEntry {
  id: string;
  vector: Float64Array;
  metadata: Record<string, unknown>;
}
