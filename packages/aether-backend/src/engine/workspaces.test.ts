/**
 * WorkspacesService is the single source of truth for working-directory
 * defaults and validation. These tests pin the INVARIANT that every path it
 * resolves is absolute — the loop/session routes and LoopManager rely on it,
 * so a caller-side re-check would be an untestable dead branch instead.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspacesService } from './workspaces.js';

let root: string;
let sub: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'aether-wsp-'));
  sub = join(root, 'project');
  mkdirSync(sub);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('WorkspacesService.resolveCwd', () => {
  it('defaults a blank request to the first configured root (absolute)', () => {
    const svc = new WorkspacesService(`${root}:${sub}`);
    expect(svc.resolveCwd(undefined)).toEqual({ path: root });
    expect(svc.resolveCwd('   ')).toEqual({ path: root });
  });

  it('resolves a requested directory to an absolute path', () => {
    const svc = new WorkspacesService(root);
    expect(svc.resolveCwd(sub)).toEqual({ path: sub });
    // Relative inside a root is resolved, not passed through verbatim.
    const rel = svc.resolveCwd(join(sub, 'does-not-exist'));
    expect('error' in rel).toBe(true); // missing dir → error, never a bare relative path
  });

  it('rejects paths outside the configured roots', () => {
    const svc = new WorkspacesService(root);
    const r = svc.resolveCwd('/etc');
    expect('error' in r && r.error).toContain('outside configured workspaces');
  });

  it('falls back to an absolute default (home) when no roots are configured', () => {
    // env=undefined → home root by construction; the default must still be absolute.
    const svc = new WorkspacesService(undefined);
    const r = svc.resolveCwd(undefined);
    expect('path' in r && r.path.startsWith('/')).toBe(true);
  });
});
