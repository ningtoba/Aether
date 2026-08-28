import { randomUUID } from 'node:crypto';
import type {
  MemoryScope,
  MemoryStatus,
  ScopedMemoryEntry,
  ScopedMemoryQuery,
  ScopedMemoryQueryResult,
} from './scoped-types.js';
import type { IMemoryStore } from './IMemoryStore.js';

/**
 * In-memory store backed by Maps, implementing IMemoryStore.
 *
 * Used as default / testing fallback when no vector DB is available.
 * This complements the higher-level MemoryStore with a scope-based
 * abstraction (one store instance per scope).
 */
export class InMemoryStore implements IMemoryStore {
  readonly scope: MemoryScope;
  private entries = new Map<string, ScopedMemoryEntry>();

  constructor(scope: MemoryScope) {
    this.scope = scope;
  }

  async write(
    entry: Omit<ScopedMemoryEntry, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ScopedMemoryEntry> {
    // Enforce the one-store-per-scope contract: an entry must belong to THIS
    // store's scope, or the abstraction silently leaks cross-scope rows.
    if (entry.scope !== this.scope) {
      throw new Error(`Entry scope "${entry.scope}" does not match store scope "${this.scope}"`);
    }
    const now = new Date().toISOString();
    const full: ScopedMemoryEntry = {
      ...entry,
      scope: this.scope,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    this.entries.set(full.id, full);
    return full;
  }

  async writeMany(
    entries: Omit<ScopedMemoryEntry, 'id' | 'createdAt' | 'updatedAt'>[],
  ): Promise<ScopedMemoryEntry[]> {
    return Promise.all(entries.map((e) => this.write(e)));
  }

  async read(id: string): Promise<ScopedMemoryEntry | null> {
    const entry = this.entries.get(id) ?? null;
    return entry && entry.scope === this.scope ? entry : null;
  }

  async query(query: ScopedMemoryQuery): Promise<ScopedMemoryQueryResult[]> {
    // This store is bound to one scope; never surface rows belonging to others.
    let results = Array.from(this.entries.values()).filter((e) => e.scope === this.scope);

    // Filter by status (default active)
    const targetStatus: MemoryStatus = query.status ?? 'active';
    results = results.filter((e) => e.status === targetStatus);

    // Filter by time
    if (query.after) {
      results = results.filter((e) => e.createdAt >= query.after!);
    }

    // Metadata filter (simple exact match)
    if (query.filter) {
      results = results.filter((e) => {
        for (const [key, value] of Object.entries(query.filter!)) {
          if (e.metadata[key] !== value) return false;
        }
        return true;
      });
    }

    // Text search (case-insensitive substring, fallback when no vector).
    // A whitespace-only query must not match every entry.
    if (query.text) {
      const terms = query.text.toLowerCase().split(/\s+/).filter(Boolean);
      if (terms.length === 0) {
        results = [];
      } else {
        results = results.filter((e) => terms.some((t) => e.content.toLowerCase().includes(t)));
      }
    }

    // Sort — prefer entries with relevanceScore
    results.sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0));

    // Apply limit
    const limit = query.limit ?? 50;
    results = results.slice(0, limit);

    return results.map((entry) => ({ entry, score: entry.relevanceScore ?? 0 }));
  }

  async update(
    id: string,
    updates: Partial<Pick<ScopedMemoryEntry, 'metadata' | 'status' | 'content'>>,
  ): Promise<ScopedMemoryEntry | null> {
    const entry = this.entries.get(id);
    if (!entry || entry.scope !== this.scope) return null;
    Object.assign(entry, updates, { updatedAt: new Date().toISOString() });
    return entry;
  }

  async delete(id: string): Promise<boolean> {
    const entry = this.entries.get(id);
    if (!entry || entry.scope !== this.scope) return false;
    entry.status = 'deleted';
    entry.updatedAt = new Date().toISOString();
    return true;
  }

  async purge(id: string): Promise<boolean> {
    const entry = this.entries.get(id);
    if (!entry || entry.scope !== this.scope) return false;
    return this.entries.delete(id);
  }

  async count(filter?: Partial<Pick<ScopedMemoryEntry, 'scope' | 'status'>>): Promise<number> {
    let entries = Array.from(this.entries.values()).filter((e) => e.scope === this.scope);
    if (filter?.status) entries = entries.filter((e) => e.status === filter.status!);
    return entries.length;
  }

  async searchText(
    text: string,
    options?: { limit?: number; scope?: MemoryScope; status?: MemoryStatus },
  ): Promise<ScopedMemoryQueryResult[]> {
    return this.query({
      text,
      scope: options?.scope,
      status: options?.status,
      limit: options?.limit,
    });
  }
}
