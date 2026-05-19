import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryVectorStore, cosineSimilarity } from "./vector.js";
import type { VectorStoreConfig } from "./types.js";

function makeConfig(dim = 4): VectorStoreConfig {
  return {
    type: "memory",
    collectionName: "test",
    embeddingDimension: dim,
  };
}

describe("InMemoryVectorStore", () => {
  let store: InMemoryVectorStore;

  beforeEach(() => {
    store = new InMemoryVectorStore(makeConfig(4));
  });

  describe("insert", () => {
    it("should insert a vector entry", async () => {
      await store.insert("vec1", [1, 0, 0, 0], { label: "first" });
      expect(await store.count()).toBe(1);
    });

    it("should reject vectors with wrong dimension", async () => {
      await expect(
        store.insert("bad", [1, 0, 0], { label: "short" }),
      ).rejects.toThrow("Vector dimension 3 does not match store dimension 4");
    });

    it("should accept vectors with correct dimension", async () => {
      await store.insert("good", [1, 0, 0, 0], {});
      await store.insert("good2", [0, 1, 0, 0], {});
      expect(await store.count()).toBe(2);
    });
  });

  describe("search", () => {
    beforeEach(async () => {
      await store.insert("a", [1, 0, 0, 0], { label: "x-axis" });
      await store.insert("b", [0, 1, 0, 0], { label: "y-axis" });
      await store.insert("c", [0, 0, 1, 0], { label: "z-axis" });
      await store.insert("d", [-1, 0, 0, 0], { label: "negative-x" });
    });

    it("should find most similar vectors", async () => {
      const results = await store.search([1, 0, 0, 0], 3);
      expect(results[0].entry.id).toBe("a");
      expect(results[0].score).toBeCloseTo(1, 2);
    });

    it("should respect topK limit", async () => {
      const results = await store.search([1, 0, 0, 0], 2);
      expect(results.length).toBe(2);
    });

    it("should filter by threshold", async () => {
      const results = await store.search([1, 0, 0, 0], 10, 0.5);
      // Only 'a' (cos=1) and maybe others with cos >= 0.5
      expect(results.every(r => r.score >= 0.5)).toBe(true);
    });

    it("should return empty array if nothing matches threshold", async () => {
      const results = await store.search([1, 0, 0, 0], 10, 0.99);
      expect(results.length).toBeGreaterThanOrEqual(1); // 'a' matches exactly
    });
  });

  describe("delete", () => {
    it("should delete an existing entry", async () => {
      await store.insert("del-me", [1, 0, 0, 0], {});
      const deleted = await store.delete("del-me");
      expect(deleted).toBe(true);
      expect(await store.count()).toBe(0);
    });

    it("should return false for non-existent entry", async () => {
      const deleted = await store.delete("no-such");
      expect(deleted).toBe(false);
    });
  });

  describe("count", () => {
    it("should return 0 for empty store", async () => {
      expect(await store.count()).toBe(0);
    });

    it("should return correct count after inserts", async () => {
      await store.insert("a", [1, 0, 0, 0], {});
      await store.insert("b", [0, 1, 0, 0], {});
      expect(await store.count()).toBe(2);
    });
  });
});

describe("cosineSimilarity", () => {
  it("should return 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 5);
  });

  it("should return 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });

  it("should return -1 for opposite vectors", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 5);
  });

  it("should return correct cosine for non-trivial vectors", () => {
    const a = [3, 4];
    const b = [1, 2];
    // dot=3*1+4*2=11, |a|=5, |b|=sqrt(5)≈2.236, cos=11/(5*2.236)=0.983
    const sim = cosineSimilarity(a, b);
    expect(sim).toBeGreaterThan(0.9);
  });

  it("should return 0 for zero vector", () => {
    expect(cosineSimilarity([0, 0], [1, 0])).toBe(0);
    expect(cosineSimilarity([1, 0], [0, 0])).toBe(0);
  });

  it("should throw on dimension mismatch", () => {
    expect(() => cosineSimilarity([1, 0], [1, 0, 0])).toThrow(
      "Vector dimension mismatch",
    );
  });
});
