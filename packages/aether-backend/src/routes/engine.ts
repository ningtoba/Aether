/**
 * Engine API routes — sessions, loops, skills, models.
 *
 * These handlers translate REST calls into EngineService / LoopManager /
 * SkillsService operations. Engine-backed routes return a clear 501 when the
 * engine is unavailable (plain-Node runtime), so the web GUI can degrade
 * gracefully instead of hanging.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RouteParams } from '../router.js';
import { jsonResponse, parseBody, notFound, badRequest, serverError } from '../utils.js';
import type { EngineService, EngineSession } from '../engine/index.js';
import { EngineUnavailableError } from '../engine/index.js';
import type { LoopManager } from '../engine/index.js';
import type { SkillsService } from '../engine/index.js';
import type { LoopDefinition } from '../engine/index.js';
import type { WorkspacesService } from '../engine/index.js';

export interface EngineRouteContext {
  engine: EngineService;
  loops: LoopManager;
  skills: SkillsService;
  workspaces: WorkspacesService;
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

/** Engine-unavailable tunnels back a degraded, explicit response. */
function handleEngineError(res: ServerResponse, err: unknown): void {
  if (err instanceof EngineUnavailableError) {
    jsonResponse(res, 501, { error: err.message });
  } else {
    serverError(res, err instanceof Error ? err.message : String(err));
  }
}

