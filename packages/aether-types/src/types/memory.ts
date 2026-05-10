/** Memory entry identification */
export type MemoryId = string & { readonly __brand: "MemoryId" };

/** Type of memory storage */
export type MemoryType =
  | "episodic"
  | "semantic"
  | "task"
  | "conversation"
  | "graph";

/** A single memory entry stored in the system */
export interface MemoryEntry {
  id: MemoryId;
  type: MemoryType;
  content: string;
  metadata: Record<string, unknown>;
  timestamp: number;
  ttl?: number;
  embedding?: number[];
  source?: string;
}

/** Query parameters for memory retrieval */
export interface MemoryQuery {
  query: string;
  type?: MemoryType;
  limit: number;
  threshold: number;
  filter?: Record<string, unknown>;
}

/** A memory search result with relevance score */
export interface MemorySearchResult {
  entry: MemoryEntry;
  score: number;
}

/** Configuration for a vector store backend */
export interface VectorStoreConfig {
  type: "qdrant" | "sqlite" | "memory";
  url?: string;
  collectionName: string;
  embeddingDimension: number;
  indexType?: "hnsw" | "flat";
}

/** Memory store statistics */
export interface MemoryStats {
  totalEntries: number;
  byType: Record<MemoryType, number>;
  storageSize: number;
  lastCompaction: number;
  averageLatency: number;
}

/** Chunking configuration for large documents */
export interface ChunkingConfig {
  maxChunkSize: number;
  overlap: number;
  separator: string;
  strategy: "fixed" | "sentence" | "paragraph" | "semantic";
}

/** Memory summarization request */
export interface SummarizationRequest {
  entryIds: MemoryId[];
  maxLength: number;
  format: "bullet" | "paragraph" | "json";
}

/** RAG (Retrieval Augmented Generation) configuration */
export interface RAGConfig {
  enabled: boolean;
  chunking: ChunkingConfig;
  topK: number;
  minScore: number;
  rerankEnabled: boolean;
  hybridSearch: boolean;
}

/** Embedding provider configuration */
export interface EmbeddingConfig {
  provider: string;
  model: string;
  dimension: number;
  batchSize: number;
  maxRetries: number;
}
