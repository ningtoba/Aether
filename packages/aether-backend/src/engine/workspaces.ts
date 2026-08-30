/**
 * WorkspacesService — browsable working-directory roots.
 *
 * Lets the GUI pick a real working directory for sessions and loops (so one
 * session can work in repo A while another edits repo B). Roots come from the
 * `AETHER_WORKSPACES` env var (colon-separated absolute paths); when unset it
 * defaults to the user's home directory. In Docker the compose file mounts the
 * host projects (and/or home) into the container at the SAME absolute path, so
 * a host path like `/home/nekophobia/Projects/Aether` is real inside the
 * container too and the agent edits the actual host files.
 *
 * Security: browsing is confined to the configured roots (a leaked path can't
 * be used to read arbitrary filesystem locations), and a chosen cwd must be a
 * directory that exists (invalid paths are rejected with a clear error before
 * an omp session is created).
 */
import { readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';

export interface WorkspaceDirEntry {
  name: string;
  path: string;
  isDir: boolean;
}

export interface WorkspaceRoot {
  path: string;
  label: string;
}

/**
 * Resolve `path` to its real on-disk location, following symlinks. When the
 * path (or a deeper component of it) does not exist yet, the NEAREST EXISTING
 * ancestor is resolved and the missing components are re-appended lexically —
 * components that do not exist cannot be symlinks, so this stays sound (the
 * classic containment recipe). `undefined` means the location cannot be
 * proven (EACCES etc.); callers must treat unprovable as outside the root.
 */
function realpathNearest(path: string): string | undefined {
  const missing: string[] = [];
  let cur = path;
  for (;;) {
    try {
      const real = realpathSync(cur);
      return missing.length > 0 ? join(real, ...missing.reverse()) : real;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') return undefined;
      const parent = dirname(cur);
      if (parent === cur) return undefined;
      missing.push(cur.slice(parent.length + 1));
      cur = parent;
    }
  }
}

export class WorkspacesService {
  private roots: WorkspaceRoot[];

  constructor(workspacesEnv?: string) {
    this.roots = this.#parseRoots(workspacesEnv);
  }

  #parseRoots(env: string | undefined): WorkspaceRoot[] {
    // Colon-separated absolute paths; default to the user's home.
    const raw =
      env
        ?.split(':')
        .map((s) => s.trim())
        .filter(Boolean) ?? [];
    const paths = raw.length > 0 ? raw : [homedir()];
    const seen = new Set<string>();
    const out: WorkspaceRoot[] = [];
    for (const p of paths) {
      const abs = resolve(p.trim());
      if (!isAbsolute(abs) || seen.has(abs)) continue;
      seen.add(abs);
      let label = abs;
      try {
        const isHome = abs === homedir();
        label = isHome ? `~ (home)` : (abs.split(sep).filter(Boolean).pop() ?? abs);
      } catch {
        /* keep abs */
      }
      out.push({ path: abs, label });
    }
    return out;
  }

  /** The configured workspace roots. */
  listRoots(): WorkspaceRoot[] {
    return this.roots;
  }

  /**
   * True when the REAL location of `path` is within (or exactly) the REAL
   * location of any configured root. Realpaths are compared, never lexical
   * strings: a symlink inside a root that points outside must be rejected,
   * while a root reachable through a symlink keeps working.
   */
  private isWithinRoot(path: string): boolean {
    const real = realpathNearest(path);
    if (real === undefined) return false; // unprovable location → outside
    return this.roots.some((r) => {
      const base = realpathNearest(r.path);
      if (base === undefined) return false;
      if (base === sep) return real.startsWith(sep); // root '/' holds every absolute path
      return real === base || real.startsWith(base + sep);
    });
  }

  /**
   * List directory entries under `path` (validated to be within a root).
   * Returns the resolved path + sorted entries (dirs first) + a parent link.
   * `undefined` → the path is invalid or outside a root.
   */
  browse(
    path?: string,
  ): { path: string; entries: WorkspaceDirEntry[]; parent?: string } | undefined {
    const requested = path && path.trim() ? resolve(path) : this.roots[0]?.path;
    if (!requested) return undefined;
    // Browse must stay within a configured root.
    if (!this.isWithinRoot(requested)) return undefined;
    const abs = requested;
    try {
      const st = statSync(abs);
      if (!st.isDirectory()) return undefined;
    } catch {
      return undefined;
    }
    let entries: WorkspaceDirEntry[] = [];
    try {
      entries = readdirSync(abs)
        .map((name) => {
          const full = join(abs, name);
          let isDir = false;
          try {
            isDir = statSync(full).isDirectory();
          } catch {
            /* unreadable entry — skip */
          }
          return { name, path: full, isDir };
        })
        .filter((e) => e.isDir)
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return undefined;
    }
    const parentCmpt = abs.split(sep).filter(Boolean);
    let parent: string | undefined;
    if (abs !== this.roots[0]?.path || parentCmpt.length > 1) {
      const withoutLast = parentCmpt.slice(0, -1).join(sep);
      const candidate = withoutLast ? `${sep}${withoutLast}` : sep;
      if (this.isWithinRoot(candidate)) parent = candidate;
    }
    return { path: abs, entries, parent };
  }

  /**
   * Resolve + validate a requested working directory. Returns the resolved
   * path when it's an existing directory (and within a root when roots are set
   * and the path isn't already a root). Returns null with a reason otherwise.
   */
  resolveCwd(requested: string | undefined): { path: string } | { error: string } {
    if (!requested || !requested.trim()) {
      // Default to the first root (host home by default; a project mount in
      // Docker) — a sane, existing working directory.
      const first = this.roots[0];
      return first ? { path: first.path } : { error: 'no workspace roots configured' };
    }
    const abs = resolve(requested);
    if (!this.isWithinRoot(abs) && this.roots.length > 0) {
      return { error: `working directory outside configured workspaces: ${abs}` };
    }
    try {
      if (!statSync(abs).isDirectory()) {
        return { error: `working directory is not a directory: ${abs}` };
      }
    } catch {
      return { error: `working directory does not exist: ${abs}` };
    }
    return { path: abs };
  }
}
