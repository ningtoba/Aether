/**
 * OmpFacade — defensive, capability-gated wrapper over the
 * `@oh-my-pi/pi-coding-agent` SDK for the web GUI.
 *
 * Purpose (two-fold):
 *
 * 1. EXPOSE everything omp can do to the GUI (settings, providers, agents,
 *    skills, on-disk sessions, model checks) — not just the session affordance
 *    the previous engine exposed.
 * 2. STAY SAFE ACROSS omp UPGRADES. The SDK has no API firewall (breaking
 *    changes land per-CHANGELOG without deprecation windows). So this facade:
 *      - imports the SDK lazily (works under Node for tests, never touches the
 *        Bun-only addon);
 *      - feature-detects every SDK entry it uses (typeof check) instead of
 *        assuming it exists;
 *      - wraps every call in try/catch and returns structured `ok/available/
 *        error` results, so a missing/renamed export degrades to capability
 *        "unavailable" rather than taking the whole API down;
 *      - never parses omp's on-disk formats itself (uses the SDK's own
 *        SessionManager/settings loaders) so storage-format changes don't
 *        break the GUI.
 *
 * Memory/edit-safety mirrors EngineService: everything here runs only under
 * Bun; under Node every method resolves to `unavailable`.
 */
import * as fs from 'node:fs';
import { join, sep } from 'node:path';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';

import {
  confineSessionPath,
  defaultSessionRoots,
  isBunRuntime,
  type ProviderAuthOrigin,
} from './engine-service.js';
import { providerNamesIn } from './providers-store.js';

/* ─── Wire DTOs (stable GUI contracts) ───────────────────────────────── */
export interface FacadeCapability {
  name: string;
  available: boolean;
  error?: string;
}

export interface OmpFacadeStatus {
  available: boolean;
  runtime: 'bun' | 'node';
  version?: string;
  error?: string;
  capabilities: FacadeCapability[];
}

export interface SettingDefDto {
  path: string;
  type: string;
  label?: string;
  description?: string;
  tab?: string;
  group?: string;
  defaultValue?: unknown;
  enumValues?: string[];
  options?: Array<{ value: string; label: string; description?: string }>;
  credential?: boolean;
}

export interface SettingsSchemaDto {
  tabs: Array<{ id: string; label: string }>;
  groups: Record<string, string[]>;
  settings: SettingDefDto[];
}

export interface ProviderDto {
  id: string;
  name: string;
  baseUrl?: string;
  modelCount: number;
  /** Sample model ids from this provider (for the GUI picker). */
  models: string[];
  /** Truth = AuthStorage.hasAuth(id). Model rows have NO auth field — the
   *  old per-model boolean was the lie this replaces. */
  authenticated: boolean;
  discoverable: boolean;
  /** models.yml owns this provider (deletable custom entry). */
  custom: boolean;
  /** Where the stored credential came from (omp getCredentialOrigin kind). */
  authOrigin?: ProviderAuthOrigin;
  /** String form of the provider discovery state object (.status). */
  discoveryStatus?: string;
}

export interface AgentDefDto {
  name: string;
  description?: string;
  source: 'bundled' | 'user' | 'project';
  path?: string;
  body?: string;
  frontmatter?: Record<string, unknown>;
}

export interface SkillDto {
  name: string;
  description: string;
  path: string;
  body: string;
  source: string;
}

export interface SessionInfoDto {
  id: string;
  path: string;
  cwd: string;
  name: string;
  displayName?: string;
  modified?: string;
  status?: string;
  firstUserMessage?: string;
}

export interface SessionTranscriptDto {
  id: string;
  path: string;
  name?: string;
  cwd?: string;
  messages: Array<{ role: string; text: string; timestamp?: string }>;
  /** True when the on-disk journal held more entries than this facade parsed
   *  (SESSION_JOURNAL_MAX_LINES): the messages shown are a PREFIX of the
   *  transcript. Absent for a complete read (shape stays byte-identical). */
  truncated?: boolean;
}

/**
 * The minimal slice of the omp SDK this facade touches, typed structurally so
 * we never depend on (or import types from) the Bun-only package at compile
 * time under Node. Field shapes below are "as good as we need", and every
 * access is guarded by feature-detection at runtime.
 */
