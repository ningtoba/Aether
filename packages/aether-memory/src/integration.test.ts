/**
 * Integration tests for @aether/memory
 *
 * Tests RAG + stores together:
 * - MemoryStore CRUD and search
 * - RAGEngine document indexing and hybrid retrieval
 * - TTL-based compaction
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryStore } from "./store.js";
import { RAGEngine } from "./rag.js";
import { InMemoryVectorStore, cosineSimilarity } from "./vector.js";
import type { MemoryEntry, MemoryQuery } from "./types.js";

// ---------------------------------------------------------------------------
// MemoryStore integration
// ---------------------------------------------------------------------------
describe("MemoryStore integration", () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({
      maxEntries: 100,
      autoCompact: false,
      defaultTtlMs: 0,
    });
  });

  afterEach(() => {
    store.dispose();
  });

  it("adds entries and retrieves them via search", async () => {
    await store.add({
      type: "semantic",
      content: "The sky is blue and the sun is bright",
      metadata: { category: "weather" },
    });

    await store.add({
      type: "semantic",
      content: "Machine learning models can learn from data",
      metadata: { category: "ai" },
    });

    await store.add({
      type: "task",
      content: "Buy groceries and cook dinner",
      metadata: { category: "personal" },
    });

    // Search by keyword
    const results = await store.search({
      query: "sky sun",
      type: "semantic",
      limit: 10,
      threshold: 0,
    });

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].entry.content).toContain("sky");
    expect(results[0].score).toBeGreaterThan(0);
  });

  it("filters by type and metadata", async () => {
    await store.add({
      type: "semantic",
      content: "Semantic memory entry",
      metadata: { project: "aether" },
    });
    await store.add({
      type: "task",
      content: "Task memory entry",
      metadata: { project: "aether" },
    });
    await store.add({
      type: "semantic",
      content: "Another semantic entry",
      metadata: { project: "other" },
    });

    const results = await store.search({
      query: "entry",
      type: "semantic",
      filter: { project: "aether" },
      limit: 10,
      threshold: 0,
    });

    expect(results).toHaveLength(1);
    expect(results[0].entry.content).toBe("Semantic memory entry");
  });

  it("lists entries by type", async () => {
    await store.add({ type: "episodic", content: "E1", metadata: {} });
    await store.add({ type: "semantic", content: "S1", metadata: {} });
    await store.add({ type: "task", content: "T1", metadata: {} });

    const episodic = await store.list("episodic");
    expect(episodic).toHaveLength(1);

    const all = await store.list();
    expect(all).toHaveLength(3);
  });

  it("deletes entries", async () => {
    const entry = await store.add({
      type: "conversation",
      content: "Delete me",
      metadata: {},
    });
    expect(await store.get(entry.id)).toBeDefined();

    const deleted = await store.delete(entry.id);
    expect(deleted).toBe(true);
    expect(await store.get(entry.id)).toBeUndefined();
  });

  it("provides store statistics", async () => {
    await store.add({ type: "semantic", content: "A", metadata: {} });
    await store.add({ type: "semantic", content: "B", metadata: {} });
    await store.add({ type: "task", content: "C", metadata: {} });

    const stats = await store.stats();
    expect(stats.totalEntries).toBe(3);
    expect(stats.byType.semantic).toBe(2);
    expect(stats.byType.task).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// RAGEngine: indexing + hybrid retrieval
// ---------------------------------------------------------------------------
describe("RAGEngine integration", () => {
  let store: MemoryStore;
  let engine: RAGEngine;

  beforeEach(() => {
    store = new MemoryStore({ maxEntries: 100, autoCompact: false });
    engine = new RAGEngine(
      store,
      {
        type: "memory",
        collectionName: "test",
        embeddingDimension: 4,
      },
      { maxChunkSize: 100, overlap: 10, separator: "\n", strategy: "fixed" }
    );
  });

  afterEach(() => {
    store.dispose();
  });

  it("indexes documents and retrieves via hybrid search", async () => {
    const ids = await engine.index(
      "Aether is an autonomous AI orchestration platform. It manages agents, executes tasks, and stores memories."
    );

    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);
    }

    // Query for the indexed content
    const result = await engine.query({
      query: "Aether orchestration platform",
      limit: 5,
      threshold: 0,
      type: "semantic",
    });

    expect(result.query).toBe("Aether orchestration platform");
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.context).toContain("Aether");
    expect(result.context).toContain("orchestration");
  });

  it("retrieves returns scored results sorted by relevance", async () => {
    await engine.index("The cat sat on the mat.");
    await engine.index("Dogs love to play fetch in the park.");
    await engine.index("Programming in TypeScript is productive.");

    const results = await engine.retrieve({
      query: "cat mat",
      limit: 5,
      threshold: 0,
    });

    // Results should be sorted descending by score
    expect(results.length).toBeGreaterThan(0);
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score);
    }

    // The most relevant should be about cats/mats
    expect(results[0].entry.content.toLowerCase()).toContain("cat");
  });

  it("handles query with type filter", async () => {
    await engine.index("Semantic content about AI", { project: "ai" }, "semantic");
    await engine.index("Task: review the PR", { priority: "high" }, "task");

    const semanticResults = await engine.retrieve({
      query: "content",
      type: "semantic",
      limit: 5,
      threshold: 0,
    });

    expect(semanticResults.length).toBeGreaterThan(0);
    for (const r of semanticResults) {
      expect(r.entry.type).toBe("semantic");
    }
  });

  it("metadata filter works with hybrid retrieval", async () => {
    await engine.index("Confidential document about project X", { visibility: "confidential" });
    await engine.index("Public documentation about the API", { visibility: "public" });

    const results = await engine.retrieve({
      query: "document",
      filter: { visibility: "public" },
      limit: 5,
      threshold: 0,
    });

    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.entry.metadata.visibility).toBe("public");
    }
  });
});

// ---------------------------------------------------------------------------
// RAGEngine: chunking strategies
// ---------------------------------------------------------------------------
describe("RAGEngine chunking", () => {
  it("chunks a long document and indexes all chunks", async () => {
    const store = new MemoryStore({ maxEntries: 100, autoCompact: false });
    const engine = new RAGEngine(
      store,
      { type: "memory", collectionName: "test", embeddingDimension: 4 },
      { maxChunkSize: 50, overlap: 5, separator: "\n", strategy: "fixed" }
    );

    const longText = "A. ".repeat(30); // 90 characters
    const ids = await engine.index(longText);
    expect(ids.length).toBeGreaterThan(1);
    expect(ids.length).toBeLessThanOrEqual(3);

    store.dispose();
  });

  it("sentence chunking splits at sentence boundaries", async () => {
    const store = new MemoryStore({ maxEntries: 100, autoCompact: false });
    const engine = new RAGEngine(
      store,
      { type: "memory", collectionName: "test", embeddingDimension: 4 },
      { maxChunkSize: 30, overlap: 0, separator: "\n", strategy: "sentence" }
    );

    const text = "First sentence. Second one. Third one here. Fourth.";
    const ids = await engine.index(text);
    expect(ids.length).toBeGreaterThanOrEqual(2);

    store.dispose();
  });
});

// ---------------------------------------------------------------------------
// cosineSimilarity standalone
// ---------------------------------------------------------------------------
describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 5);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });

  it("returns -1 for opposite vectors", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 5);
  });

  it("throws on dimension mismatch", () => {
    expect(() => cosineSimilarity([1], [1, 2])).toThrow("dimension mismatch");
  });
});

// ---------------------------------------------------------------------------
// TTL-based compaction
// ---------------------------------------------------------------------------
describe("TTL-based compaction", () => {
  it("removes expired entries on compact", async () => {
    const store = new MemoryStore({ maxEntries: 100, autoCompact: false });

    const entry1 = await store.add({
      type: "semantic",
      content: "Expired entry",
      metadata: {},
      ttl: 100, // 100ms TTL
    });

    const entry2 = await store.add({
      type: "semantic",
      content: "Permanent entry (no TTL)",
      metadata: {},
    });

    const entry3 = await store.add({
      type: "semantic",
      content: "Future entry",
      metadata: {},
      ttl: 10_000, // 10s TTL
    });

    expect((await store.list()).length).toBe(3);

    // Wait for entry1 to expire
    await new Promise((r) => setTimeout(r, 150));

    store.compact();

    const remaining = await store.list();
    expect(remaining.length).toBe(2);
    expect(remaining.find((e) => e.id === entry1.id)).toBeUndefined();
    expect(remaining.find((e) => e.id === entry2.id)).toBeDefined();
    expect(remaining.find((e) => e.id === entry3.id)).toBeDefined();

    store.dispose();
  });

  it("enforces maxEntries limit evicting oldest first", async () => {
    const store = new MemoryStore({ maxEntries: 5, autoCompact: false });

    // Add 10 entries
    for (let i = 0; i < 10; i++) {
      await store.add({
        type: "semantic",
        content: `Entry ${i}`,
        metadata: { index: i },
      });
      // Small delay to ensure different timestamps
      await new Promise((r) => setTimeout(r, 5));
    }

    expect((await store.list()).length).toBe(10);

    store.compact();

    // After compact, should have 5 entries
    const remaining = await store.list();
    expect(remaining.length).toBe(5);

    // The oldest 5 should be evicted (index 0-4)
    const remainingContent = remaining.map((e) => e.content).sort();
    expect(remainingContent).toEqual([
      "Entry 5",
      "Entry 6",
      "Entry 7",
      "Entry 8",
      "Entry 9",
    ]);

    store.dispose();
  });
});
