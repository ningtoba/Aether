/**
 * SkillsService — discover and read SKILL.md packs.
 *
 * Mirrors the omp skill-layout convention: a skill lives at
 * `<root>/<name>/SKILL.md` with optional YAML frontmatter (`name`,
 * `description`, ...). The backend scans conventional roots so the GUI can
 * browse and invoke skills, and loops can chain a skill between rounds.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { SkillRecord } from './types.js';

export interface SkillsServiceOptions {
  /** Extra skill roots (in addition to defaults). */
  extraRoots?: string[];
  /** Project root for `.omp/skills` (default: process cwd). */
  projectRoot?: string;
  /** How long list() results stay fresh (default 30s). Injectable for tests. */
  ttlMs?: number;
}

/** Default memo TTL: skill files change rarely; a rescan per GUI poll was
  pure filesystem churn. */
const DEFAULT_SKILLS_TTL_MS = 30_000;

interface RawSkill {
  name: string;
  description: string;
  path: string;
  body: string;
  source: string;
}

/** Single-line `key: value` frontmatter parser for the fields we need. */
function parseFrontmatter(raw: string): { name?: string; description?: string; body: string } {
  const trimmed = raw.replace(/^\uFEFF/, '');
  if (!trimmed.startsWith('---')) return { body: trimmed };
  const end = trimmed.indexOf('\n---', 3);
  if (end < 0) return { body: trimmed };
  const fm = trimmed.slice(3, end);
  const body = trimmed.slice(end + 4).replace(/^\n/, '');
  let name: string | undefined;
  let description: string | undefined;
  for (const line of fm.split('\n')) {
    const m = /^\s*(name|description)\s*:\s*(.+)$/.exec(line);
    if (m) {
      const value = m[2].trim().replace(/^["']|["']$/g, '');
      if (m[1] === 'name') name = value;
      else description = value;
    }
  }
  return { name, description, body };
}

export class SkillsService {
  private roots: string[];
  private readonly ttlMs: number;
  private cache: { at: number; records: SkillRecord[] } | null = null;

  constructor(opts: SkillsServiceOptions = {}) {
    const projectRoot = opts.projectRoot ?? process.cwd();
    const userRoot = join(homedir(), '.omp', 'agent', 'skills');
    this.roots = [
      // project-scoped first (closest wins on name collision like omp)
      join(projectRoot, '.omp', 'skills'),
      ...(opts.extraRoots ?? []),
    ];
    if (existsSync(userRoot)) this.roots.push(userRoot);
    this.ttlMs = opts.ttlMs ?? DEFAULT_SKILLS_TTL_MS;
  }

  /** Drop the memo so the next list() rescans the filesystem. */
  invalidate(): void {
    this.cache = null;
  }

  /** List every discovered skill, deduped by name (first root wins).
   *  Serves the memo while fresh (ttlMs); a miss rescans synchronously. */
  list(): SkillRecord[] {
    const now = Date.now();
    if (this.cache !== null && now - this.cache.at < this.ttlMs) {
      return this.cache.records;
    }
    const records = this.#scan();
    this.cache = { at: now, records };
    return records;
  }

  #scan(): SkillRecord[] {
    const seen = new Map<string, RawSkill>();
    for (const root of this.roots) {
      if (!existsSync(root)) continue;
      let entries: string[];
      try {
        entries = readdirSync(root, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name);
      } catch {
        continue;
      }
      for (const entry of entries) {
        const skillPath = join(root, entry, 'SKILL.md');
        if (!existsSync(skillPath)) continue;
        if (seen.has(entry)) continue;
        try {
          const raw = readFileSync(skillPath, 'utf-8');
          const { name, description, body } = parseFrontmatter(raw);
          seen.set(entry, {
            name: name ?? entry,
            description: description ?? '',
            path: skillPath,
            body,
            source: root,
          });
        } catch {
          /* skip unreadable skill */
        }
      }
    }
    return Array.from(seen.values()).map((s) => ({
      name: s.name,
      description: s.description,
      path: s.path,
      body: s.body,
      source: s.source,
    }));
  }

  async get(name: string): Promise<SkillRecord | null> {
    const found = this.list().find((s) => s.name === name);
    return found ?? null;
  }
}