interface OmpSettingUi {
  tab?: string;
  group?: string;
  label?: string;
  description?: string;
  options?: Array<{ value: string; label: string; description?: string }>;
  /** Some omp defs carry the secret marker on the UI block, not the root. */
  secret?: boolean;
}
interface OmpSettingDef {
  type?: string;
  default?: unknown;
  credential?: boolean;
  values?: readonly unknown[];
  ui?: OmpSettingUi;
}
interface OmpSettingsInstance {
  get(path: string): unknown;
  set(path: string, value: unknown): void;
  flush(): Promise<unknown>;
}
interface OmpSettingsClass {
  loadReadOnly(): Promise<OmpSettingsInstance>;
  loadIsolated(): Promise<OmpSettingsInstance>;
}
interface OmpModelLike {
  id?: string;
  provider?: string;
  name?: string;
  baseUrl?: string;
}

/** Feature-detected slice of omp AuthStorage the provider catalog reads. */
interface OmpAuthStorageLike {
  hasAuth?(provider: string): boolean;
  getCredentialOrigin?(provider: string): { kind?: string } | undefined;
}
interface OmpProviderInfo {
  provider?: string;
}
interface OmpModelRegistry {
  refresh?(): Promise<unknown>;
  refreshInBackground?(): unknown;
  getAll?(): OmpModelLike[];
  find?(provider: string, id: string): unknown;
  getDiscoverableProviders?(): string[];
  getProviderDiscoveryState?(id: string): unknown;
}

/** Static lookup: the credential origins a DTO may report. */
const AUTH_ORIGIN_KINDS: Record<ProviderAuthOrigin, true> = {
  runtime: true,
  config: true,
  oauth: true,
  api_key: true,
  env: true,
  fallback: true,
};
interface OmpSessionManager {
  list?(dir: string): Promise<unknown>;
  listAllSessions?(): Promise<unknown>;
  getDefaultSessionDir?(cwd: string): string;
}
interface OmpSdk {
  VERSION?: string;
  SETTINGS_SCHEMA?: Record<string, OmpSettingDef>;
  SETTING_TABS?: Array<string | OmpSettingUi>;
  TAB_GROUPS?: Record<string, string[]>;
  Settings?: OmpSettingsClass;
  ModelRegistry?: new (
    auth: unknown,
    modelsPath?: string,
    opts?: Record<string, unknown>,
  ) => OmpModelRegistry;
  discoverAuthStorage?(): Promise<unknown>;
  SessionManager?: OmpSessionManager;
  listAllSessions?(): Promise<unknown>;
  listSessionsReadOnly?(): Promise<unknown>;
  discoverSkills?(): Promise<{ skills?: unknown; warnings?: unknown }>;
  /** SessionManager static factories may be re-exported at top level. */
  listSessions?(dir: string): Promise<unknown>;
}

const okCap = (name: string): FacadeCapability => ({ name, available: true });

const errCap = (name: string, error: unknown): FacadeCapability => ({
  name,
  available: false,
  error: error instanceof Error ? error.message : String(error),
});

/* Synchronous journal reads block the event loop for their whole duration,
 * so readDiskSession bounds both of its steps: a stat gates the byte cap
 * BEFORE any content is read, and the parse stops at the line cap (flagging
 * the transcript `truncated`). Files under both caps behave exactly as
 * before. */
const SESSION_JOURNAL_MAX_BYTES = 32 * 1024 * 1024; // hard file-size cap
const SESSION_JOURNAL_MAX_LINES = 100_000; // hard cap on parsed journal lines

/* ─── Facade ─────────────────────────────────────────────────────────── */

export class OmpFacade {
  /** Lazily held SDK namespace. Cast through `unknown`: the value comes from
   *  a dynamic import of a Bun-only addon, not from typed static resolution. */
  private sdk: OmpSdk | null = null;
  private sdkError: string | null = null;
  private status: Partial<OmpFacadeStatus> = {};

