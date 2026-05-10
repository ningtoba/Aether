/**
 * Checkpoint management for LangGraph workflows.
 *
 * Wraps LangGraph's built-in checkpointer (MemorySaver) and adds
 * multi-backend support (in-memory, SQLite, configurable).
 *
 * @module @aether/orchestrator
 */

import { MemorySaver, BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import type { Checkpoint, CheckpointManager as CheckpointManagerInterface } from "./types.js";

// Re-export LangGraph checkpoint types so consumers don't need to
// import from both packages.
export { MemorySaver, BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
export type { CheckpointTuple, CheckpointMetadata } from "@langchain/langgraph-checkpoint";

/**
 * Creates a LangGraph-compatible saver from Aether's config.
 *
 * Default: MemorySaver (in-memory, ephemeral).
 * For persistence, pass a BaseCheckpointSaver instance.
 */
export function createCheckpointSaver(
  backend?: "memory" | "sqlite",
  config?: { dbPath?: string },
): BaseCheckpointSaver {
  switch (backend) {
    case "sqlite":
      // SQLite saver would be imported from @langchain/langgraph-checkpoint-sqlite
      // For now, fall through to memory.
      console.warn("[orchestrator] SQLite checkpoint backend not yet available; falling back to memory");
      return new MemorySaver();
    case "memory":
    default:
      return new MemorySaver();
  }
}

/**
 * In-memory implementation of the legacy CheckpointManager interface,
 * wrapping a BaseCheckpointSaver for compatibility with existing code.
 */
export class InMemoryCheckpointManager implements CheckpointManagerInterface {
  private checkpoints = new Map<string, Checkpoint[]>();

  async save(checkpoint: Checkpoint): Promise<void> {
    const existing = this.checkpoints.get(checkpoint.executionId) ?? [];
    const idx = existing.findIndex((c) => c.id === checkpoint.id);
    if (idx >= 0) {
      existing[idx] = checkpoint;
    } else {
      existing.push(checkpoint);
    }
    this.checkpoints.set(checkpoint.executionId, existing);
  }

  async get(executionId: string, checkpointId: string): Promise<Checkpoint | undefined> {
    const list = this.checkpoints.get(executionId);
    return list?.find((c) => c.id === checkpointId);
  }

  async list(executionId: string): Promise<Checkpoint[]> {
    return this.checkpoints.get(executionId) ?? [];
  }

  async delete(executionId: string, checkpointId: string): Promise<boolean> {
    const existing = this.checkpoints.get(executionId);
    if (!existing) return false;
    const idx = existing.findIndex((c) => c.id === checkpointId);
    if (idx < 0) return false;
    existing.splice(idx, 1);
    if (existing.length === 0) this.checkpoints.delete(executionId);
    return true;
  }

  clearExecution(executionId: string): void {
    this.checkpoints.delete(executionId);
  }

  get size(): number {
    let count = 0;
    for (const arr of this.checkpoints.values()) count += arr.length;
    return count;
  }

  clear(): void {
    this.checkpoints.clear();
  }
}
