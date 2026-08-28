import { describe, it, expect } from 'vitest';
import { InMemoryStore } from './InMemoryStore.js';
import type { MemoryScope } from './scoped-types.js';

describe('InMemoryStore', () => {
  it('enforces the one-store-per-scope contract on write', async () => {
    const store = new InMemoryStore('episodic');
    await expect(
      store.write({
        scope: 'semantic' as MemoryScope,
        content: 'wrong scope',
        metadata: {},
        status: 'active',
      }),
    ).rejects.toThrow(/does not match store scope "episodic"/);
  });

  it('reads back its own scope entries and never surfaces foreign rows', async () => {
    const store = new InMemoryStore('episodic');
    const written = await store.write({
      scope: 'episodic',
      content: 'mine',
      metadata: {},
      status: 'active',
    });
    expect((await store.read(written.id))?.content).toBe('mine');

    // Defense in depth: even if a foreign row exists in the map, every read
    // path must filter to this store's scope.
    (store as unknown as { entries: Map<string, unknown> }).entries.set('foreign', {
      id: 'foreign',
      scope: 'semantic',
      content: 'theirs',
      metadata: {},
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const results = await store.query({});
    expect(results.map((r) => r.entry.id)).toContain(written.id);
    expect(results.map((r) => r.entry.id)).not.toContain('foreign');
    expect(await store.read('foreign')).toBeNull();
    expect(await store.count()).toBe(1);
  });

  it('returns no results for a whitespace-only text query', async () => {
    const store = new InMemoryStore('episodic');
    await store.write({
      scope: 'episodic',
      content: 'sky is blue',
      metadata: {},
      status: 'active',
    });
    expect(await store.query({ text: '   ' })).toEqual([]);
  });
});