  /** Names of omp exports the GUI relies on. All feature-detected. */
  private readonly stableSurface = [
    'createAgentSession',
    'Settings',
    'SETTINGS_SCHEMA',
    'SETTING_TABS',
    'TAB_GROUPS',
    'ModelRegistry',
    'discoverAuthStorage',
    'SessionManager',
    'listAllSessions',
    'listSessionsReadOnly',
    'discoverSkills',
    'VERSION',
    'BUILTIN_TOOLS',
  ] as const;

  /** Load the SDK once (only under Bun). Returns true when usable. */
  async ensure(): Promise<boolean> {
    if (this.sdk) return true;
    if (!isBunRuntime()) {
      this.status.available = false;
      this.status.runtime = 'node';
      return false;
    }
    try {
      // The omp SDK runs only under Bun — a static import here would fail the
      // Node test suite, so it must stay a runtime-selected dynamic import.
      const mod: unknown = await import('@oh-my-pi/pi-coding-agent');
      this.sdk = mod as OmpSdk;
      this.status.available = true;
      this.status.runtime = 'bun';
      this.status.version = this.sdk.VERSION ?? this.#probeVersion();
      this.#computeCapabilities();
      return true;
    } catch (err) {
      this.status.available = false;
      this.status.error = err instanceof Error ? err.message : String(err);
      this.#computeCapabilities();
      return false;
    }
  }

