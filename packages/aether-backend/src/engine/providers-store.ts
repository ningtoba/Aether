/**
 * providers-store — models.yml provider control-plane primitives.
 *
 * Two halves, deliberately separated:
 *
 *  1. PURE validate/merge functions (the whole top half of this file). They
 *     take the already-parsed config plus raw (untrusted) input and return a
 *     discriminated result — never throw, never touch the filesystem, and
 *     import NO bun/YAML machinery so the entire module stays Node-safe for
 *     the vitest suite.
 *  2. `ModelsYamlStore` — a tiny file store over the SAME pure shape. It is
 *     codec-injected (`parse`/`stringify`), so production wires bun's YAML +
 *     the SDK's `stringifyYamlConfig` (engine-service.ts) while tests inject
 *     a deterministic JSON codec. Writes are atomic: tmp file + rename.
 *
 * SECURITY: `apiKey` values flow through here (they land in models.yml) but
 * are NEVER part of an error message or log line — every rejection message is
 * a fixed string. Callers must not echo the input back either.
 */
import * as fs from 'node:fs';
import { basename, dirname, join } from 'node:path';

/* ─── Limits & patterns (contract-fixed) ─────────────────────────────── */

/** Custom provider ids: lowercase, start alphanumeric, ≤ 64 chars total. */
export const PROVIDER_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** API-key ceiling (both the PUT /key route and models.yml inline keys). */
export const MAX_API_KEY_LENGTH = 4096;

/** Hard cap on providers present in models.yml (mirrors the legacy 500 cap). */
export const MAX_PROVIDERS = 500;

/** Cap on inline model declarations per provider. */
export const MAX_MODELS_PER_PROVIDER = 50;

/* ─── Result shape ───────────────────────────────────────────────────── */

/** Fixed-text rejection carrying the HTTP status the route must answer. */
export interface StoreRejection {
  ok: false;
  status: 400 | 409 | 500;
  error: string;
}

export type StoreResult<T> = { ok: true; value: T } | StoreRejection;

/* ─── Untrusted input shapes ─────────────────────────────────────────── */

/** POST /api/omp/providers body slice this module validates (all unknown:
 *  JSON is untyped and hostile). */
export interface CreateProviderInput {
  name?: unknown;
  baseUrl?: unknown;
  apiKey?: unknown;
  api?: unknown;
  /** Only 'none' is accepted (keyless local servers). */
  auth?: unknown;
  models?: unknown;
}

/* ─── Config accessors (defensive over arbitrary YAML shapes) ────────── */

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** The `providers` map of a parsed models.yml, or {} when absent/foreign. */
export function providersOf(config: unknown): Record<string, unknown> {
  if (!isPlainObject(config)) return {};
  const providers = config.providers;
  return isPlainObject(providers) ? providers : {};
}

/** Provider names owned by models.yml (the `custom` truth for the DTO). */
export function providerNamesIn(config: unknown): string[] {
  return Object.keys(providersOf(config));
}

/** The models.yml entry for one provider, when it is a plain mapping. */
export function providerEntryIn(config: unknown, id: string): Record<string, unknown> | undefined {
  const entry = providersOf(config)[id];
  return isPlainObject(entry) ? entry : undefined;
}

/* ─── API key validation (PUT /api/omp/providers/:id/key + create) ───── */

export type ApiKeyResult = { ok: true; key: string } | { ok: false; error: string };

/** Fixed message on purpose: one string for every failure mode, so the 400
 *  oracle reveals nothing about which rule rejected the value. */
const API_KEY_REJECTED = 'apiKey must be a non-empty string of at most 4096 characters';

/** Trim + bounds-check a submitted API key. NEVER echo the value anywhere. */
export function validateApiKeyInput(raw: unknown): ApiKeyResult {
  if (typeof raw !== 'string') return { ok: false, error: API_KEY_REJECTED };
  const key = raw.trim();
  if (key.length === 0 || key.length > MAX_API_KEY_LENGTH)
    return { ok: false, error: API_KEY_REJECTED };
  return { ok: true, key };
}

/* ─── Create validation/merge ────────────────────────────────────────── */

export interface MergedProvider {
  name: string;
  /** The entry written under providers.<name> (may contain the inline key —
   *  never serialize this back to a client). */
  entry: Record<string, unknown>;
  /** Full next config: existing keys preserved by reference-equal merge. */
  config: Record<string, unknown>;
}

const NAME_REJECTED = 'provider.name must match ^[a-z0-9][a-z0-9_-]{0,63}$';
const BASE_URL_REJECTED = 'provider.baseUrl must be an absolute http(s) URL';
const DUPLICATE = 'provider already exists';
const CAP_REACHED = `provider limit reached (${MAX_PROVIDERS} max)`;

function isHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Validate a create-provider request against the CURRENT models.yml config
 * and return the merged next config, or a fixed-text rejection.
 *
 * Rules (contract): name pattern; 409 when the name already has a models.yml
 * entry (the caller separately 409s on registry-known/bundled names); http(s)
 * baseUrl; apiKey required (non-empty ≤4096) when models[] is non-empty and
 * auth!=='none'; ≤50 models with non-empty ids and positive-integer
 * contextWindow/maxTokens; api defaults to 'openai-completions'; total
 * providers ≤500. All unrelated keys (top-level and per-provider) are
 * preserved verbatim — only providers.<name> is added.
 */
export function mergeNewProvider(
  existingConfig: unknown,
  input: CreateProviderInput,
): StoreResult<MergedProvider> {
  if (!isPlainObject(input)) return { ok: false, status: 400, error: NAME_REJECTED };

  // name
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!PROVIDER_NAME_PATTERN.test(name)) return { ok: false, status: 400, error: NAME_REJECTED };

  // baseUrl
  const baseUrl = typeof input.baseUrl === 'string' ? input.baseUrl.trim() : '';
  if (!baseUrl || baseUrl.length > 2048 || !isHttpUrl(baseUrl))
    return { ok: false, status: 400, error: BASE_URL_REJECTED };

  // auth: only 'none' is accepted.
  if (input.auth !== undefined && input.auth !== 'none')
    return { ok: false, status: 400, error: "provider.auth must be 'none' when present" };
  const keyless = input.auth === 'none';

  // api (optional, defaulted): omp api identifiers are lowercase slugs.
  let api = 'openai-completions';
  if (input.api !== undefined) {
    if (typeof input.api !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(input.api))
      return { ok: false, status: 400, error: 'provider.api must be a lowercase api identifier' };
    api = input.api;
  }

  // apiKey: required (unless auth:'none'), validated when present.
  let apiKey: string | undefined;
  if (input.apiKey !== undefined) {
    const keyRes = validateApiKeyInput(input.apiKey);
    if (!keyRes.ok) return { ok: false, status: 400, error: keyRes.error };
    apiKey = keyRes.key;
  }
  const modelsProvided = Array.isArray(input.models) && input.models.length > 0;
  if (modelsProvided && !keyless && apiKey === undefined)
    return {
      ok: false,
      status: 400,
      error:
        "provider.apiKey is required when models are declared (use auth: 'none' for keyless servers)",
    };

  // models (optional): ≤50, each {id, contextWindow?, maxTokens?}.
  let models: Array<Record<string, unknown>> | undefined;
  if (input.models !== undefined) {
    if (!Array.isArray(input.models) || input.models.length > MAX_MODELS_PER_PROVIDER)
      return {
        ok: false,
        status: 400,
        error: `provider.models must be an array of at most ${MAX_MODELS_PER_PROVIDER} entries`,
      };
    const entries: Array<Record<string, unknown>> = [];
    for (const raw of input.models) {
      if (!isPlainObject(raw))
        return { ok: false, status: 400, error: 'provider.models entries must be objects' };
      const id = typeof raw.id === 'string' ? raw.id.trim() : '';
      if (!id)
        return { ok: false, status: 400, error: 'provider.models[].id must be a non-empty string' };
      const entry: Record<string, unknown> = { id };
      for (const field of ['contextWindow', 'maxTokens'] as const) {
        const v = raw[field];
        if (v !== undefined) {
          if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0)
            return {
              ok: false,
              status: 400,
              error: `provider.models[].${field} must be a positive integer`,
            };
          entry[field] = v;
        }
      }
      entries.push(entry);
    }
    // Empty arrays are not written (the entry field is optional).
    models = entries.length > 0 ? entries : undefined;
  }

  // Duplicate + cap over the CURRENT models.yml providers map. (Bundled/known
  // names are the caller's registry-level 409.)
  const providers = providersOf(existingConfig);
  if (Object.prototype.hasOwnProperty.call(providers, name))
    return { ok: false, status: 409, error: DUPLICATE };
  if (Object.keys(providers).length >= MAX_PROVIDERS)
    return { ok: false, status: 409, error: CAP_REACHED };

  // Entry per contract order: { baseUrl, apiKey?, api?, auth?, models? }.
  // Unrelated keys inside an existing entry can't exist here (fresh name), so
  // the entry is built clean.
  const entry: Record<string, unknown> = { baseUrl };
  if (apiKey !== undefined) entry.apiKey = apiKey;
  entry.api = api;
  if (keyless) entry.auth = 'none';
  if (models !== undefined) entry.models = models;

  // Merge WITHOUT mutating the input object.
  const base = isPlainObject(existingConfig) ? existingConfig : {};
  const config: Record<string, unknown> = { ...base, providers: { ...providers, [name]: entry } };
  return { ok: true, value: { name, entry, config } };
}

/* ─── Delete merge ───────────────────────────────────────────────────── */

