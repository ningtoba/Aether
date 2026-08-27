import type {
  MemoryConfig,
  MemoryEntry,
  MemoryQuery,
  MemorySearchResult,
  MemoryType,
} from './types.js';

/**
 * In-memory memory store with optional tag/bucket organisation by MemoryType.
 *
 * Provides basic CRUD, search (keyword matching), and optional periodic
 * compaction / expiry cleanup.
 */
export class MemoryStore {
  private entries: Map<string, MemoryEntry> = new Map();
  private config: MemoryConfig;
  private cleanupTimer?: ReturnType<typeof setInterval>;

  constructor(config?: Partial<MemoryConfig>) {
    this.config = {
      maxEntries: 10_000,
      autoCompact: true,
      defaultTtlMs: 0,
      ...config,
    };

    if (this.config.autoCompact) {
      this.cleanupTimer = setInterval(() => this.compact(), 60_000);
    }
  }

  /**
   * Store a new memory entry.
   *
   * @param entry - The entry to add (id is auto-generated if empty)
   * @returns The stored entry
   */
  async add(entry: Omit<MemoryEntry, 'id' | 'timestamp'> & { id?: string }): Promise<MemoryEntry> {
    const id = entry.id ?? `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const stored: MemoryEntry = {
      ...entry,
      id,
      timestamp: Date.now(),
    };
    this.entries.set(id, stored);
    return stored;
  }

  /**
   * Retrieve a single entry by id.
   */
  async get(id: string): Promise<MemoryEntry | undefined> {
    return this.entries.get(id);
  }

  /**
   * Search entries by keyword match on content, optional type filter,
   * and optional metadata filter.
   */
  async search(query: MemoryQuery): Promise<MemorySearchResult[]> {
    const results: MemorySearchResult[] = [];
    const q = query.query.toLowerCase();

    for (const entry of Array.from(this.entries.values())) {
      // Type filter
      if (query.type && entry.type !== query.type) continue;

      // Metadata filter
      if (query.filter) {
        let match = true;
        for (const [key, value] of Object.entries(query.filter)) {
          if (entry.metadata[key] !== value) {
            match = false;
            break;
          }
        }
        if (!match) continue;
      }

      // Simple keyword scoring
      const contentLower = entry.content.toLowerCase();
      const score = this.computeScore(q, contentLower);

      if (score >= query.threshold) {
        results.push({ entry, score });
      }
    }

    // Sort descending by score, take top `limit`
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, query.limit);
  }

  /**
   * Delete a single entry by id.
   */
  async delete(id: string): Promise<boolean> {
    return this.entries.delete(id);
  }

  /**
   * List all entries, optionally filtered by type.
   */
  async list(type?: MemoryType): Promise<MemoryEntry[]> {
    const all = Array.from(this.entries.values());
    if (type) return all.filter((e) => e.type === type);
    return all;
  }

  /**
   * Get aggregate statistics about the store.
   */
  async stats(): Promise<{
    totalEntries: number;
    byType: Record<string, number>;
  }> {
    const byType: Record<string, number> = {};
    for (const entry of Array.from(this.entries.values())) {
      byType[entry.type] = (byType[entry.type] ?? 0) + 1;
    }
    return {
      totalEntries: this.entries.size,
      byType,
    };
  }

  /**
   * Remove expired entries and enforce max capacity.
   */
  compact(): void {
    const now = Date.now();
    const toDelete: string[] = [];

    for (const [id, entry] of Array.from(this.entries.entries())) {
      // Expiry check
      if (entry.ttl && entry.ttl > 0 && now - entry.timestamp > entry.ttl) {
        toDelete.push(id);
      }
    }

    for (const id of toDelete) {
      this.entries.delete(id);
    }

    // Enforce max entries (evict oldest first)
    if (this.entries.size > this.config.maxEntries) {
      const sorted = Array.from(this.entries.entries()).sort(
        ([, a], [, b]) => a.timestamp - b.timestamp,
      );
      const excess = sorted.slice(0, sorted.length - this.config.maxEntries);
      for (const [id] of excess) {
        this.entries.delete(id);
      }
    }
  }

  /**
   * Release resources (clear interval).
   */
  dispose(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.entries.clear();
  }

  /**
   * Simple keyword-based relevance score.
   * Returns a value between 0 and 1.
   */
  private computeScore(query: string, content: string): number {
    if (!query) return 0;
    if (!content) return 0;

    const queryTerms = query.split(/\s+/).filter(Boolean);
    let matchCount = 0;
    for (const term of queryTerms) {
      if (content.includes(term)) matchCount++;
    }
    return queryTerms.length > 0 ? matchCount / queryTerms.length : 0;
  }
}