  #probeVersion(): string | undefined {
    try {
      const req = createRequire(import.meta.url);
      const pkg = req('@oh-my-pi/pi-coding-agent/package.json') as { version?: string };
      return pkg?.version;
    } catch {
      return undefined;
    }
  }

  #has(name: string): boolean {
    const sdk = this.sdk;
    return sdk !== null && typeof (sdk as Record<string, unknown>)[name] !== 'undefined';
  }

  #computeCapabilities(): void {
    const caps: FacadeCapability[] = [];
    for (const name of this.stableSurface) {
      if (!this.sdk) {
        caps.push({
          name,
          available: false,
          error: this.status.error ?? 'SDK not loaded',
        });
        continue;
      }
      if (typeof (this.sdk as Record<string, unknown>)[name] === 'undefined') {
        caps.push({ name, available: false, error: 'export removed in this omp version' });
      } else {
        caps.push(okCap(name));
      }
    }
    this.status.capabilities = caps;
  }

  /** Full status for the GUI (runtime, omp version, per-feature availability). */
  statusOf(): OmpFacadeStatus {
    return {
      available: this.status.available === true,
      runtime: this.status.runtime === 'bun' ? 'bun' : 'node',
      version: this.status.version,
      error: this.status.error ?? undefined,
      capabilities: this.status.capabilities ?? [],
    };
  }

  /* ─── Settings ──────────────────────────────────────────────────────── */

  /** Schema-driven settings surface, normalized from omp's own SETTINGS_SCHEMA. */
  async settingsSchema(): Promise<{ ok: boolean; schema?: SettingsSchemaDto; error?: string }> {
    if (!(await this.ensure())) {
      return { ok: false, error: 'settings schema unavailable in this omp version' };
    }
    try {
      const { schema, tabsRaw, groups } = await this.#loadSettingsSchema();
      const tabList: Array<{ id: string; label: string }> = tabsRaw.map((t) => {
        if (typeof t === 'string') return { id: t, label: t };
        return { id: t?.tab ?? '', label: t?.label ?? '' };
      });

      const settings: SettingDefDto[] = [];
      for (const [path, def] of Object.entries(schema)) {
        let entry: SettingDefDto = {
          path,
          type: typeof def?.type === 'string' ? def.type : 'string',
        };
        if (def?.ui && typeof def.ui === 'object') {
          entry = {
            ...entry,
            label: def.ui.label,
            description: def.ui.description,
            tab: def.ui.tab,
            group: def.ui.group,
            // omp ui.options is not always an array for every setting (some
            // defs carry an object map); normalize so the GUI never hits
            // `opts.map is not a function`.
            options: Array.isArray(def.ui.options) ? def.ui.options : undefined,
          };
        }
        if (Array.isArray(def?.values)) {
          entry.enumValues = def.values.map((v) => String(v));
        }
        entry.credential = def?.credential === true || def?.ui?.secret === true;
        if ('default' in (def ?? {})) entry.defaultValue = def.default;
        settings.push(entry);
      }

      return { ok: true, schema: { tabs: tabList, groups, settings } };
    } catch (err) {
      return { ok: false, error: `settings schema: ${msg(err)}` };
    }
  }

  /**
   * Resolve the schema surface. The top-level package re-exports only TYPE
   * forms of SETTINGS_SCHEMA/SETTING_TABS/TAB_GROUPS (they live in
   * config/settings-schema.ts); load them via the `./config/settings-schema`
   * subpath when the top-level exports are absent, so a Settings editor can be
   * generated from omp's own schema. Both paths feature-detected (update-safe).
   */
  async #loadSettingsSchema(): Promise<{
    schema: Record<string, OmpSettingDef>;
    tabsRaw: Array<string | OmpSettingUi>;
    groups: Record<string, string[]>;
  }> {
    const sdk = this.sdk;
    const fromSdk = {
      schema: (sdk?.SETTINGS_SCHEMA as Record<string, OmpSettingDef> | undefined) ?? {},
      tabsRaw: (sdk?.SETTING_TABS as Array<string | OmpSettingUi> | undefined) ?? [],
      groups: (sdk?.TAB_GROUPS as Record<string, string[]> | undefined) ?? {},
    };
    if (Object.keys(fromSdk.schema).length > 0) return fromSdk;
    // Fall back to the subpath export (Bun resolves `./config/settings-schema.js`
    // to the TS source). Dynamic import keeps Node tests free of the Bun-only
    // module graph when it is never needed.
    const sub: unknown = await import('@oh-my-pi/pi-coding-agent/config/settings-schema');
    const sm = sub as {
      SETTINGS_SCHEMA?: Record<string, OmpSettingDef>;
      SETTING_TABS?: Array<string | OmpSettingUi>;
      TAB_GROUPS?: Record<string, string[]>;
    };
    return {
      schema: sm.SETTINGS_SCHEMA ?? {},
      tabsRaw: sm.SETTING_TABS ?? [],
      groups: sm.TAB_GROUPS ?? {},
    };
  }

  /** Read current effective settings for a list of setting paths. */
  async settingsGet(
    paths: string[],
  ): Promise<{ ok: boolean; values?: Record<string, unknown>; error?: string }> {
    if (!(await this.ensure()) || !this.#has('Settings')) {
      return { ok: false, error: 'settings unavailable' };
    }
    try {
      const instance = await this.sdk?.Settings?.loadReadOnly();
      if (!instance) return { ok: false, error: 'settings unavailable' };
      const values: Record<string, unknown> = {};
      for (const p of paths) {
        try {
          const v = instance.get(p);
          if (v !== undefined) values[p] = v;
        } catch {
          /* path outside schema — ignore */
        }
      }
      return { ok: true, values };
    } catch (err) {
      return { ok: false, error: msg(err) };
    }
  }

  /** Write a single setting to the user config via the SDK's own set/flush. */
  async settingsSet(path: string, value: unknown): Promise<{ ok: boolean; error?: string }> {
    if (!(await this.ensure()) || !this.#has('Settings')) {
      return { ok: false, error: 'settings unavailable' };
    }
    try {
      const instance = await this.sdk?.Settings?.loadIsolated();
      if (!instance) return { ok: false, error: 'settings unavailable' };
      instance.set(path, value);
      await instance.flush();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: msg(err) };
    }
  }

  /* ─── Providers / models ────────────────────────────────────────────── */

  /**
   * Full provider catalog: every provider omp knows (bundled + custom).
   * This is the STANDALONE facade path (its own per-call registry+storage);
   * the route layer prefers EngineService's LIVE instances when the engine
   * has started — same DTO shape either way. Auth truth comes from the
   * storage's hasAuth (model rows carry no auth field), authOrigin from
   * getCredentialOrigin, custom from the models.yml providers map, and
   * discoveryStatus from the registry's per-provider state object.
   */
  async listProviders(): Promise<{ ok: boolean; providers?: ProviderDto[]; error?: string }> {
    if (!(await this.ensure())) return { ok: false, error: 'engine unavailable' };
    try {
      const ModelRegistry = this.sdk?.ModelRegistry;
      const discoverAuthStorage = this.sdk?.discoverAuthStorage;
      if (!ModelRegistry || !discoverAuthStorage) {
        return { ok: false, error: 'ModelRegistry unavailable' };
      }
      const auth = await discoverAuthStorage();
      const registry = new ModelRegistry(auth, undefined, {});
      if (registry != null && typeof registry === 'object') {
        if (typeof registry.refresh === 'function') await registry.refresh();
        else registry.refreshInBackground?.();
      }
      const all = registry?.getAll?.() ?? [];
      const authStore = auth as OmpAuthStorageLike;
      const customNames = await this.#customProviderNames();

      const row = (pid: string, baseUrl?: string): ProviderDto => {
        const dto: ProviderDto = {
          id: pid,
          name: pid,
          baseUrl,
          modelCount: 0,
          models: [],
          authenticated: false,
          discoverable: false,
          custom: customNames.has(pid),
        };
        try {
          dto.authenticated = authStore.hasAuth?.(pid) === true;
        } catch {
          /* auth-store quirk on one row never sinks the catalog */
        }
        try {
          const kind = authStore.getCredentialOrigin?.(pid)?.kind;
          if (kind !== undefined && kind in AUTH_ORIGIN_KINDS)
            dto.authOrigin = kind as ProviderAuthOrigin;
        } catch {
          /* older SDK: no origin info */
        }
        try {
          // getProviderDiscoveryState returns a STATE OBJECT; the string
          // form the GUI renders lives on its .status.
          const state = registry?.getProviderDiscoveryState?.(pid);
          if (
            state !== null &&
            typeof state === 'object' &&
            'status' in state &&
            typeof state.status === 'string'
          )
            dto.discoveryStatus = state.status;
        } catch {
          /* older SDK: no discovery state */
        }
        return dto;
      };

      const byProvider = new Map<string, ProviderDto>();
      for (const m of all) {
        const pid = m?.provider;
        if (!pid) continue;
        let rec = byProvider.get(pid);
        if (!rec) {
          rec = row(pid, m?.baseUrl);
          byProvider.set(pid, rec);
        }
        rec.modelCount++;
        if (rec.models.length < 20 && m?.id) rec.models.push(m.id);
      }
      // Mark discoverable runtime providers (Ollama/llama.cpp/vLLM/...) even
      // when they carry no static models yet.
      try {
        const disc = registry?.getDiscoverableProviders?.() ?? [];
        for (const pid of disc) {
          const rec = byProvider.get(pid);
          if (rec) rec.discoverable = true;
          else {
            const created = row(pid);
            created.discoverable = true;
            byProvider.set(pid, created);
          }
        }
      } catch {
        /* discovery is best-effort */
      }
      return { ok: true, providers: Array.from(byProvider.values()) };
    } catch (err) {
      return { ok: false, error: `providers: ${msg(err)}` };
    }
  }

  /** Provider names owned by models.yml — the `custom` truth. Best-effort by
   *  design: an unreadable/absent config degrades to an empty set (every row
   *  renders custom:false) instead of failing the catalog. The bun-YAML read
   *  is dynamic because the module does not exist off-Bun (this class runs
   *  its Node life without ever touching it). */
  async #customProviderNames(): Promise<Set<string>> {
    try {
      const text = fs.readFileSync(join(homedir(), '.omp', 'agent', 'models.yml'), 'utf8');
      const bunMod: unknown = await import('bun');
      const bun = bunMod as { YAML: { parse(text: string): unknown } };
      return new Set(providerNamesIn(bun.YAML.parse(text)));
    } catch {
      return new Set();
    }
  }

  /* ─── Agents (omp agent definitions) ────────────────────────────────── */

  /**
   * List agent definitions. omp ships bundled subagent definitions
   * (`task`, `scout`, `reviewer`, ...) plus user/project agent markdown in
   * `~/.omp/agent/agents/*.md` and `<project>/.omp/agents/*.md`.
   * We surface those files (defensive: file-format is `--- frontmatter --- body`).
   */
  async listAgents(): Promise<{ ok: boolean; agents?: AgentDefDto[]; error?: string }> {
    if (!(await this.ensure())) {
      return { ok: false, error: 'engine unavailable' };
    }
    const out: AgentDefDto[] = [];
    out.push(...this.#bundledAgents());
    // User + project agent markdown.
    const roots = [
      join(homedir(), '.omp', 'agent', 'agents'),
      join(process.cwd(), '.omp', 'agents'),
    ];
    for (const root of roots) {
      if (!fs.existsSync(root)) continue;
      for (const name of fs.readdirSync(root)) {
        if (!name.endsWith('.md')) continue;
        const file = join(root, name);
        try {
          const raw = fs.readFileSync(file, 'utf8');
          const fm = parseAgentFrontmatter(raw);
          out.push({
            name: fm.name ?? name.replace(/\.md$/, ''),
            description: fm.description,
            source: root.includes(homedir()) ? 'user' : 'project',
            path: file,
            body: fm.body,
            frontmatter: fm.frontmatter,
          });
        } catch {
          /* skip unreadable agent file */
        }
      }
    }
    // Dedupe by name (bundled first).
    const seen = new Set<string>();
    const dedup = out.filter((a) => (seen.has(a.name) ? false : (seen.add(a.name), true)));
    return { ok: true, agents: dedup };
  }

  #bundledAgents(): AgentDefDto[] {
    // omp's bundled subagent definitions are embedded at build time and not
    // enumerated via a public API; the stable list below mirrors the shipped
    // `src/prompts/agents/*.md` set with their canonical descriptions.
    const stable: Array<{ name: string; description: string }> = [
      {
        name: 'task',
        description:
          'General-purpose subagent with full capabilities for delegated multi-step tasks',
      },
      {
        name: 'scout',
        description: 'Read-only research agent for codebase exploration and broad pattern searches',
      },
      {
        name: 'reviewer',
        description: 'Code-review specialist analyzing quality/security of changes',
      },
      {
        name: 'security-reviewer',
        description:
          'Read-only security specialist producing evidence-backed vulnerability findings',
      },
      {
        name: 'librarian',
        description: 'Researches external libraries and APIs by reading source',
      },
      {
        name: 'designer',
        description: 'UI/UX specialist for design implementation and visual refinement',
      },
      { name: 'init', description: 'Initial project scaffolding agent' },
    ];
    return stable.map((a) => ({ ...a, source: 'bundled' as const }));
  }

  /* ─── Skills (all sources) ──────────────────────────────────────────── */

  /** Discover skills from every configured source via the SDK. */
  async listSkills(): Promise<{ ok: boolean; skills?: SkillDto[]; error?: string }> {
    if (!(await this.ensure()) || !this.#has('discoverSkills')) {
      return { ok: false, error: 'skills discovery unavailable' };
    }
    try {
      const res = await this.sdk?.discoverSkills?.();
      const sk = res?.skills;
      const list: unknown[] = Array.isArray(sk) ? sk : [];
      const out: SkillDto[] = list.map((raw) => {
        const s = raw as Record<string, unknown>;
        const rec: SkillDto = {
          name: typeof s?.name === 'string' ? s.name : 'unknown',
          description: typeof s?.description === 'string' ? s.description : '',
          path:
            (typeof s?.filePath === 'string'
              ? s.filePath
              : typeof s?.path === 'string'
                ? s.path
                : '') ?? '',
          body: '',
          source: typeof s?.source === 'string' ? s.source : '',
        };
        return rec;
      });
      for (const rec of out) {
        try {
          if (rec.path && fs.existsSync(rec.path)) {
            rec.body = fs.readFileSync(rec.path, 'utf8');
          }
        } catch {
          /* body optional */
        }
      }
      const warnings = res?.warnings;
      if (Array.isArray(warnings) && warnings.length > 0) {
        const errs = warnings
          .map((w) => {
            const ww = w as { message?: unknown; error?: unknown };
            return typeof w === 'string' ? w : (ww?.message ?? ww?.error ?? JSON.stringify(w));
          })
          .join('; ');
        return { ok: true, skills: out, error: errs || undefined };
      }
      return { ok: true, skills: out };
    } catch (err) {
      return { ok: false, error: `skills: ${msg(err)}` };
    }
  }

  /* ─── On-disk sessions (omp's real persisted sessions) ──────────────── */

  /** List persisted omp sessions for `cwd`'s project dir (default: process
   *  cwd). The GUI passes the chosen workspace so its session list matches
   *  the directory the sessions actually run in. */
  async listDiskSessions(
    cwd?: string,
  ): Promise<{ ok: boolean; sessions?: SessionInfoDto[]; error?: string }> {
    if (!(await this.ensure())) return { ok: false, error: 'engine unavailable' };
    try {
      let rows: unknown[] | undefined;
      if (typeof this.sdk?.listAllSessions === 'function') {
        rows = (await this.sdk.listAllSessions()) as unknown[] | undefined;
      } else if (typeof this.sdk?.listSessionsReadOnly === 'function') {
        rows = (await this.sdk.listSessionsReadOnly()) as unknown[] | undefined;
      } else if (this.sdk?.SessionManager) {
        rows = await this.#listViaSessionManager(this.sdk.SessionManager, cwd);
      }
      if (!rows) return { ok: false, error: 'session listing unavailable' };
      const sessions = rows.map((r) => this.#mapSessionInfo(r));
      // The all-sessions paths are global; scope them to the chosen workspace
      // like the SessionManager project-dir fallback does. Rows whose cwd is
      // unknown (unexpected omp shape) stay visible — never hide on parse drift.
      const scoped = cwd
        ? sessions.filter((s) => !s.cwd || s.cwd === cwd || s.cwd.startsWith(cwd + sep))
        : sessions;
      return { ok: true, sessions: scoped };
    } catch (err) {
      return { ok: false, error: `sessions: ${msg(err)}` };
    }
  }

  async #listViaSessionManager(
    manager: OmpSessionManager,
    cwd?: string,
  ): Promise<unknown[] | undefined> {
    if (typeof manager.listAllSessions === 'function') {
      return (await manager.listAllSessions()) as unknown[] | undefined;
    }
    if (typeof manager.list === 'function' && typeof manager.getDefaultSessionDir === 'function') {
      const dir = manager.getDefaultSessionDir(cwd ?? process.cwd());
      return (await manager.list(dir)) as unknown[] | undefined;
    }
    return undefined;
  }

  #mapSessionInfo(raw: unknown): SessionInfoDto {
    const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
    const str = (...keys: string[]) => {
      for (const k of keys) {
        if (typeof r[k] === 'string') return r[k];
      }
      return '';
    };
    return {
      id: str('id', 'sessionId'),
      path: str('path'),
      cwd: str('cwd'),
      name: str('name', 'displayName', 'id'),
      displayName: str('displayName') || undefined,
      modified: str('modified'),
      status: str('status') || undefined,
      firstUserMessage: str('firstUserMessage') || undefined,
    };
  }

  /** Read a persisted session's transcript by file path. The path arrives
   *  from the GUI as a raw query value, so it is CONFINED to the omp session
   *  roots first (see confineSessionPath). Every confinement rejection —
   *  outside, wrong extension, missing, not a regular file, symlink escape —
   *  answers the same fixed message: no fs error text, no path echo (no
   *  filesystem oracle). The read itself is BOUNDED: the file is stat'd and
   *  refused over SESSION_JOURNAL_MAX_BYTES without its content ever being
   *  read, and parsing stops at SESSION_JOURNAL_MAX_LINES with
   *  `truncated: true` on the transcript — a huge journal can never pin the
   *  event loop. */
  async readDiskSession(
    path: string,
  ): Promise<{ ok: boolean; transcript?: SessionTranscriptDto; error?: string }> {
    if (!(await this.ensure())) return { ok: false, error: 'engine unavailable' };
    // Roots + guard are the SINGLE source in engine-service.ts (shared with
    // EngineService.resumeSession) — a path outside them is a fixed 404.
    const confined = confineSessionPath(path, defaultSessionRoots(this.sdk?.SessionManager));
    if (!confined.ok) return { ok: false, error: 'session not found' };
    try {
      // Bound the sync read BEFORE touching content (stat is O(1)): an
      // oversized journal is refused, never slurped into the event loop.
      const stat = fs.statSync(confined.path);
      if (!stat.isFile()) return { ok: false, error: 'session not found' };
      if (stat.size > SESSION_JOURNAL_MAX_BYTES) {
        return { ok: false, error: 'session transcript too large' };
      }
      const raw = fs.readFileSync(confined.path, 'utf8');
      const lines = raw.split('\n').filter((l) => l.trim());
      // Bound the parse too: past the cap the transcript is a truncated prefix.
      const truncated = lines.length > SESSION_JOURNAL_MAX_LINES;
      if (truncated) lines.length = SESSION_JOURNAL_MAX_LINES;
      const messages: SessionTranscriptDto['messages'] = [];
      let id = '';
      let name: string | undefined;
      for (const line of lines) {
        try {
          const obj = JSON.parse(line) as Record<string, unknown>;
          if (obj?.type === 'session' || !obj?.type) {
            if (typeof obj?.id === 'string') id = obj.id;
            if (typeof obj?.name === 'string') name = obj.name;
          }
          if (obj?.type === 'message') {
            // Lines are { type:'message', message: { role, content } }; unwrap.
            const message =
              obj.message !== undefined && typeof obj.message === 'object'
                ? (obj.message as Record<string, unknown>)
                : obj;
            const text = extractText(message);
            if (text) {
              messages.push({
                role: typeof message.role === 'string' ? message.role : 'assistant',
                text,
                timestamp: typeof obj?.timestamp === 'string' ? obj.timestamp : undefined,
              });
            }
          }
        } catch {
          /* skip non-JSON line */
        }
      }
      return {
        ok: true,
        transcript: {
          id: id || confined.path,
          path: confined.path,
          name,
          messages,
          ...(truncated ? { truncated: true } : {}),
        },
      };
    } catch {
      // Vanished/raced between confinement and read: fixed answer, no oracle.
      return { ok: false, error: 'session not found' };
    }
  }
}

