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
import type { WorkspacesService } from '../engine/index.js';

export interface FacadeRouteContext {
  facade: OmpFacade;
  /** Workspace roots used to validate an optional ?cwd= scope. */
  workspaces?: WorkspacesService;
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
  // clients get a presence marker instead, the same truthiness as the
  // providers.ts apiKeyConfigured flag: true when a non-empty value is
  // stored, false when empty/undefined. The write path (PUT /api/omp/settings)
  // still accepts and stores the real value unchanged.
  const values: Record<string, unknown> = { ...r.values };
  for (const s of schemaRes.schema.settings) {
    if (!s.credential) continue;
    values[s.path] = Boolean(values[s.path]);
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
  const r = await ctx.facade.listProviders();
  if (!r.ok) return jsonResponse(res, 501, { error: r.error ?? 'providers unavailable' });
  jsonResponse(res, 200, { providers: r.providers });
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
