/**
 * @aether/providers - Vault Fallback
 *
 * JSON-file-based credential storage for when keytar is unavailable.
 * Stores passwords in ~/.aether/keychain.json (plain JSON — no encryption,
 * suitable for development and headless environments).
 *
 * Intended as a drop-in replacement for the `keytar` module interface:
 *   { getPassword, setPassword, deletePassword, findCredentials }
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ── Paths ──────────────────────────────────────────────────────────

const KEYCHAIN_DIR = join(homedir(), ".aether");
const KEYCHAIN_PATH = join(KEYCHAIN_DIR, "keychain.json");

// ── Store helpers ──────────────────────────────────────────────────

interface KeychainStore {
  [key: string]: string; // `${service}:${account}` -> password
}

function ensureDir(): void {
  if (!existsSync(KEYCHAIN_DIR)) {
    mkdirSync(KEYCHAIN_DIR, { recursive: true });
  }
}

function readStore(): KeychainStore {
  if (!existsSync(KEYCHAIN_PATH)) {
    return {};
  }
  try {
    const raw = readFileSync(KEYCHAIN_PATH, "utf8");
    return JSON.parse(raw) as KeychainStore;
  } catch {
    return {};
  }
}

function writeStore(store: KeychainStore): void {
  ensureDir();
  writeFileSync(KEYCHAIN_PATH, JSON.stringify(store, null, 2), "utf8");
}

// ── keytar-compatible API ──────────────────────────────────────────

async function getPassword(
  service: string,
  account: string,
): Promise<string | null> {
  const store = readStore();
  const key = `${service}:${account}`;
  return store[key] ?? null;
}

async function setPassword(
  service: string,
  account: string,
  password: string,
): Promise<void> {
  const store = readStore();
  store[`${service}:${account}`] = password;
  writeStore(store);
}

async function deletePassword(
  service: string,
  account: string,
): Promise<boolean> {
  const store = readStore();
  const key = `${service}:${account}`;
  if (!(key in store)) return false;
  delete store[key];
  writeStore(store);
  return true;
}

async function findCredentials(
  service: string,
): Promise<Array<{ account: string; password: string }>> {
  const store = readStore();
  const prefix = `${service}:`;
  const results: Array<{ account: string; password: string }> = [];
  for (const [key, password] of Object.entries(store)) {
    if (key.startsWith(prefix)) {
      results.push({ account: key.slice(prefix.length), password });
    }
  }
  return results;
}

// ── Export ─────────────────────────────────────────────────────────

export default {
  getPassword,
  setPassword,
  deletePassword,
  findCredentials,
};
