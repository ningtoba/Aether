/**
 * WorkspacesService is the single source of truth for working-directory
 * defaults and validation. These tests pin the INVARIANT that every path it
 * resolves is absolute — the loop/session routes and LoopManager rely on it,
 * so a caller-side re-check would be an untestable dead branch instead.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
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

describe('WorkspacesService symlink containment', () => {
  it('rejects a symlink inside a root that points to a directory outside it', () => {
    // Fixture: root/escape → a real directory OUTSIDE every root. The old
    // lexical startsWith check saw 'root/escape' as inside and statSync then
    // happily followed the link, so both entry points accepted the escape.
    const outside = mkdtempSync(join(tmpdir(), 'aether-outside-'));
    const link = join(root, 'escape');
    symlinkSync(outside, link);
    try {
      const svc = new WorkspacesService(root);
      const r = svc.resolveCwd(link);
      expect('error' in r && r.error).toContain('outside configured workspaces');
      // browse() must refuse to list through the same link.
      expect(svc.browse(link)).toBeUndefined();
      // The outside target itself was already rejected before the fix too —
      // pin that the REAL path never leaks into the answer.
      expect(JSON.stringify(r)).not.toContain(outside);
    } finally {
      rmSync(link, { force: true }); // unlinks the symlink, not the target
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('still accepts regular directories inside the root (no false positives)', () => {
    const svc = new WorkspacesService(root);
    // Discriminating pair for the test above: same service, real directory.
    expect(svc.resolveCwd(sub)).toEqual({ path: sub });
    expect(svc.browse(sub)?.path).toBe(sub);
  });
});
