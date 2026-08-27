import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MemoryStore } from './store.js';
import type { MemoryEntry, MemoryType } from './types.js';

describe('MemoryStore', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ maxEntries: 100, autoCompact: false, defaultTtlMs: 0 });
  });

  afterEach(() => {
    store.dispose();
  });

  describe('add', () => {
    it('should add an entry and return it with id and timestamp', async () => {
      const entry = await store.add({
        type: 'semantic',
        content: 'test content',
        metadata: {},
      });

      expect(entry.id).toBeDefined();
      expect(entry.id).toMatch(/^mem-/);
      expect(entry.timestamp).toBeGreaterThan(0);
      expect(entry.type).toBe('semantic');
      expect(entry.content).toBe('test content');
    });

    it('should respect a provided custom ID', async () => {
      const entry = await store.add({
        id: 'custom-id',
        type: 'task',
        content: 'custom',
        metadata: {},
      });

      expect(entry.id).toBe('custom-id');
    });

    it('should store source when provided', async () => {
      const entry = await store.add({
        type: 'episodic',
        content: 'with source',
        metadata: {},
        source: 'agent-alpha',
      });

      const retrieved = await store.get(entry.id);
      expect(retrieved?.source).toBe('agent-alpha');
    });
  });

  describe('get', () => {
    it('should retrieve an entry by id', async () => {
      const added = await store.add({ type: 'conversation', content: 'hello', metadata: {} });
      const retrieved = await store.get(added.id);

      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(added.id);
      expect(retrieved!.content).toBe('hello');
    });

    it('should return undefined for non-existent id', async () => {
      const result = await store.get('nonexistent');
      expect(result).toBeUndefined();
    });
  });

  describe('search', () => {
    beforeEach(async () => {
      await store.add({
        type: 'semantic',
        content: 'The sky is blue and clear',
        metadata: { topic: 'weather' },
      });
      await store.add({
        type: 'semantic',
        content: 'Machine learning is fascinating',
        metadata: { topic: 'ai' },
      });
      await store.add({
        type: 'task',
        content: 'Buy groceries: milk and eggs',
        metadata: { priority: 'high' },
      });
      await store.add({
        type: 'conversation',
        content: 'User asked about blue sky',
        metadata: { topic: 'weather' },
      });
    });

    it('should find entries by keyword matching', async () => {
      const results = await store.search({
        query: 'blue',
        type: undefined,
        limit: 10,
        threshold: 0,
      });
      expect(results.length).toBeGreaterThanOrEqual(2);
      expect(results.some((r) => r.entry.content.includes('blue'))).toBe(true);
    });

    it('should filter by type', async () => {
      const results = await store.search({
        query: '',
        type: 'task' as MemoryType,
        limit: 10,
        threshold: 0,
      });
      expect(results.length).toBe(1);
      expect(results[0].entry.type).toBe('task');
    });

    it('should filter by metadata', async () => {
      const results = await store.search({
        query: '',
        type: undefined,
        limit: 10,
        threshold: 0,
        filter: { topic: 'weather' },
      });
      expect(results.length).toBe(2);
    });

    it('should respect score threshold', async () => {
      const results = await store.search({
        query: 'sky blue weather',
        type: undefined,
        limit: 10,
        threshold: 0.5,
      });
      // Only entries matching at least half the query terms should appear
      expect(results.every((r) => r.score >= 0.5)).toBe(true);
    });

    it('should sort results by score descending', async () => {
      const results = await store.search({
        query: 'blue sky',
        type: undefined,
        limit: 10,
        threshold: 0,
      });
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });

    it('should limit results', async () => {
      // Add more entries to ensure we have enough
      for (let i = 0; i < 10; i++) {
        await store.add({ type: 'semantic', content: `entry ${i}`, metadata: {} });
      }
      const results = await store.search({
        query: 'entry',
        type: undefined,
        limit: 3,
        threshold: 0,
      });
      expect(results.length).toBeLessThanOrEqual(3);
    });
  });

  describe('delete', () => {
    it('should delete an existing entry and return true', async () => {
      const entry = await store.add({ type: 'semantic', content: 'delete me', metadata: {} });
      const deleted = await store.delete(entry.id);
      expect(deleted).toBe(true);

      const retrieved = await store.get(entry.id);
      expect(retrieved).toBeUndefined();
    });

    it('should return false for non-existent entry', async () => {
      const deleted = await store.delete('no-such-id');
      expect(deleted).toBe(false);
    });
  });

  describe('list', () => {
    it('should list all entries', async () => {
      await store.add({ type: 'semantic', content: 'a', metadata: {} });
      await store.add({ type: 'task', content: 'b', metadata: {} });

      const all = await store.list();
      expect(all.length).toBe(2);
    });

    it('should list entries filtered by type', async () => {
      await store.add({ type: 'semantic', content: 'a', metadata: {} });
      await store.add({ type: 'task', content: 'b', metadata: {} });
      await store.add({ type: 'task', content: 'c', metadata: {} });

      const tasks = await store.list('task' as MemoryType);
      expect(tasks.length).toBe(2);
      expect(tasks.every((e) => e.type === 'task')).toBe(true);
    });

    it('should return empty array when no entries match type', async () => {
      const result = await store.list('graph' as MemoryType);
      expect(result).toEqual([]);
    });
  });

  describe('stats', () => {
    it('should return total entry count and breakdown by type', async () => {
      await store.add({ type: 'semantic', content: 's1', metadata: {} });
      await store.add({ type: 'semantic', content: 's2', metadata: {} });
      await store.add({ type: 'task', content: 't1', metadata: {} });

      const s = await store.stats();
      expect(s.totalEntries).toBe(3);
      expect(s.byType.semantic).toBe(2);
      expect(s.byType.task).toBe(1);
    });

    it('should return zero stats for empty store', async () => {
      const s = await store.stats();
      expect(s.totalEntries).toBe(0);
      expect(s.byType).toEqual({});
    });
  });

  describe('compact', () => {
    it('should remove expired entries based on TTL', async () => {
      // Add an entry with a TTL of 1ms, then wait for it to expire
      const expiredEntry = await store.add({
        type: 'semantic',
        content: 'old',
        metadata: {},
        ttl: 1,
      });

      const freshEntry = await store.add({
        type: 'semantic',
        content: 'fresh',
        metadata: {},
        ttl: 100_000,
      });

      // Wait for TTL to pass
      await new Promise((resolve) => setTimeout(resolve, 5));

      store.compact();

      const oldCheck = await store.get(expiredEntry.id);
      const freshCheck = await store.get(freshEntry.id);
      expect(oldCheck).toBeUndefined();
      expect(freshCheck).toBeDefined();
    });

    it('should evict oldest entries when over max capacity', async () => {
      const smallStore = new MemoryStore({ maxEntries: 3, autoCompact: false, defaultTtlMs: 0 });

      // Add 4 entries
      const e1 = await smallStore.add({ type: 'semantic', content: '1', metadata: {} });
      const e2 = await smallStore.add({ type: 'semantic', content: '2', metadata: {} });
      const e3 = await smallStore.add({ type: 'semantic', content: '3', metadata: {} });
      const e4 = await smallStore.add({ type: 'semantic', content: '4', metadata: {} });

      smallStore.compact();

      // Oldest (e1) should be evicted
      expect(await smallStore.get(e1.id)).toBeUndefined();
      expect(await smallStore.get(e4.id)).toBeDefined();
      expect(await smallStore.get(e3.id)).toBeDefined();

      smallStore.dispose();
    });

    it('should be harmless on empty store', () => {
      expect(() => store.compact()).not.toThrow();
    });
  });

  describe('dispose', () => {
    it('should clear all entries', async () => {
      await store.add({ type: 'semantic', content: 'x', metadata: {} });
      store.dispose();

      const all = await store.list();
      expect(all.length).toBe(0);
    });

    it('should be safe to call multiple times', () => {
      store.dispose();
      store.dispose(); // should not throw
    });
  });
});
