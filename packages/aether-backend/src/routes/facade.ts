/**
 * Omp facade API routes — status, settings, providers, agents, skills and
 * on-disk sessions, all backed by the defensive OmpFacade so the GUI stays
 * functional across omp SDK upgrades (missing exports degrade to capability
 * "unavailable", never a 500).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RouteParams } from '../router.js';
import { jsonResponse, parseBody, badRequest, serverError } from '../utils.js';
import { OmpFacade } from '../engine/index.js';
import type { WorkspacesService, EngineService } from '../engine/index.js';
import { EngineUnavailableError, ProviderOpError } from '../engine/engine-service.js';
import { validateApiKeyInput, type CreateProviderInput } from '../engine/providers-store.js';

export interface FacadeRouteContext {
  facade: OmpFacade;
  /** Workspace roots used to validate an optional ?cwd= scope. */
  workspaces?: WorkspacesService;
  /** LIVE engine (warm registry + AuthStorage). Required by the provider
   *  mutations and preferred for the catalog read; absent in facade-only
   *  test wirings → mutations degrade 501. */
  engine?: EngineService;
}

/** Parse a JSON body guarding against non-object/array/empty payloads. */
async function jsonBody<T>(
  req: IncomingMessage,
  res: ServerResponse,
  what: string,
): Promise<T | null> {
  const parsed = await parseBody<T>(req);
  if (!parsed.ok) {
    badRequest(res, `Invalid request body: ${what} required`);
    return null;
  }
  const body = parsed.value;
  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    badRequest(res, `Invalid request body: ${what} required`);
    return null;
  }
  return body;
}

function fail(res: ServerResponse, err: unknown, code = 500): void {
  if (err instanceof Error) serverError(res, err.message);
  else jsonResponse(res, code, { error: String(err) });
}

/** Credential presence marker for the settings read surface: true ONLY when
 *  a non-empty value is stored. Empty strings, empty arrays and empty
 *  (recursively-empty) objects count as ABSENT — the old `Boolean(v)` called
 *  `{}` and `[]` storage configured. The secret itself is never serialized. */
function credentialPresent(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value !== '';
  if (Array.isArray(value)) return value.some(credentialPresent);
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>; // object-branch narrowing
    return Object.values(record).some(credentialPresent);
  }
  return true;
}

/* ─── Status / capabilities ──────────────────────────────────────────── */

export async function facadeStatus(
  _req: IncomingMessage,
  res: ServerResponse,
  _p: RouteParams,
  ctx: FacadeRouteContext,
): Promise<void> {
  await ctx.facade.ensure();
  jsonResponse(res, 200, { status: ctx.facade.statusOf() });
}

/* ─── Settings ───────────────────────────────────────────────────────── */

export async function settingsSchema(
  _req: IncomingMessage,
  res: ServerResponse,
  _p: RouteParams,
  ctx: FacadeRouteContext,
): Promise<void> {
  const r = await ctx.facade.settingsSchema();
  if (!r.ok) return jsonResponse(res, 501, { error: r.error ?? 'settings schema unavailable' });
  jsonResponse(res, 200, { schema: r.schema });
}

export async function settingsGet(
  _req: IncomingMessage,
  res: ServerResponse,
  _p: RouteParams,
  ctx: FacadeRouteContext,
): Promise<void> {
  // Read the full schema so we can fetch values for every known path.
  const schemaRes = await ctx.facade.settingsSchema();
  if (!schemaRes.ok || !schemaRes.schema) {
    return jsonResponse(res, 501, { error: schemaRes.error ?? 'settings unavailable' });
  }
  const paths = schemaRes.schema.settings.map((s) => s.path);
  const r = await ctx.facade.settingsGet(paths);
  if (!r.ok) return jsonResponse(res, 501, { error: r.error ?? 'settings unavailable' });
  // Credential-flagged paths (provider API keys etc.) are NEVER echoed back —
  // clients get a presence marker instead: true only when a NON-EMPTY value
  // is stored (empty string/array/object counts as absent — a stored `{}` or
  // `''` is NOT a configured secret). The write path (PUT /api/omp/settings)
  // still accepts and stores the real value unchanged.
  const values: Record<string, unknown> = { ...r.values };
  for (const s of schemaRes.schema.settings) {
    if (!s.credential) continue;
    values[s.path] = credentialPresent(values[s.path]);
  }
  jsonResponse(res, 200, { values });
}

