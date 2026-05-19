import { InMemoryStore } from "./InMemoryStore.js";
import type { IMemoryStore } from "./IMemoryStore.js";

/** Task store: working context, intermediate state, task-relevant memory. */
export class TaskStore extends InMemoryStore implements IMemoryStore {
  constructor() {
    super("task");
  }
}