/** confineSessionPath + ConfinedSessionPath now live in engine-service.ts:
 *  EngineService.resumeSession confines resume paths with the SAME guard,
 *  and engine-service.ts must not import this module (omp-facade already
 *  depends on it — definitions here would form a cycle). Re-exported so
 *  existing consumers keep importing them from here. */
export { confineSessionPath } from './engine-service.js';
export type { ConfinedSessionPath } from './engine-service.js';

function extractText(obj: Record<string, unknown>): string {
  if (typeof obj?.content === 'string') return obj.content;
  if (Array.isArray(obj?.content)) {
    return (obj.content as unknown[])
      .filter(
        (c) =>
          c &&
          typeof c === 'object' &&
          (c as Record<string, unknown>)?.type === 'text' &&
          typeof (c as Record<string, unknown>)?.text === 'string',
      )
      .map((c) => (c as Record<string, unknown>).text as string)
      .join('\n');
  }
  if (typeof obj?.text === 'string') return obj.text;
  return '';
}

/** Minimal `--- frontmatter --- body` parser for agent definition files. */
function parseAgentFrontmatter(raw: string): {
  name?: string;
  description?: string;
  body: string;
  frontmatter: Record<string, unknown>;
} {
  const trimmed = raw.replace(/^\uFEFF/, '');
  const fm: Record<string, unknown> = {};
  if (!trimmed.startsWith('---')) return { body: trimmed, frontmatter: fm };
  const end = trimmed.indexOf('\n---', 3);
  if (end < 0) return { body: trimmed, frontmatter: fm };
  const header = trimmed.slice(3, end);
  const body = trimmed.slice(end + 4).replace(/^\n/, '');
  for (const line of header.split('\n')) {
    const m = /^([\w-]+):\s*(.*)$/.exec(line.trim());
    if (m) {
      let v: unknown = m[2].trim();
      if (/^["'].*["']$/.test(String(v))) v = String(v).slice(1, -1);
      fm[m[1]] = v;
    }
  }
  return {
    name: typeof fm.name === 'string' ? fm.name : undefined,
    description: typeof fm.description === 'string' ? fm.description : undefined,
    body,
    frontmatter: fm,
  };
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