export async function settingsSet(
  req: IncomingMessage,
  res: ServerResponse,
  _p: RouteParams,
  ctx: FacadeRouteContext,
): Promise<void> {
  const body = await jsonBody<{ path?: unknown; value?: unknown }>(req, res, 'path');
  if (!body) return;
  if (typeof body.path !== 'string' || !body.path) {
    return badRequest(res, 'settings.path required');
  }
  // WRITE-side schema gate: the facade persists verbatim into the user's
  // live ~/.omp/agent config, so arbitrary keys must never reach it. Only
  // paths omp's own SETTINGS_SCHEMA declares are writable — same source the
  // read surface uses (settingsGet), and unavailable schema degrades 501.
  const schemaRes = await ctx.facade.settingsSchema();
  if (!schemaRes.ok || !schemaRes.schema) {
    return jsonResponse(res, 501, { error: schemaRes.error ?? 'settings unavailable' });
  }
  const def = schemaRes.schema.settings.find((s) => s.path === body.path);
  if (!def) return badRequest(res, 'unknown settings path');
  // Obvious primitive type mismatches are rejected up front using the
  // schema entry's declared type; complex types (object/array/enum) pass
  // through for the SDK to validate deeper.
  if (def.type === 'string' || def.type === 'number' || def.type === 'boolean') {
    if (body.value !== undefined && typeof body.value !== def.type) {
      return badRequest(res, `settings.value must be ${def.type}`);
    }
  }
  const r = await ctx.facade.settingsSet(body.path, body.value);
  if (!r.ok) return fail(res, new Error(r.error ?? 'settings write failed'));
  jsonResponse(res, 200, { ok: true, path: body.path });
}

/* ─── Providers / models ─────────────────────────────────────────────── */

export async function listFacadeProviders(
  _req: IncomingMessage,
  res: ServerResponse,
  _p: RouteParams,
  ctx: FacadeRouteContext,
): Promise<void> {
  // Engine LIVE instances first: auth truth comes from the warm AuthStorage.
  if (ctx.engine) {
    try {
      const providers = await ctx.engine.listProviderDtos();
      jsonResponse(res, 200, { providers });
      return;
    } catch (err) {
      if (!(err instanceof EngineUnavailableError)) {
        console.error('[Providers] catalog failure:', err);
        return serverError(res);
      }
      // Engine not started → the facade's standalone per-call path (its own
      // discoverAuthStorage + registry, same DTO shape).
    }
  }
  const r = await ctx.facade.listProviders();
  if (!r.ok) return jsonResponse(res, 501, { error: r.error ?? 'providers unavailable' });
  jsonResponse(res, 200, { providers: r.providers });
}

/* ─── Provider control plane (keys + models.yml custom providers) ───── */

/** Mutations need the LIVE engine (warm AuthStorage/registry) — the facade's
 *  per-call storage is catalog truth only, never a write target. Fixed 501
 *  when no engine is wired, matching the server-level degradation text. */
function providerEngineOr501(res: ServerResponse, ctx: FacadeRouteContext): EngineService | null {
  if (ctx.engine) return ctx.engine;
  jsonResponse(res, 501, { error: 'Agent engine not configured (requires Bun runtime)' });
  return null;
}

/** Provider error policy (sibling handleEngineError): engine-degraded → 501,
 *  engine-composed validation/conflict (ProviderOpError) → its status with
 *  the engine's FIXED message (never contains submitted secrets), anything
 *  else → logged server-side + fixed 'Internal server error'. */
function handleProviderError(res: ServerResponse, err: unknown): void {
  if (err instanceof EngineUnavailableError) {
    jsonResponse(res, 501, { error: err.message });
    return;
  }
  if (err instanceof ProviderOpError) {
    jsonResponse(res, err.status, { error: err.message });
    return;
  }
  console.error('[Providers] unexpected route failure:', err);
  serverError(res);
}

/** PUT /api/omp/providers/:id/key — store/replace a provider API key.
 *  The key is consumed by AuthStorage and appears in NO response field. */
export async function setProviderKey(
  req: IncomingMessage,
  res: ServerResponse,
  params: RouteParams,
  ctx: FacadeRouteContext,
): Promise<void> {
  const engine = providerEngineOr501(res, ctx);
  if (!engine) return;
  const id = params.id;
  if (!id) return badRequest(res, 'provider id required');
  const body = await jsonBody<{ apiKey?: unknown }>(req, res, 'apiKey');
  if (!body) return;
  const key = validateApiKeyInput(body.apiKey);
  if (!key.ok) return badRequest(res, key.error);
  try {
    await engine.setProviderApiKey(id, key.key);
  } catch (err) {
    return handleProviderError(res, err);
  }
  jsonResponse(res, 200, { ok: true, provider: id, authenticated: true });
}

/** DELETE /api/omp/providers/:id/key — drop the stored key; `authenticated`
 *  is the POST-removal hasAuth truth, never a guess. */
export async function removeProviderKey(
  _req: IncomingMessage,
  res: ServerResponse,
  params: RouteParams,
  ctx: FacadeRouteContext,
): Promise<void> {
  const engine = providerEngineOr501(res, ctx);
  if (!engine) return;
  const id = params.id;
  if (!id) return badRequest(res, 'provider id required');
  let authenticated: boolean;
  try {
    authenticated = await engine.removeProviderApiKey(id);
  } catch (err) {
    return handleProviderError(res, err);
  }
  jsonResponse(res, 200, { ok: true, provider: id, authenticated });
}

/** POST /api/omp/providers — add a custom provider to models.yml. Response
 *  carries the name only: any inline apiKey is NEVER echoed. */
