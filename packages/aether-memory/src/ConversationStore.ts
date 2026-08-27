import { InMemoryStore } from './InMemoryStore.js';
import type { IMemoryStore } from './IMemoryStore.js';

/** Conversation store: chat message history. */
export class ConversationStore extends InMemoryStore implements IMemoryStore {
  constructor() {
    super('conversation');
  }
}
