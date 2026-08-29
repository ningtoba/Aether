/**
 * @aether/types - Base/shared types
 *
 * Common enums, utilities, and foundational types used across all domains.
 */

// ─── Identifiers ───────────────────────────────────────────

/** UUID v4 string pattern */
export type UUID = string & { __brand: 'UUID' };

/** Semantic version string (e.g. "0.1.0") */
export type SemVer = string & { __brand: 'SemVer' };

/** ISO-8601 timestamp string */
export type Timestamp = string & { __brand: 'Timestamp' };

/** Arbitrary JSON-serialisable value */
export type JSONValue =
  | string
  | number
  | boolean
  | null
  | JSONValue[]
  | { [key: string]: JSONValue };

/** A JSON-serialisable record */
export type JSONObject = Record<string, JSONValue>;

// ─── Enums ─────────────────────────────────────────────────

export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  FATAL = 'fatal',
}

export enum Status {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  SKIPPED = 'skipped',
  BLOCKED = 'blocked',
}

// ─── Metadata ──────────────────────────────────────────────

/** Arbitrary key-value metadata attached to any entity */
export interface Metadata {
  [key: string]: JSONValue;
}

/** Resource consumption / usage metrics */
export interface UsageMetrics {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  durationMs: number;
  costUsd?: number;
  /** Additional provider-specific metrics */
  extra?: Metadata;
}

/** A single log entry */
export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: Timestamp;
  source?: string;
  data?: JSONObject;
}

// ─── Error handling ────────────────────────────────────────

export interface ErrorDetails {
  code: string;
  message: string;
  /** Machine-readable error category */
  category: ErrorCategory;
  /** Stack trace if available */
  stack?: string;
  /** Recovery hint */
  retryable: boolean;
  /** Nested cause */
  cause?: ErrorDetails;
}

export enum ErrorCategory {
  VALIDATION = 'validation',
  AUTHENTICATION = 'authentication',
  AUTHORIZATION = 'authorization',
  TIMEOUT = 'timeout',
  RATE_LIMIT = 'rate_limit',
  NOT_FOUND = 'not_found',
  PROVIDER_ERROR = 'provider_error',
  INTERNAL = 'internal',
  RESOURCE_EXHAUSTED = 'resource_exhausted',
  UNKNOWN = 'unknown',
}

// ─── Pagination ────────────────────────────────────────────

export interface PaginationParams {
  limit: number;
  offset?: number;
  cursor?: string;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  nextCursor?: string;
  hasMore: boolean;
}