export async function createProvider(
  req: IncomingMessage,
  res: ServerResponse,
  _p: RouteParams,
  ctx: FacadeRouteContext,
): Promise<void> {
  const engine = providerEngineOr501(res, ctx);
  if (!engine) return;
  const body = await jsonBody<CreateProviderInput>(req, res, 'provider');
  if (!body) return;
  let name: string;
  try {
    name = await engine.createCustomProvider(body);
  } catch (err) {
    return handleProviderError(res, err);
  }
  jsonResponse(res, 201, { ok: true, provider: name });
}

/** DELETE /api/omp/providers/:id — remove a models.yml-owned provider
 *  (entry + stored key). Bundled ids answer 400 with the engine's fixed
 *  'built-in providers cannot be deleted…' message. */
export async function deleteProvider(
  _req: IncomingMessage,
  res: ServerResponse,
  params: RouteParams,
  ctx: FacadeRouteContext,
): Promise<void> {
  const engine = providerEngineOr501(res, ctx);
  if (!engine) return;
  const id = params.id;
  if (!id) return badRequest(res, 'provider id required');
  try {
    await engine.deleteCustomProvider(id);
  } catch (err) {
    return handleProviderError(res, err);
  }
  jsonResponse(res, 200, { ok: true });
}

/** POST /api/omp/providers/:id/verify — reachability report for the
 *  provider's model endpoint. Never the model list, never the key: only
 *  {reachable, modelCount, reason?} where reason is a fixed code. */
export async function verifyProvider(
  _req: IncomingMessage,
  res: ServerResponse,
  params: RouteParams,
  ctx: FacadeRouteContext,
): Promise<void> {
  const engine = providerEngineOr501(res, ctx);
  if (!engine) return;
  const id = params.id;
  if (!id) return badRequest(res, 'provider id required');
  try {
    const r = await engine.verifyProvider(id);
    jsonResponse(res, 200, {
      ok: true,
      provider: id,
      reachable: r.reachable,
      modelCount: r.modelCount,
      ...(r.reason !== undefined ? { reason: r.reason } : {}),
    });
  } catch (err) {
    return handleProviderError(res, err);
  }
}

/* ─── Agents ─────────────────────────────────────────────────────────── */

export async function listFacadeAgents(
  _req: IncomingMessage,
  res: ServerResponse,
  _p: RouteParams,
  ctx: FacadeRouteContext,
): Promise<void> {
  const r = await ctx.facade.listAgents();
  if (!r.ok) return jsonResponse(res, 501, { error: r.error ?? 'agents unavailable' });
  jsonResponse(res, 200, { agents: r.agents });
}

/* ─── Skills (all sources via SDK) ───────────────────────────────────── */

export async function listFacadeSkills(
  _req: IncomingMessage,
  res: ServerResponse,
  _p: RouteParams,
  ctx: FacadeRouteContext,
): Promise<void> {
  const r = await ctx.facade.listSkills();
  if (!r.ok) {
    return jsonResponse(res, 501, { error: r.error ?? 'skills unavailable' });
  }
  jsonResponse(res, 200, { skills: r.skills, warnings: r.error });
}

/* ─── On-disk sessions (omp's persisted sessions) ────────────────────── */

export async function listDiskSessions(
  req: IncomingMessage,
  res: ServerResponse,
  _p: RouteParams,
  ctx: FacadeRouteContext,
): Promise<void> {
  // Optional ?cwd= scopes the listing to a workspace the GUI picked; the path
  // goes through the same validation as session/loop creation (roots only).
  const url = new URL(req.url ?? '', 'http://localhost');
  const raw = url.searchParams.get('cwd');
  let cwd: string | undefined;
  if (raw) {
    if (!ctx.workspaces) return badRequest(res, 'cwd scoping not available');
    const resolved = ctx.workspaces.resolveCwd(raw);
    if ('error' in resolved) return badRequest(res, resolved.error);
    cwd = resolved.path;
  }
  const r = await ctx.facade.listDiskSessions(cwd);
  if (!r.ok) return jsonResponse(res, 501, { error: r.error ?? 'sessions unavailable' });
  jsonResponse(res, 200, { sessions: r.sessions });
}

export async function readDiskSession(
  req: IncomingMessage,
  res: ServerResponse,
  _params: RouteParams,
  ctx: FacadeRouteContext,
): Promise<void> {
  // The raw ?path= value is confined INSIDE the facade, which owns omp's
  // session roots (confineSessionPath): every rejection — outside a root,
  // wrong extension, missing, not a regular file, symlink escape — answers
  // the same fixed 'session not found' with no fs error text and no path
  // echo, so this route is not a filesystem oracle. Empty stays a 400.
  const url = new URL(req.url ?? '', 'http://localhost');
  const path = url.searchParams.get('path') ?? '';
  if (!path) return badRequest(res, 'session path required');
  const r = await ctx.facade.readDiskSession(path);
  if (!r.ok) return jsonResponse(res, 404, { error: r.error ?? 'session not found' });
  jsonResponse(res, 200, { transcript: r.transcript });
}
