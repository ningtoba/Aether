import { InMemoryStore } from "./InMemoryStore.js";
import { type IMemoryStore } from "./IMemoryStore.js";

/** Episodic store: experiences, events, observations. */
export class EpisodicStore extends InMemoryStore implements IMemoryStore {
  constructor() {
    super("episodic");
  }
}