function msg(err: unknown): string {
  if (err instanceof EngineUnavailableError) return `engine unavailable: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

/* ─── Models ─────────────────────────────────────────────────────────── */

export async function listModels(
  _req: IncomingMessage,
  res: ServerResponse,
  _p: RouteParams,
  ctx: EngineRouteContext,
): Promise<void> {
  try {
    const groups = await ctx.engine.listModels();
    jsonResponse(res, 200, { groups });
  } catch (err) {
    handleEngineError(res, err);
  }
}

/* ─── Sessions ───────────────────────────────────────────────────────── */

function sessionToSummary(session: EngineSession): Record<string, unknown> {
  const model = session.model;
  return {
    id: session.id,
    name: session.id,
    cwd: session.cwd,
    model,
    status: session.status,
    messageCount: session.messageCount,
    createdAt: new Date().toISOString(),
    stats: session.stats(),
  };
}

export async function listSessions(
  _req: IncomingMessage,
  res: ServerResponse,
  _p: RouteParams,
  ctx: EngineRouteContext,
): Promise<void> {
  jsonResponse(res, 200, { sessions: ctx.engine.listSessions().map(sessionToSummary) });
}

export async function createSession(
  req: IncomingMessage,
  res: ServerResponse,
  _p: RouteParams,
  ctx: EngineRouteContext,
): Promise<void> {
  const body = await jsonBody<{ cwd?: string; model?: { provider: string; modelId: string } }>(
    req,
    res,
    'model',
  );
  if (!body) return;
  if (!body.model || !body.model.provider || !body.model.modelId) {
    return badRequest(res, 'model.provider and model.modelId required');
  }
  try {
    const cwd = ctx.workspaces.resolveCwd(body.cwd);
    if ('error' in cwd) return badRequest(res, cwd.error);
    const session = await ctx.engine.createSession({
      cwd: cwd.path,
      model: body.model,
    });
    jsonResponse(res, 201, { session: sessionToSummary(session) });
  } catch (err) {
    handleEngineError(res, err);
  }
}

export async function getSessionInfo(
  _req: IncomingMessage,
  res: ServerResponse,
  params: RouteParams,
  ctx: EngineRouteContext,
): Promise<void> {
  const session = ctx.engine.getSession(params.id as string);
  if (!session) return notFound(res, 'Session not found');
  jsonResponse(res, 200, { session: sessionToSummary(session) });
}
export async function getSessionTranscript(
  _req: IncomingMessage,
  res: ServerResponse,
  params: RouteParams,
  ctx: EngineRouteContext,
): Promise<void> {
  const entries = ctx.engine.transcriptOf(params.id as string);
  if (entries === null) return notFound(res, 'Session not found');
  jsonResponse(res, 200, { transcript: { id: params.id as string, entries } });
}

export async function promptSession(
  req: IncomingMessage,
  res: ServerResponse,
  params: RouteParams,
  ctx: EngineRouteContext,
): Promise<void> {
  const session = ctx.engine.getSession(params.id as string);
  if (!session) return notFound(res, 'Session not found');
  const body = await jsonBody<{ message: string }>(req, res, 'message');
  if (!body) return;
  if (typeof body.message !== 'string' || !body.message.trim()) {
    return badRequest(res, 'message required');
  }
  if (session.busy) {
    return jsonResponse(res, 409, {
      error: `Session ${session.id} is busy — a turn is already running`,
    });
  }
  try {
    void session.prompt(body.message); // events stream over WS
    jsonResponse(res, 202, { accepted: true, sessionId: session.id });
  } catch (err) {
    handleEngineError(res, err);
  }
}

export async function compactSession(
  _req: IncomingMessage,
  res: ServerResponse,
  params: RouteParams,
  ctx: EngineRouteContext,
): Promise<void> {
  const session = ctx.engine.getSession(params.id as string);
  if (!session) return notFound(res, 'Session not found');
  try {
    await session.compact();
    jsonResponse(res, 200, { ok: true });
  } catch (err) {
    handleEngineError(res, err);
  }
}

export async function disposeSession(
  _req: IncomingMessage,
  res: ServerResponse,
  params: RouteParams,
  ctx: EngineRouteContext,
): Promise<void> {
  const session = ctx.engine.getSession(params.id as string);
  if (!session) return notFound(res, 'Session not found');
  try {
    await ctx.engine.disposeSession(session.id);
    jsonResponse(res, 200, { ok: true });
  } catch (err) {
    handleEngineError(res, err);
  }
}

/* ─── Loops ──────────────────────────────────────────────────────────── */

export async function listLoops(
  _req: IncomingMessage,
  res: ServerResponse,
  _p: RouteParams,
  ctx: EngineRouteContext,
): Promise<void> {
  jsonResponse(res, 200, { loops: ctx.loops.list() });
}

export async function saveLoop(
  req: IncomingMessage,
  res: ServerResponse,
  _p: RouteParams,
  ctx: EngineRouteContext,
): Promise<void> {
  const body = await jsonBody<Partial<LoopDefinition>>(req, res, 'loop');
  if (!body) return;
  if (typeof body.prompt !== 'string' || !body.prompt.trim()) {
    return badRequest(res, 'loop.prompt required');
  }
  if (!body.model || !body.model.provider || !body.model.modelId) {
    return badRequest(res, 'loop.model.provider and loop.model.modelId required');
  }
  const cwd = ctx.workspaces.resolveCwd(body.cwd);
  if ('error' in cwd) return badRequest(res, cwd.error);
  const definition: LoopDefinition = {
    id: body.id ?? crypto.randomUUID(),
    name: body.name ?? 'Untitled loop',
    description: body.description,
    prompt: body.prompt,
    transition: {
      kind: body.transition?.kind ?? 'none',
      skillName: body.transition?.skillName,
    },
    maxRounds: body.maxRounds && body.maxRounds > 0 ? body.maxRounds : undefined,
    maxTimeMs: body.maxTimeMs && body.maxTimeMs > 0 ? body.maxTimeMs : undefined,
    cwd: body.cwd || process.cwd(),
    model: body.model,
  };
  const saved = ctx.loops.save(definition);
  jsonResponse(res, 201, { loop: saved });
}

export async function getLoop(
  _req: IncomingMessage,
  res: ServerResponse,
  params: RouteParams,
  ctx: EngineRouteContext,
): Promise<void> {
  const def = ctx.loops.get(params.id as string);
  if (!def) return notFound(res, 'Loop not found');
  const progress = ctx.loops.progressOf(params.id as string);
  jsonResponse(res, 200, { loop: def, progress: progress ?? null });
}

export async function deleteLoop(
  _req: IncomingMessage,
  res: ServerResponse,
  params: RouteParams,
  ctx: EngineRouteContext,
): Promise<void> {
  const removed = ctx.loops.remove(params.id as string);
  if (!removed) return badRequest(res, 'Cannot delete loop (not found or running)');
  jsonResponse(res, 200, { ok: true });
}

export async function startLoop(
  _req: IncomingMessage,
  res: ServerResponse,
  params: RouteParams,
  ctx: EngineRouteContext,
): Promise<void> {
  try {
    const progress = await ctx.loops.start(params.id as string);
    jsonResponse(res, 200, { progress });
  } catch (err) {
    handleEngineError(res, err);
  }
}

export async function stopLoop(
  _req: IncomingMessage,
  res: ServerResponse,
  params: RouteParams,
  ctx: EngineRouteContext,
): Promise<void> {
  try {
    const progress = await ctx.loops.stop(params.id as string);
    if (!progress) return notFound(res, 'Loop not found');
    jsonResponse(res, 200, { progress });
  } catch (err) {
    handleEngineError(res, err);
  }
}

export async function advanceLoop(
  req: IncomingMessage,
  res: ServerResponse,
  params: RouteParams,
  ctx: EngineRouteContext,
): Promise<void> {
  const id = params.id as string;
  const body = await jsonBody<{ action?: 'continue' | 'stop' }>(req, res, 'action');
  if (!body) return;
  const action = body.action === 'stop' ? 'stop' : 'continue';
  const progress = ctx.loops.advance(id, action);
  if (!progress) return notFound(res, 'Loop not found');
  jsonResponse(res, 200, { progress });
}

/* ─── Skills ─────────────────────────────────────────────────────────── */

export async function listSkills(
  _req: IncomingMessage,
  res: ServerResponse,
  _p: RouteParams,
  ctx: EngineRouteContext,
): Promise<void> {
  jsonResponse(res, 200, { skills: ctx.skills.list() });
}
