/**
 * Vault tests.
 *
 * The optional `keytar` OS keychain is NOT installed in this repo/module
 * graph, so these tests exercise the real AES-256-GCM encrypted-file backend
 * (the reachable fallback since the plaintext static store was removed). A
 * temporary HOME keeps the tests out of the user's real configuration.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let homeBackup: string | undefined;

function withTempHome(): string {
  homeBackup = process.env.HOME;
  const tmp = mkdtempSync(join(tmpdir(), 'aether-vault-test-'));
  process.env.HOME = tmp;
  return tmp;
}

describe('Vault (encrypted file backend)', () => {
  afterEach(() => {
    if (homeBackup !== undefined) {
      process.env.HOME = homeBackup;
      homeBackup = undefined;
    }
    vi.resetModules();
  });

  it('uses the encrypted-file backend when keytar is absent', async () => {
    const tmp = withTempHome();
    const { Vault } = await import('./vault.js');
    const vault = new Vault();
    expect(vault.isUsingSystemKeychain).toBe(false);
    expect((await vault.health()).backend).toBe('file-fallback');
    rmSync(tmp, { recursive: true, force: true });
  });

  it('round-trips a secret stored encrypted at rest with owner-only perms', async () => {
    const tmp = withTempHome();
    const { Vault } = await import('./vault.js');
    const vault = new Vault();

    await vault.set('openai', 'api-key', 'sk-secret-123');
    expect(await vault.get('openai', 'api-key')).toBe('sk-secret-123');
    expect(await vault.set('openai', 'api-key', 'updated-key')).toBeUndefined();
    await vault.set('openai', 'api-key', 'sk-super-secret');
    expect(await vault.get('openai', 'api-key')).toBe('sk-super-secret');

    const vaultPath = join(tmp, '.config', 'aether', 'vault.enc');
    const raw = readFileSync(vaultPath, 'utf8');
    // Encrypted at rest — plaintext must never appear in the file.
    expect(raw).not.toContain('sk-super-secret');
    expect(raw).not.toContain('openai');
    // Owner-only permissions on the ciphertext.
    expect(statSync(vaultPath).mode & 0o777).toBe(0o600);

    // List + delete round-trip.
    const listed = await vault.list();
    expect(listed).toContainEqual({ providerId: 'openai', type: 'api-key' });
    expect(await vault.delete('openai', 'api-key')).toBe(true);
    expect(await vault.get('openai', 'api-key')).toBeNull();
    expect(await vault.delete('openai', 'api-key')).toBe(false);

    rmSync(tmp, { recursive: true, force: true });
  });

  it('crosses concurrent set calls without losing entries', async () => {
    const tmp = withTempHome();
    const { Vault } = await import('./vault.js');
    const vault = new Vault();

    await Promise.all([
      vault.set('a', 'api-key', 'secret-a'),
      vault.set('b', 'api-key', 'secret-b'),
      vault.set('c', 'auth-token', 'secret-c'),
    ]);

    expect(await vault.get('a', 'api-key')).toBe('secret-a');
    expect(await vault.get('b', 'api-key')).toBe('secret-b');
    expect(await vault.get('c', 'auth-token')).toBe('secret-c');

    rmSync(tmp, { recursive: true, force: true });
  });
});
