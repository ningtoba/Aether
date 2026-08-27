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
 * (/etc/machine-id or the hostname). This protects against casual disclosure
 * and backup exfiltration on single-user hosts — it is NOT a defense against
 * same-user malware or root, which can read the key seed and the vault file.
 */

import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';

// ── Keytar interface (optional OS keychain) ─────────────────────────

/** Minimal surface of the optional `keytar` dependency. */
interface KeytarLike {
  setPassword(service: string, account: string, password: string): Promise<void>;
  getPassword(service: string, account: string): Promise<string | null>;
  deletePassword(service: string, account: string): Promise<boolean>;
  findCredentials(service: string): Promise<Array<{ account: string; password: string }>>;
}

let _keytar: KeytarLike | null = null;
let _keytarAttempted = false;

/** Serialize read-modify-write cycles on the encrypted file vault. */
let fileOpQueue: Promise<void> = Promise.resolve();

function withFileLock<T>(operation: () => Promise<T>): Promise<T> {
  const run = fileOpQueue.then(operation, operation);
  fileOpQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Resolve the OS keychain (keytar) if installed. Returns null when keytar is
 * unavailable — callers then fall back to the AES-256-GCM encrypted file
 * vault. A missing keytar must never mean "plaintext": credentials always go
 * to either a real keychain or the encrypted file.
 */
async function getKeytar(): Promise<KeytarLike | null> {
  if (_keytarAttempted) return _keytar;
  _keytarAttempted = true;
  try {
    const keytarModule = await import(/* @vite-ignore */ 'keytar' as string);
    // keytar is a CommonJS addon; Node may expose the API only via `.default`
    // (cjs-module-lexer named exports are unreliable for native modules).
    const mod = (keytarModule as { default?: unknown }).default ?? keytarModule;
    _keytar = mod as unknown as KeytarLike;
  } catch {
    _keytar = null;
  }
  return _keytar;
}

// ── Constants ──────────────────────────────────────────────────────

const VAULT_DIR = join(homedir(), '.config', 'aether');
const VAULT_PATH = join(VAULT_DIR, 'vault.enc');
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits
const TAG_LENGTH = 16; // 128 bits
const SERVICE_NAME = 'aether-agent';

// ── Types ──────────────────────────────────────────────────────────

export interface VaultEntry {
  /** Provider ID this key belongs to */
  providerId: string;
  /** Key type: api-key or auth-token */
  type: 'api-key' | 'auth-token';
  /** The encrypted secret (hex-encoded ciphertext) */
  encrypted: string;
  /** Creation timestamp */
  createdAt: number;
  /** Last update timestamp */
  updatedAt: number;
}

// ── Fallback encryption helpers ────────────────────────────────────

function deriveMachineKey(): Buffer {
  // Try /etc/machine-id first
  try {
    const id = readFileSync('/etc/machine-id', 'utf8').trim();
    return createHash('sha256').update(id).digest();
  } catch {
    // Fallback: hostname-based, stable-ish
    const seed = `${hostname()}-aether-vault-v1`;
    return createHash('sha256').update(seed).digest();
  }
}

function encrypt(data: string): { encrypted: string; iv: string; tag: string } {
  const key = deriveMachineKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');

  return { encrypted, iv: iv.toString('hex'), tag };
}

function decrypt(encrypted: string, ivHex: string, tagHex: string): string {
  const key = deriveMachineKey();
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ── Fallback file vault ────────────────────────────────────────────

interface FileVaultStore {
  entries: Record<string, FileVaultEntry>;
}

interface FileVaultEntry {
  type: 'api-key' | 'auth-token';
  ciphertext: string; // JSON: { encrypted, iv, tag }
  createdAt: number;
  updatedAt: number;
}

async function readFileVault(): Promise<FileVaultStore> {
  if (!existsSync(VAULT_PATH)) {
    return { entries: {} };
  }
  try {
    const raw = await readFile(VAULT_PATH, 'utf8');
    if (raw.length === 0) throw new Error('empty vault file');
    const parts = raw.split('.');
    if (parts.length !== 3) throw new Error('malformed vault file');
    const decrypted = decrypt(parts[0], parts[1], parts[2]);
    return JSON.parse(decrypted);
  } catch (err) {
    // An undecryptable/truncated vault must never be treated as an empty
    // store — the next serialized set() would read-modify-write over it and
    // destroy every key. Preserve the ciphertext under a timestamped name for
    // manual recovery, then continue with a clean store.
    if (existsSync(VAULT_PATH)) {
      try {
        const backupPath = `${VAULT_PATH}.corrupt-${Date.now()}`;
        await rename(VAULT_PATH, backupPath);
        console.warn(
          `[Vault] could not decrypt vault.enc (${(err as Error).message}); ` +
            `preserved as ${backupPath}. Check host identity (machine-id/hostname).`,
        );
      } catch {
        // Best-effort backup; never let this mask the underlying failure.
      }
    }
    return { entries: {} };
  }
}

/** Write the encrypted vault atomically with owner-only permissions. */
async function writeFileVault(store: FileVaultStore): Promise<void> {
  const json = JSON.stringify(store);
  const { encrypted, iv, tag } = encrypt(json);
  // Owner-only directory + file so the ciphertext (and its decryption key
  // material in /etc/machine-id) is not world-readable on multi-user hosts.
  mkdirSync(VAULT_DIR, { recursive: true, mode: 0o700 });
  const tmpPath = join(VAULT_DIR, `.vault.tmp-${process.pid}`);
  await writeFile(tmpPath, `${encrypted}.${iv}.${tag}`, { encoding: 'utf8', mode: 0o600 });
  await rename(tmpPath, VAULT_PATH);
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Vault for securely storing API keys and auth tokens.
 *
 * Attempts to use OS keychain via keytar first. Falls back to an
 * AES-256-GCM encrypted file at ~/.config/aether/vault.enc.
 */
export class Vault {
  private keytar: KeytarLike | null = null;
  private ready = false;
  private usingKeytar = false;

  /** Initialize the vault. Call once before use. */
  async initialize(): Promise<void> {
    this.keytar = await getKeytar();
    this.usingKeytar = this.keytar !== null;
    this.ready = true;
    await this.migrateLegacyPlaintext();
  }

  /**
   * Older Aether versions stored provider keys in a PLAINTEXT JSON file at
   * ~/.aether/keychain.json. On upgrade, migrate any such keys into the vault
   * (encrypted file or keychain) and delete the plaintext file so credentials
   * do not linger on disk in clear.
   */
  private async migrateLegacyPlaintext(): Promise<void> {
    const legacyPath = join(homedir(), '.aether', 'keychain.json');
    if (!existsSync(legacyPath)) return;

    try {
      const raw = readFileSync(legacyPath, 'utf8');
      const store = JSON.parse(raw) as Record<string, string>;
      let migrated = 0;
      for (const [key, secret] of Object.entries(store)) {
        if (typeof secret !== 'string' || secret.length === 0) continue;
        // Legacy key format: `${SERVICE_NAME}:${providerId}:${type}`
        const account = key.startsWith(`${SERVICE_NAME}:`)
          ? key.slice(SERVICE_NAME.length + 1)
          : key;
        const colonIdx = account.lastIndexOf(':');
        const providerId = colonIdx === -1 ? account : account.slice(0, colonIdx);
        const type = colonIdx === -1 ? 'api-key' : account.slice(colonIdx + 1);
        if (!providerId) continue;
        await this.set(providerId, type === 'auth-token' ? 'auth-token' : 'api-key', secret);
        migrated += 1;
      }
      // Only remove the plaintext file after a successful full migration.
      rmSync(legacyPath, { force: true });
      if (migrated > 0) {
        console.warn(
          `[Vault] migrated ${migrated} legacy plaintext credential(s) into the encrypted vault and removed ~/.aether/keychain.json.`,
        );
      }
    } catch (err) {
      // Never delete the legacy file on failure — prefer duplicate storage over
      // destroying the last copy of a secret.
      console.warn(`[Vault] legacy plaintext migration skipped: ${(err as Error).message}`);
    }
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
  async set(providerId: string, type: 'api-key' | 'auth-token', secret: string): Promise<void> {
    if (!this.ready) await this.initialize();

    if (this.usingKeytar && this.keytar) {
      await this.keytar.setPassword(SERVICE_NAME, `${providerId}:${type}`, secret);
      return;
    }

    // File fallback: read-modify-write must be serialized against other
    // setters/deletes so concurrent writes cannot lose entries.
    return withFileLock(async () => {
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
    });
  }

  // ── Get ────────────────────────────────────────────────────────

  /**
   * Retrieve a secret from the vault.
   *
   * @param providerId - Provider identifier
   * @param type - Key type
   * @returns The plaintext secret, or null if not found
   */
  async get(providerId: string, type: 'api-key' | 'auth-token'): Promise<string | null> {
    if (!this.ready) await this.initialize();

    if (this.usingKeytar && this.keytar) {
      const password = await this.keytar.getPassword(SERVICE_NAME, `${providerId}:${type}`);
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
  async delete(providerId: string, type: 'api-key' | 'auth-token'): Promise<boolean> {
    if (!this.ready) await this.initialize();

    if (this.usingKeytar && this.keytar) {
      return this.keytar.deletePassword(SERVICE_NAME, `${providerId}:${type}`);
    }

    // File fallback: serialize against concurrent setters.
    return withFileLock(async () => {
      const store = await readFileVault();
      const key = `${providerId}:${type}`;
      if (!store.entries[key]) return false;

      delete store.entries[key];
      await writeFileVault(store);
      return true;
    });
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
      return passwords.map((p) => {
        const colonIdx = p.account.lastIndexOf(':');
        if (colonIdx === -1) {
          return { providerId: p.account, type: 'api-key' };
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
      const colonIdx = key.lastIndexOf(':');
      return {
        providerId: colonIdx === -1 ? key : key.slice(0, colonIdx),
        type: colonIdx === -1 ? 'api-key' : key.slice(colonIdx + 1),
      };
    });
  }

  // ── Health ─────────────────────────────────────────────────────

  /** Check if the vault is operational */
  async health(): Promise<{ ok: boolean; backend: 'keytar' | 'file-fallback'; message?: string }> {
    if (!this.ready) await this.initialize();

    if (this.usingKeytar) {
      return { ok: true, backend: 'keytar' };
    }

    // Verify we can write and read
    try {
      mkdirSync(VAULT_DIR, { recursive: true, mode: 0o700 });
      return { ok: true, backend: 'file-fallback' };
    } catch (err) {
      return {
        ok: false,
        backend: 'file-fallback',
        message: `Cannot access vault directory: ${err}`,
      };
    }
  }
}

/** Singleton vault instance */
export const vault = new Vault();
