/**
 * Configuration for the memory store.
 */
export interface MemoryConfig {
  /** Default per-tier capacity limits */
  maxEntries: number;
  /** Optional path for persistence (file-based stores) */
  persistencePath?: string;
  /** Whether to automatically compact entries */
  autoCompact: boolean;
  /** Time-to-live in milliseconds for entries (0 = no ttl) */
  defaultTtlMs: number;
}

/**
 * A single stored memory entry.
 */
export interface MemoryEntry {
  /** Unique identifier */
  id: string;
  /** Type / bucket for the entry */
  type: MemoryType;
  /** Raw content string */
  content: string;
  /** Arbitrary metadata */
  metadata: Record<string, unknown>;
  /** Unix timestamp (ms) of creation */
  timestamp: number;
  /** Time-to-live in ms, or undefined for no expiry */
  ttl?: number;
  /** Optional computed embedding vector */
  embedding?: number[];
  /** Source identifier (e.g. agent name, tool name) */
  source?: string;
}

/**
 * Supported memory type / bucket categories.
 */
export type MemoryType =
  | "episodic"
  | "semantic"
  | "task"
  | "conversation"
  | "graph";

/**
 * Query parameters for memory retrieval.
 */
export interface MemoryQuery {
  /** Search text (used for keyword / semantic matching) */
  query: string;
  /** Optional type filter */
  type?: MemoryType;
  /** Maximum number of results */
  limit: number;
  /** Relevance threshold (0–1) */
  threshold: number;
  /** Additional metadata filters */
  filter?: Record<string, unknown>;
}

/**
 * A search result with a relevance score.
 */
export interface MemorySearchResult {
  /** The matched entry */
  entry: MemoryEntry;
  /** Relevance score (0–1, higher is better) */
  score: number;
}

/**
 * Configuration for a vector store backend.
 */
export interface VectorStoreConfig {
  /** Backend type */
  type: "memory" | "sqlite" | "qdrant";
  /** Optional connection URL for remote stores */
  url?: string;
  /** Collection / table name */
  collectionName: string;
  /** Embedding vector dimension */
  embeddingDimension: number;
  /** Index type */
  indexType?: "hnsw" | "flat";
}

/**
 * Embedding provider configuration.
 */
export interface EmbeddingConfig {
  /** Provider name (e.g. "openai", "ollama") */
  provider: string;
  /** Model name (e.g. "text-embedding-3-small") */
  model: string;
  /** Vector dimension */
  dimension: number;
  /** Maximum batch size for embedding requests */
  batchSize: number;
  /** Maximum retries for failed requests */
  maxRetries: number;
}

/**
 * Document chunking configuration.
 */
export interface ChunkingConfig {
  /** Maximum characters per chunk */
  maxChunkSize: number;
  /** Overlap in characters between consecutive chunks */
  overlap: number;
  /** Delimiter for splitting */
  separator: string;
  /** Chunking strategy */
  strategy: "fixed" | "sentence" | "paragraph" | "semantic";
}
