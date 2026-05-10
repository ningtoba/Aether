import { v4 as uuid } from "uuid";
import { type MemoryEntry, type MemoryScope, type MemoryQuery, type MemoryQueryResult, type MemoryStatus } from "../types/index.js";
import { type IMemoryStore } from "./IMemoryStore.js";

/**
 * In-memory store backed by Maps.
 * Used as default / testing fallback when no vector DB is available.
 */
export class InMemoryStore implements IMemoryStore {
  readonly scope: MemoryScope;
  private entries = new Map<string, MemoryEntry>();

  constructor(scope: MemoryScope) {
    this.scope = scope;
  }

  async write(entry: Omit<MemoryEntry, "id" | "createdAt" | "updatedAt">): Promise<MemoryEntry> {
    const now = new Date().toISOString();
    const full: MemoryEntry = {
      ...entry,
      id: uuid(),
      createdAt: now,
      updatedAt: now,
    };
    this.entries.set(full.id, full);
    return full;
  }

  async writeMany(entries: Omit<MemoryEntry, "id" | "createdAt" | "updatedAt">[]): Promise<MemoryEntry[]> {
    return Promise.all(entries.map((e) => this.write(e)));
  }

  async read(id: string): Promise<MemoryEntry | null> {
    return this.entries.get(id) ?? null;
  }

  async query(query: MemoryQuery): Promise<MemoryQueryResult[]> {
    let results = Array.from(this.entries.values());

    // Filter by scope
    if (query.scope) {
      results = results.filter((e) => e.scope === query.scope);
    }

    // Filter by status (default active)
    const targetStatus: MemoryStatus = query.status ?? "active";
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

    // Text search (case-insensitive substring, fallback when no vector)
    if (query.text) {
      const terms = query.text.toLowerCase().split(/\s+/);
      results = results.filter((e) =>
        terms.some((t) => e.content.toLowerCase().includes(t))
      );
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
    updates: Partial<Pick<MemoryEntry, "metadata" | "status" | "content">>
  ): Promise<MemoryEntry | null> {
    const entry = this.entries.get(id);
    if (!entry) return null;
    Object.assign(entry, updates, { updatedAt: new Date().toISOString() });
    return entry;
  }

  async delete(id: string): Promise<boolean> {
    const entry = this.entries.get(id);
    if (!entry) return false;
    entry.status = "deleted";
    entry.updatedAt = new Date().toISOString();
    return true;
  }

  async purge(id: string): Promise<boolean> {
    return this.entries.delete(id);
  }

  async count(filter?: Partial<Pick<MemoryEntry, "scope" | "status">>): Promise<number> {
    let entries = Array.from(this.entries.values());
    if (filter?.scope) entries = entries.filter((e) => e.scope === filter.scope!);
    if (filter?.status) entries = entries.filter((e) => e.status === filter.status!);
    return entries.length;
  }

  async searchText(
    text: string,
    options?: { limit?: number; scope?: MemoryScope; status?: MemoryStatus }
  ): Promise<MemoryQueryResult[]> {
    return this.query({
      text,
      scope: options?.scope,
      status: options?.status,
      limit: options?.limit,
    });
  }
}
