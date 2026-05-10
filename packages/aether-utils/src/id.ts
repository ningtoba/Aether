import { randomUUID } from "node:crypto";

/** Generates a unique ID with optional prefix */
export function generateId(prefix: string = "aether"): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

/** Generates a short unique ID suitable for tracing */
export function generateShortId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 8);
}

/** Validates that a string looks like a generated Aether ID */
export function isValidId(id: string): boolean {
  return /^[a-z0-9]+_[a-f0-9]{16,32}$/.test(id);
}
