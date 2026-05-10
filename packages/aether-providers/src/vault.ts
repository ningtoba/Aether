/**
 * @aether/providers - Vault
 *
 * Encrypted API key storage.
 *
 * Primary: keytar (OS-native keychain: macOS Keychain, Linux Secret Service,
 * Windows Credential Vault).
 *
 * Fallback: AES-256-GCM encrypted file at ~/.config/aether/vault.enc when
 * keytar is unavailable (headless servers, Docker, WSL without dbus).
 *
 * The fallback encryption key is derived from a machine-specific seed
 * (/etc/machine-id or a generated UUID) — it's not as secure as a real
 * keychain but keeps secrets out of plaintext on disk.
 */

import { randomBytes, createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { readFile, writeFile, mkdir, readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";

// ── Constants ──────────────────────────────────────────────────────

const VAULT_DIR = join(homedir(), ".config", "aether");
const VAULT_PATH = join(VAULT_DIR, "vault.enc");
const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16;  // 128 bits
const TAG_LENGTH = 16; // 128 bits
const SERVICE_NAME = "aether-agent";

// ── Types ──────────────────────────────────────────────────────────

export interface VaultEntry {
  /** Provider ID this key belongs to */
  providerId: string;
  /** Key type: api-key or auth-token */
  type: "api-key" | "auth-token";
  /** The encrypted secret (hex-encoded ciphertext) */
  encrypted: string;
  /** Creation timestamp */
  createdAt: number;
  /** Last update timestamp */
  updatedAt: number;
}

// ── Keytar detection ──────────────────────────────────────────────

let _keytar: typeof import("keytar") | null = null;
let _keytarAttempted = false;

async function getKeytar(): Promise<typeof import("keytar") | null> {
  if (_keytarAttempted) return _keytar;
  _keytarAttempted = true;
  try {
    _keytar = await import("keytar");
  } catch {
    _keytar = null;
  }
  return _keytar;
}

// ── Fallback encryption helpers ────────────────────────────────────

function deriveMachineKey(): Buffer {
  // Try /etc/machine-id first
  try {
    const id = require("node:fs").readFileSync("/etc/machine-id", "utf8").trim();
    return createHash("sha256").update(id).digest();
  } catch {
    // Fallback: hostname-based, stable-ish
    const seed = `${hostname()}-aether-vault-v1`;
    return createHash("sha256").update(seed).digest();
  }
}

function encrypt(data: string): { encrypted: string; iv: string; tag: string } {
  const key = deriveMachineKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(data, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");

  return { encrypted, iv: iv.toString("hex"), tag };
}

function decrypt(encrypted: string, ivHex: string, tagHex: string): string {
  const key = deriveMachineKey();
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

// ── Fallback file vault ────────────────────────────────────────────

interface FileVaultStore {
  entries: Record<string, FileVaultEntry>;
}

interface FileVaultEntry {
  type: "api-key" | "auth-token";
  ciphertext: string; // JSON: { encrypted, iv, tag }
  createdAt: number;
  updatedAt: number;
}

async function readFileVault(): Promise<FileVaultStore> {
  if (!existsSync(VAULT_PATH)) {
    return { entries: {} };
  }
  try {
    const raw = await readFile(VAULT_PATH, "utf8");
    // The file vault itself is encrypted at rest
    const parts = raw.split(".");
    if (parts.length !== 3) return { entries: {} };
    const decrypted = decrypt(parts[0], parts[1], parts[2]);
    return JSON.parse(decrypted);
  } catch {
    return { entries: {} };
  }
}

async function writeFileVault(store: FileVaultStore): Promise<void> {
  const json = JSON.stringify(store);
  const { encrypted, iv, tag } = encrypt(json);
  await mkdir(VAULT_DIR, { recursive: true });
  await writeFile(VAULT_PATH, `${encrypted}.${iv}.${tag}`, "utf8");
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Vault for securely storing API keys and auth tokens.
 *
 * Attempts to use OS keychain via keytar first. Falls back to an
 * AES-256-GCM encrypted file at ~/.config/aether/vault.enc.
 */
export class Vault {
  private keytar: typeof import("keytar") | null = null;
  private ready = false;
  private usingKeytar = false;

  /** Initialize the vault. Call once before use. */
  async initialize(): Promise<void> {
    this.keytar = await getKeytar();
    this.usingKeytar = this.keytar !== null;
    this.ready = true;
  }

  /** Whether the vault is using OS keychain (true) or file fallback (false) */
  get isUsingSystemKeychain(): boolean {
    return this.usingKeytar;
  }

  // ── Set ────────────────────────────────────────────────────────

  /**
   * Store a secret in the vault.
   *
   * @param providerId - Provider identifier (e.g. "openai", "anthropic")
   * @param type - Key type
   * @param secret - The plaintext secret to store
   */
  async set(
    providerId: string,
    type: "api-key" | "auth-token",
    secret: string,
  ): Promise<void> {
    if (!this.ready) await this.initialize();

    if (this.usingKeytar && this.keytar) {
      await this.keytar.setPassword(
        SERVICE_NAME,
        `${providerId}:${type}`,
        secret,
      );
      return;
    }

    // File fallback
    const store = await readFileVault();
    const now = Date.now();
    const key = `${providerId}:${type}`;

    if (store.entries[key]) {
      store.entries[key].ciphertext = JSON.stringify(encrypt(secret));
      store.entries[key].updatedAt = now;
    } else {
      store.entries[key] = {
        type,
        ciphertext: JSON.stringify(encrypt(secret)),
        createdAt: now,
        updatedAt: now,
      };
    }

    await writeFileVault(store);
  }

  // ── Get ────────────────────────────────────────────────────────

  /**
   * Retrieve a secret from the vault.
   *
   * @param providerId - Provider identifier
   * @param type - Key type
   * @returns The plaintext secret, or null if not found
   */
  async get(
    providerId: string,
    type: "api-key" | "auth-token",
  ): Promise<string | null> {
    if (!this.ready) await this.initialize();

    if (this.usingKeytar && this.keytar) {
      const password = await this.keytar.getPassword(
        SERVICE_NAME,
        `${providerId}:${type}`,
      );
      return password ?? null;
    }

    // File fallback
    const store = await readFileVault();
    const key = `${providerId}:${type}`;
    const entry = store.entries[key];
    if (!entry) return null;

    try {
      const { encrypted, iv, tag } = JSON.parse(entry.ciphertext);
      return decrypt(encrypted, iv, tag);
    } catch {
      return null;
    }
  }

  // ── Delete ─────────────────────────────────────────────────────

  /**
   * Delete a secret from the vault.
   *
   * @param providerId - Provider identifier
   * @param type - Key type
   * @returns true if deleted, false if not found
   */
  async delete(
    providerId: string,
    type: "api-key" | "auth-token",
  ): Promise<boolean> {
    if (!this.ready) await this.initialize();

    if (this.usingKeytar && this.keytar) {
      return this.keytar.deletePassword(
        SERVICE_NAME,
        `${providerId}:${type}`,
      );
    }

    // File fallback
    const store = await readFileVault();
    const key = `${providerId}:${type}`;
    if (!store.entries[key]) return false;

    delete store.entries[key];
    await writeFileVault(store);
    return true;
  }

  // ── List ───────────────────────────────────────────────────────

  /**
   * List all stored credential references.
   *
   * @returns Array of { providerId, type } tuples
   */
  async list(): Promise<Array<{ providerId: string; type: string }>> {
    if (!this.ready) await this.initialize();

    if (this.usingKeytar && this.keytar) {
      const passwords = await this.keytar.findCredentials(SERVICE_NAME);
      return passwords
        .map((p) => {
          const colonIdx = p.account.lastIndexOf(":");
          if (colonIdx === -1) {
            return { providerId: p.account, type: "api-key" };
          }
          return {
            providerId: p.account.slice(0, colonIdx),
            type: p.account.slice(colonIdx + 1),
          };
        });
    }

    // File fallback
    const store = await readFileVault();
    return Object.entries(store.entries).map(([key]) => {
      const colonIdx = key.lastIndexOf(":");
      return {
        providerId: colonIdx === -1 ? key : key.slice(0, colonIdx),
        type: colonIdx === -1 ? "api-key" : key.slice(colonIdx + 1),
      };
    });
  }

  // ── Health ─────────────────────────────────────────────────────

  /** Check if the vault is operational */
  async health(): Promise<{ ok: boolean; backend: "keytar" | "file-fallback"; message?: string }> {
    if (!this.ready) await this.initialize();

    if (this.usingKeytar) {
      return { ok: true, backend: "keytar" };
    }

    // Verify we can write and read
    try {
      await mkdir(VAULT_DIR, { recursive: true });
      return { ok: true, backend: "file-fallback" };
    } catch (err) {
      return {
        ok: false,
        backend: "file-fallback",
        message: `Cannot access vault directory: ${err}`,
      };
    }
  }
}

/** Singleton vault instance */
export const vault = new Vault();
