/**
 * @aether/memory — Memory management system.
 *
 * Provides an in-memory memory store with tag/bucket organisation,
 * a pure-JS vector store for similarity search, and a RAG engine
 * for document chunking, indexing, and hybrid retrieval.
 *
 * Also includes scope-based memory stores (episodic, semantic, task,
 * conversation) and a generic IVectorStore interface.
 *
 * @module @aether/memory
 */

export { MemoryStore } from './store.js';
export { InMemoryVectorStore, cosineSimilarity } from './vector.js';
export type { VectorStore } from './vector.js';
export { RAGEngine } from './rag.js';

export type {
  MemoryConfig,
  MemoryEntry,
  MemoryQuery,
  MemorySearchResult,
  MemoryType,
  VectorStoreConfig,
  EmbeddingConfig,
  ChunkingConfig,
} from './types.js';

// Scoped memory stores (ported from @aether/memory-old)
export type { IMemoryStore } from './IMemoryStore.js';
export { InMemoryStore } from './InMemoryStore.js';
export { EpisodicStore, SemanticStore, TaskStore, ConversationStore } from './scoped-stores.js';
export type { IVectorStore } from './IVectorStore.js';
export { MemoryVectorStore } from './MemoryVectorStore.js';
export type {
  MemoryScope,
  MemoryStatus,
  ScopedMemoryEntry,
  ScopedMemoryQuery,
  ScopedMemoryQueryResult,
  IndexedEntry,
} from './scoped-types.js';
