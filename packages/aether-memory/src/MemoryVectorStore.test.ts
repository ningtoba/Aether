import { describe, it, expect } from 'vitest';
import { MemoryVectorStore } from './MemoryVectorStore.js';

describe('MemoryVectorStore', () => {
  it('scores matching vectors by cosine similarity', async () => {
    const store = new MemoryVectorStore();
    await store.upsert({ id: 'a', vector: new Float64Array([1, 0, 0, 0]), metadata: {} });

    const matched = await store.search(new Float64Array([1, 0, 0, 0]), { limit: 10 });
    expect(matched).toEqual([{ id: 'a', score: 1 }]);
  });

  it('treats a dimension-mismatched query as non-similar instead of NaN', async () => {
    const store = new MemoryVectorStore();
    await store.upsert({ id: 'a', vector: new Float64Array([1, 0, 0, 0]), metadata: {} });

    // 3-dim query against 4-dim vectors: the score must be a finite number
    // (0 = not similar), never NaN that silently drops the result.
    const byScore = await store.search(new Float64Array([1, 0, 0]), { limit: 10, minScore: -1 });
    expect(byScore).toHaveLength(1);
    expect(byScore[0].score).toBe(0);
    expect(Number.isNaN(byScore[0].score)).toBe(false);
  });
});
describe('MemoryVectorStore search edge cases', () => {
  it('clamps a negative limit to an empty result set instead of all-but-last', async () => {
    const store = new MemoryVectorStore();
    await store.upsert({ id: 'a', vector: new Float64Array([1, 0, 0, 0]), metadata: {} });
    await store.upsert({ id: 'b', vector: new Float64Array([0, 1, 0, 0]), metadata: {} });
    await store.upsert({ id: 'c', vector: new Float64Array([0, 0, 1, 0]), metadata: {} });
    expect(await store.search(new Float64Array([1, 0, 0, 0]), { limit: -1 })).toEqual([]);
  });

  it('returns no results for an all-zero (degenerate) query', async () => {
    const store = new MemoryVectorStore();
    await store.upsert({ id: 'a', vector: new Float64Array([1, 0, 0, 0]), metadata: {} });
    expect(await store.search(new Float64Array([0, 0, 0, 0]), { limit: 10 })).toEqual([]);
  });
});
