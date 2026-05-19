import type {
  MemoryScope,
  MemoryStatus,
  ScopedMemoryEntry,
  ScopedMemoryQuery,
  ScopedMemoryQueryResult,
} from "./scoped-types.js";

/**
 * Core memory store interface for scope-based memory stores.
 * All memory stores (episodic, semantic, task, conversation) implement this.
 */
export interface IMemoryStore {
  readonly scope: MemoryScope;

  /** Store a memory entry */
  write(entry: Omit<ScopedMemoryEntry, "id" | "createdAt" | "updatedAt">): Promise<ScopedMemoryEntry>;

  /** Batch write */
  writeMany(entries: Omit<ScopedMemoryEntry, "id" | "createdAt" | "updatedAt">[]): Promise<ScopedMemoryEntry[]>;

  /** Read by ID */
  read(id: string): Promise<ScopedMemoryEntry | null>;

  /** Query the store */
  query(query: ScopedMemoryQuery): Promise<ScopedMemoryQueryResult[]>;

  /** Update metadata on an entry */
  update(id: string, updates: Partial<Pick<ScopedMemoryEntry, "metadata" | "status" | "content">>): Promise<ScopedMemoryEntry | null>;

  /** Soft delete (set status to deleted) */
  delete(id: string): Promise<boolean>;

  /** Permanently remove */
  purge(id: string): Promise<boolean>;

  /** Count entries matching filter */
  count(filter?: Partial<Pick<ScopedMemoryEntry, "scope" | "status">>): Promise<number>;

  /** Search by text (non-vector fallback) */
  searchText(text: string, options?: { limit?: number; scope?: MemoryScope; status?: MemoryStatus }): Promise<ScopedMemoryQueryResult[]>;
}
