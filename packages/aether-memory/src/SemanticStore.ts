import { InMemoryStore } from './InMemoryStore.js';
import type { IMemoryStore } from './IMemoryStore.js';

/** Semantic store: facts, knowledge, concepts. */
export class SemanticStore extends InMemoryStore implements IMemoryStore {
  constructor() {
    super('semantic');
  }
}