/** Fixed message: a non-models.yml id is by definition bundled/known. */
const NOT_CUSTOM = 'built-in providers cannot be deleted; remove their key instead';

/** Remove providers.<id> from the config, preserving every other key.
 *  Rejects 400 (with the contract-fixed message) when the id is not an
 *  existing plain-object models.yml entry. */
export function mergeRemovedProvider(
  existingConfig: unknown,
  id: string,
): StoreResult<Record<string, unknown>> {
  const providers = providersOf(existingConfig);
  if (!Object.prototype.hasOwnProperty.call(providers, id) || !isPlainObject(providers[id]))
    return { ok: false, status: 400, error: NOT_CUSTOM };
  const nextProviders: Record<string, unknown> = { ...providers };
  delete nextProviders[id];
  const base = isPlainObject(existingConfig) ? existingConfig : {};
  return { ok: true, value: { ...base, providers: nextProviders } };
}

/* ─── ModelsYamlStore (codec-injected, atomic writes) ────────────────── */

export interface YamlCodecs {
  parse(text: string): unknown;
  stringify(value: unknown): string;
}

/** Sequence for unique tmp names within this process. */
let writeSeq = 0;

/**
 * Read-modify-write store for one YAML config file. Codecs are INJECTED:
 * production wires bun YAML + stringifyYamlConfig (see engine-service.ts);
 * tests inject a deterministic codec. Everything else is plain node fs, so
 * this class itself never requires the Bun runtime.
 */
export class ModelsYamlStore {
  constructor(
    private readonly path: string,
    private readonly codecs: YamlCodecs,
  ) {}

  /** Absolute path of the managed file (diagnostics only — never serialized
   *  into an API response). */
  get filePath(): string {
    return this.path;
  }

  /** Parse the file. Missing file → {} (a fresh models.yml is legitimately
   *  absent until first write). Errors return fixed-text rejections — no
   *  path, no file content, no parse detail. */
  async load(): Promise<StoreResult<Record<string, unknown>>> {
    let text: string;
    try {
      text = fs.readFileSync(this.path, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { ok: true, value: {} };
      return { ok: false, status: 500, error: 'provider config could not be read' };
    }
    // Empty/whitespace-only file is an EMPTY config, not a parse error:
    // bun's YAML.parse('') yields null (handled below the parse); a codec
    // that throws on '' must hit this guard first so a zero-byte
    // models.yml never wedges provider CRUD with a fixed 500.
    if (text.trim().length === 0) return { ok: true, value: {} };
    let parsed: unknown;
    try {
      parsed = this.codecs.parse(text);
    } catch {
      return { ok: false, status: 500, error: 'provider config could not be parsed' };
    }
    if (parsed === undefined || parsed === null) return { ok: true, value: {} };
    if (typeof parsed !== 'object' || Array.isArray(parsed))
      return { ok: false, status: 500, error: 'provider config is not a mapping' };
    return { ok: true, value: parsed as Record<string, unknown> };
  }

  /** Serialize + ATOMIC write: tmp file in the same directory, chmod, then
   *  rename. A crash mid-write can never truncate the live models.yml;
   *  concurrent readers see either the old or the new complete file.
   *  Pre-write state is copied to `models.yml.bak` (single generation) —
   *  rename atomicity protects against torn writes, the .bak protects
   *  against a logic-level bad merge. Throws on failure (the caller maps
   *  it to a fixed 500); the tmp file is cleaned up. */
  async save(config: Record<string, unknown>): Promise<void> {
    const text = this.codecs.stringify(config);
    const dir = dirname(this.path);
    fs.mkdirSync(dir, { recursive: true });
    // Backup of the pre-write file (absent file → nothing), with a hard
    // invariant: models.yml.bak exists at 0600 or does not exist at all.
    // copyFileSync inherits the SOURCE mode — a world-readable 644 live
    // file (or a previous 0644 bak being overwritten) must never yield a
    // world-readable copy of inline apiKeys; an unclosable gap deletes the
    // backup instead. Backup trouble never blocks the write itself.
    try {
      fs.copyFileSync(this.path, `${this.path}.bak`);
      fs.chmodSync(`${this.path}.bak`, 0o600);
    } catch {
      try {
        fs.rmSync(`${this.path}.bak`, { force: true });
      } catch {
        /* could not delete either: nothing more we can do here */
      }
    }
    const tmp = join(dir, `.${basename(this.path)}.${process.pid}.${++writeSeq}.tmp`);
    try {
      fs.writeFileSync(tmp, text, 'utf8');
      // Entries may carry an INLINE apiKey; the store must never expose it
      // at umask defaults (644) even momentarily — omp's own credential
      // store is 0600, so chmod the tmp BEFORE it becomes the live file.
      fs.chmodSync(tmp, 0o600);
      fs.renameSync(tmp, this.path);
    } catch (err) {
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        /* best-effort cleanup */
      }
      throw err;
    }
  }
}
