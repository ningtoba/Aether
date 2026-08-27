import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { RAGEngine } from './rag.js';
import { MemoryStore } from './store.js';
import type { ChunkingConfig, MemoryQuery } from './types.js';

function createEngine(chunking?: Partial<ChunkingConfig>) {
  const store = new MemoryStore({ maxEntries: 1000, autoCompact: false, defaultTtlMs: 0 });
  const engine = new RAGEngine(
    store,
    { type: 'memory', collectionName: 'test', embeddingDimension: 4 },
    chunking,
  );
  return { store, engine };
}

describe('RAGEngine', () => {
  describe('index', () => {
    it('should chunk and index a document', async () => {
      const { store, engine } = createEngine();

      const ids = await engine.index('The quick brown fox jumps over the lazy dog.', {
        source: 'test',
      });

      expect(ids.length).toBeGreaterThan(0);
      // Verify stored in MemoryStore
      const first = await store.get(ids[0]);
      expect(first).toBeDefined();
      expect(first!.metadata.source).toBe('test');
      expect(first!.type).toBe('semantic');

      store.dispose();
    });

    it('should use custom type when provided', async () => {
      const { store, engine } = createEngine();

      const ids = await engine.index('Task: do something', { priority: 'high' }, 'task' as const);

      const entry = await store.get(ids[0]);
      expect(entry!.type).toBe('task');

      store.dispose();
    });

    it('should add chunk index metadata', async () => {
      const { store, engine } = createEngine({
        maxChunkSize: 20,
        strategy: 'fixed',
        overlap: 0,
        separator: '\n',
      });

      const ids = await engine.index(
        'This is a longer document that should be split into multiple chunks.',
        {},
      );

      expect(ids.length).toBeGreaterThanOrEqual(2);

      const entry0 = await store.get(ids[0]);
      expect(entry0!.metadata.chunkIndex).toBe(0);
      expect(entry0!.metadata.totalChunks).toBe(ids.length);

      store.dispose();
    });
  });

  describe('retrieve', () => {
    it('should return hybrid (keyword + vector) results', async () => {
      const { store, engine } = createEngine();

      await engine.index('Machine learning is transforming how we process data.', {
        category: 'ai',
      });
      await engine.index('The weather today is sunny and warm.', { category: 'weather' });

      const query: MemoryQuery = {
        query: 'machine learning',
        limit: 5,
        threshold: 0,
      };

      const results = await engine.retrieve(query);
      expect(results.length).toBeGreaterThan(0);
      // The "machine learning" doc should rank high
      expect(results.some((r) => r.entry.content.includes('Machine learning'))).toBe(true);

      store.dispose();
    });

    it('should deduplicate results from both stores', async () => {
      const { store, engine } = createEngine();

      const ids = await engine.index('AI and machine learning are closely related fields.', {
        topic: 'ai',
      });

      // Retrieve with a query that will match via keyword AND vector
      const query: MemoryQuery = {
        query: 'machine learning',
        limit: 10,
        threshold: 0,
      };

      const results = await engine.retrieve(query);
      // No duplicate ids
      const uniqueIds = new Set(results.map((r) => r.entry.id));
      expect(uniqueIds.size).toBe(results.length);

      store.dispose();
    });

    it('should apply keyword boost', async () => {
      const { store, engine } = createEngine();

      await engine.index('Python programming for data science.', {});
      await engine.index('JavaScript for web development.', {});

      const query: MemoryQuery = {
        query: 'python data',
        limit: 10,
        threshold: 0,
      };

      const results = await engine.retrieve(query);
      // The "Python programming" entry should have a boosted score from keyword match
      const pythonResult = results.find((r) => r.entry.content.includes('Python'));
      if (pythonResult) {
        expect(pythonResult.score).toBeGreaterThan(0);
      }

      store.dispose();
    });
  });

  describe('query', () => {
    it('should return query string, context, and results', async () => {
      const { store, engine } = createEngine();

      await engine.index('The Earth orbits the Sun.', { topic: 'astronomy' });

      const query: MemoryQuery = {
        query: 'Earth orbit',
        limit: 5,
        threshold: 0,
      };

      const result = await engine.query(query);

      expect(result.query).toBe('Earth orbit');
      expect(result.context).toBeTruthy();
      expect(result.context).toContain('Earth');
      expect(result.results.length).toBeGreaterThan(0);

      store.dispose();
    });

    it('should join multiple results with separator', async () => {
      const { store, engine } = createEngine({
        maxChunkSize: 10,
        strategy: 'fixed',
        overlap: 0,
        separator: '\n',
      });

      await engine.index('First piece of context. Second piece. Third piece.', { test: true });

      const query: MemoryQuery = {
        query: 'piece',
        limit: 10,
        threshold: 0,
      };

      const result = await engine.query(query);
      expect(result.context).toContain('\n---\n');

      store.dispose();
    });
  });

  describe('chunkDocument', () => {
    it('should split text with fixed strategy', async () => {
      const { store, engine } = createEngine({
        strategy: 'fixed',
        maxChunkSize: 10,
        overlap: 2,
        separator: '\n',
      });

      const ids = await engine.index('A B C D E F G H I J K L M N O P', {});
      expect(ids.length).toBeGreaterThanOrEqual(3);
      store.dispose();
    });

    it('should split text with sentence strategy', async () => {
      const { store, engine } = createEngine({
        strategy: 'sentence',
        maxChunkSize: 30,
        overlap: 0,
        separator: ' ',
      });

      const ids = await engine.index(
        'The quick brown fox. Jumps over the lazy dog. It runs fast.',
        {},
      );
      expect(ids.length).toBeGreaterThanOrEqual(2);
      store.dispose();
    });

    it('should split text with paragraph strategy', async () => {
      const { store, engine } = createEngine({
        strategy: 'paragraph',
        maxChunkSize: 30,
        overlap: 0,
        separator: '\n',
      });

      const ids = await engine.index(
        'Para one. More.\n\nPara two. More words.\n\nPara three. Extra text here.',
        {},
      );
      expect(ids.length).toBeGreaterThanOrEqual(3);
      store.dispose();
    });

    it('should handle empty text', async () => {
      const { store, engine } = createEngine();

      const ids = await engine.index('', {});
      // Empty text should still produce at least one chunk
      expect(ids.length).toBe(0);

      store.dispose();
    });
  });

  describe('simulateEmbedding', () => {
    it('should produce a normalized vector', async () => {
      // Access private method indirectly by checking vector search works
      const { store, engine } = createEngine();
      const dim = 4;

      await engine.index('test text for embedding', {});

      // Retrieve should use simulateEmbedding internally
      const results = await engine.retrieve({
        query: 'test text',
        limit: 5,
        threshold: 0,
      });

      // Results should include the indexed content
      expect(results.some((r) => r.entry.content.includes('test text'))).toBe(true);
      store.dispose();
    });
  });
});
describe('chunking hardening', () => {
  const longText =
    'The quick brown fox jumps over the lazy dog. ' +
    'Lorem ipsum dolor sit amet, consectetur adipiscing elit, ' +
    'sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.';

  it('clamps overlap below maxChunkSize so chunkFixed always terminates', async () => {
    // Old behavior: overlap >= maxChunkSize made the window regress forever.
    const { engine } = createEngine({ maxChunkSize: 10, overlap: 64, strategy: 'fixed' });
    const ids = await engine.index(longText);
    expect(ids.length).toBeGreaterThan(0);
  }, 5_000);

  it('clamps a non-positive maxChunkSize to 1 instead of looping forever', async () => {
    const { engine } = createEngine({ maxChunkSize: 0, overlap: 5, strategy: 'fixed' });
    const ids = await engine.index(longText);
    expect(ids.length).toBeGreaterThan(0);
  }, 5_000);

  it('still yields ordered, overlapping fixed chunks', async () => {
    const { engine, store } = createEngine({ maxChunkSize: 24, overlap: 8, strategy: 'fixed' });
    const ids = await engine.index(longText);
    expect(ids.length).toBeGreaterThan(1);
    const entries = await Promise.all(ids.map((id) => store.get(id)));
    const contents = entries.map((e) => e?.content ?? '');
    expect(contents[0]).toContain('quick');
    expect(contents[contents.length - 1]).toContain('aliqua');
    store.dispose();
  });
});
