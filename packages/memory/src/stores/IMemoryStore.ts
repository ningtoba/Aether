import {
  type MemoryEntry,
  type MemoryScope,
  type MemoryQuery,
  type MemoryQueryResult,
  type MemoryStatus,
} from "../types/index.js";

/**
 * Core memory store interface.
 * All memory stores (episodic, semantic, task, conversation) implement this.
 */
export interface IMemoryStore {
  readonly scope: MemoryScope;

  /** Store a memory entry */
  write(entry: Omit<MemoryEntry, "id" | "createdAt" | "updatedAt">): Promise<MemoryEntry>;

  /** Batch write */
  writeMany(entries: Omit<MemoryEntry, "id" | "createdAt" | "updatedAt">[]): Promise<MemoryEntry[]>;

  /** Read by ID */
  read(id: string): Promise<MemoryEntry | null>;

  /** Query the store */
  query(query: MemoryQuery): Promise<MemoryQueryResult[]>;

  /** Update metadata on an entry */
  update(id: string, updates: Partial<Pick<MemoryEntry, "metadata" | "status" | "content">>): Promise<MemoryEntry | null>;

  /** Soft delete (set status to deleted) */
  delete(id: string): Promise<boolean>;

  /** Permanently remove */
  purge(id: string): Promise<boolean>;

  /** Count entries matching filter */
  count(filter?: Partial<Pick<MemoryEntry, "scope" | "status">>): Promise<number>;

  /** Search by text (non-vector fallback) */
  searchText(text: string, options?: { limit?: number; scope?: MemoryScope; status?: MemoryStatus }): Promise<MemoryQueryResult[]>;
}
