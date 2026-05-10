import type { Checkpoint, CheckpointManager } from "./types.js";

/**
 * In-memory implementation of CheckpointManager.
 *
 * Stores checkpoints in a Map keyed by executionId, with a secondary
 * index for listing. Checkpoints are ephemeral — lost on process restart.
 */
export class InMemoryCheckpointManager implements CheckpointManager {
  private store = new Map<string, Checkpoint[]>();

  async save(checkpoint: Checkpoint): Promise<void> {
    const existing = this.store.get(checkpoint.executionId) ?? [];
    // Replace if same id exists
    const idx = existing.findIndex((c) => c.id === checkpoint.id);
    if (idx >= 0) {
      existing[idx] = checkpoint;
    } else {
      existing.push(checkpoint);
    }
    this.store.set(checkpoint.executionId, existing);
  }

  async get(executionId: string, checkpointId: string): Promise<Checkpoint | undefined> {
    const checkpoints = this.store.get(executionId);
    if (!checkpoints) return undefined;
    return checkpoints.find((c) => c.id === checkpointId);
  }

  async list(executionId: string): Promise<Checkpoint[]> {
    return this.store.get(executionId) ?? [];
  }

  async delete(executionId: string, checkpointId: string): Promise<boolean> {
    const existing = this.store.get(executionId);
    if (!existing) return false;
    const idx = existing.findIndex((c) => c.id === checkpointId);
    if (idx < 0) return false;
    existing.splice(idx, 1);
    if (existing.length === 0) this.store.delete(executionId);
    return true;
  }

  /** Remove all checkpoints for an execution */
  clearExecution(executionId: string): void {
    this.store.delete(executionId);
  }

  /** Total checkpoint count across all executions */
  get size(): number {
    const entries = Array.from(this.store.values());
    let count = 0;
    for (const arr of entries) count += arr.length;
    return count;
  }

  /** Remove all data */
  clear(): void {
    this.store.clear();
  }
}
