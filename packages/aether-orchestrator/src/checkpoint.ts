import type { Checkpoint, WorkflowState, EdgeDefinition } from "./types.js";
import type { Metadata } from "@aether/types";

/**
 * Interface for checkpoint storage backends.
 */
export interface CheckpointManager {
  /**
   * Persist a state snapshot as a checkpoint.
   * Returns the created Checkpoint with a generated id.
   */
  save(state: WorkflowState, pendingEdges: EdgeDefinition[], metadata?: Metadata): Promise<Checkpoint>;

  /**
   * Load a specific checkpoint by id.
   * Returns undefined if no checkpoint with that id exists.
   */
  load(id: string): Promise<Checkpoint | undefined>;

  /**
   * List all checkpoints for a given run, most recent first.
   */
  list(runId: string): Promise<Checkpoint[]>;
}

/**
 * In-memory implementation of CheckpointManager.
 * Checkpoints are held in a Map and are lost on process restart.
 */
export class InMemoryCheckpointManager implements CheckpointManager {
  private checkpoints: Map<string, Checkpoint> = new Map();
  private counter = 0;

  async save(
    state: WorkflowState,
    pendingEdges: EdgeDefinition[],
    metadata?: Metadata,
  ): Promise<Checkpoint> {
    const id = `cp-${Date.now()}-${++this.counter}`;
    const checkpoint: Checkpoint = {
      id,
      runId: state.runId,
      state: { ...state },
      pendingEdges: [...pendingEdges],
      timestamp: Date.now(),
      metadata: metadata ?? {},
    };
    this.checkpoints.set(id, checkpoint);
    return checkpoint;
  }

  async load(id: string): Promise<Checkpoint | undefined> {
    return this.checkpoints.get(id);
  }

  async list(runId: string): Promise<Checkpoint[]> {
    const results = Array.from(this.checkpoints.values()).filter(
      (cp) => cp.runId === runId,
    );
    // Most recent first
    results.sort((a, b) => b.timestamp - a.timestamp);
    return results;
  }
}
