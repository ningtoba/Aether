/**
 * @aether/memory — Memory management system.
 *
 * Provides an in-memory memory store with tag/bucket organisation,
 * a pure-JS vector store for similarity search, and a RAG engine
 * for document chunking, indexing, and hybrid retrieval.
 *
 * @module @aether/memory
 */

export { MemoryStore } from "./store.js";
export { InMemoryVectorStore, cosineSimilarity } from "./vector.js";
export type { VectorStore } from "./vector.js";
export { RAGEngine } from "./rag.js";

export type {
  MemoryConfig,
  MemoryEntry,
  MemoryQuery,
  MemorySearchResult,
  MemoryType,
  VectorStoreConfig,
  EmbeddingConfig,
  ChunkingConfig,
} from "./types.js";
