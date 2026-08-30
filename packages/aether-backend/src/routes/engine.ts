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
// Error classes the classification below depends on. Deep import (the engine
// barrel is untouched by this slice; it re-exports none of these yet).
import { EngineUserError, SessionResumeRejectedError } from '../engine/engine-service.js';
// Loop lifecycle error taxonomy (also deep imports — the engine barrel stays
// untouched by this slice): LoopUserError marks LoopManager's OWN composed
// guidance, LoopLimitError the definition-cap rejection mapped to 409 below.
import { LoopLimitError, LoopUserError } from '../engine/loop-manager.js';
import type { LoopManager } from '../engine/index.js';
import type { SkillsService } from '../engine/index.js';
import type { LoopDefinition, LoopTransitionKind } from '../engine/index.js';
import { LOOP_TRANSITION_KINDS } from '../engine/types.js';
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

/** Engine-unavailable tunnels back a degraded, explicit response. Classification
 *  follows the server's top-level-catch policy: errors the engine raises ON
 *  PURPOSE with actionable text (EngineUserError catalog verdicts like
 *  "model not served … Served models: …") pass through — the GUI guidance is
 *  built on them. A genuinely unexpected exception can be anything (native SDK
 *  failure, fs path, store key): it is logged server-side and answered with
 *  the fixed 'Internal server error' — raw err.message is never echoed. */
function handleEngineError(res: ServerResponse, err: unknown): void {
  if (err instanceof EngineUnavailableError) {
    jsonResponse(res, 501, { error: err.message });
    return;
  }
  if (err instanceof EngineUserError) {
    serverError(res, err.message);
    return;
  }
  console.error('[Engine] unexpected route failure:', err);
  serverError(res);
}

/** Loop lifecycle errors: echo policy by TYPE, never by construction.
 *  LoopManager's own composed guidance (LoopUserError — "Loop not found: …",
 *  "Loop already running: …", the no-absolute-cwd GUI prompt) and the
 *  engine's EngineUserError catalog verdicts stay verbatim; the GUI copy is
 *  built on them. start() ALSO rethrows whatever createSession threw — raw
 *  SDK/fs errors carrying absolute cwds and ~/.omp journal paths — so the
 *  old blanket passthrough leaked internals while handleEngineError had
 *  closed exactly that for every sibling route. Anything untyped is logged
 *  server-side and answered with the fixed 'Internal server error'. */
function handleLoopError(res: ServerResponse, err: unknown): void {
  if (err instanceof EngineUnavailableError) {
    jsonResponse(res, 501, { error: err.message });
    return;
  }
  if (err instanceof EngineUserError || err instanceof LoopUserError) {
    serverError(res, err.message);
    return;
  }
  console.error('[Engine] unexpected loop route failure:', err);
  serverError(res);
}

function msg(err: unknown): string {
  if (err instanceof EngineUnavailableError) return `engine unavailable: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

/** JSON is untyped: the loop transition kind arrives as an arbitrary string.
 *  Type guard so the validated `kind` narrows for LoopDefinition. */
function isTransitionKind(value: unknown): value is LoopTransitionKind {
  return typeof value === 'string' && (LOOP_TRANSITION_KINDS as readonly string[]).includes(value);
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
    createdAt: new Date(session.createdAtMs).toISOString(),
    /** omp journal path once materialized — the GUI echoes it back as
     *  resumePath to reopen this session after a backend restart. */
    sessionFile: session.sessionFile,
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
  const body = await jsonBody<{
    cwd?: string;
    model?: { provider: string; modelId: string };
    resumePath?: string;
  }>(req, res, 'model');
  if (!body) return;
  if (!body.model || !body.model.provider || !body.model.modelId) {
    return badRequest(res, 'model.provider and model.modelId required');
  }
  // Optional durable resume: with resumePath the session is REOPENED from its
  // persisted journal instead of being created fresh. Only the shape is
  // validated here — the path itself is confined inside EngineService.
  // resumeSession (session roots + realpath + symlink guard), never here.
  if (
    body.resumePath !== undefined &&
    (typeof body.resumePath !== 'string' || !body.resumePath.trim())
  ) {
    return badRequest(res, 'resumePath must be a non-empty string when provided');
  }
  try {
    const cwd = ctx.workspaces.resolveCwd(body.cwd);
    if ('error' in cwd) return badRequest(res, cwd.error);
    if (typeof body.resumePath === 'string') {
      const { session, warning } = await ctx.engine.resumeSession({
        cwd: cwd.path,
        model: body.model,
        sessionFile: body.resumePath,
      });
      // 201 like a fresh create — the client asked for a live session and got
      // one; warning is set when the SDK had to downgrade the restored model.
      jsonResponse(res, 201, {
        session: sessionToSummary(session),
        ...(warning ? { warning } : {}),
      });
      return;
    }
    const session = await ctx.engine.createSession({
      cwd: cwd.path,
      model: body.model,
    });
    jsonResponse(res, 201, { session: sessionToSummary(session) });
  } catch (err) {
    if (err instanceof SessionResumeRejectedError) {
      // Rejected/unresumable path: one fixed 404, NO path echo, no fs detail —
      // the route must not become a filesystem oracle.
      return notFound(res, 'session not found');
    }
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
  // prompt() is async — it can never throw into this handler, so a try/catch
  // here was dead code and a rejection on the fire-and-forget chain escaped as
  // an unhandledRejection (crash on Node ≥15). Attach a real handler: log
  // loudly and mirror the failure onto the session_error channel the engine
  // uses for prompt errors. The busy gate above plus EngineSession.prompt's
  // synchronous running-flip keep the 202 promise exclusive.
  session.prompt(body.message).catch((err) => {
    const cause = err instanceof Error ? err.message : String(err);
    console.error(`[Engine] prompt failed on ${session.id}: ${cause}`);
    session.notifyPromptFailure(cause); // surfaces as a session_error over WS
  });
  jsonResponse(res, 202, { accepted: true, sessionId: session.id });
}

export async function compactSession(
  _req: IncomingMessage,
  res: ServerResponse,
  params: RouteParams,
  ctx: EngineRouteContext,
): Promise<void> {
  const session = ctx.engine.getSession(params.id as string);
  if (!session) return notFound(res, 'Session not found');
  // Same conflict style as the prompt route: a compact racing a live turn
  // would race the model's own context management — refuse at the edge.
  if (session.busy) {
    return jsonResponse(res, 409, {
      error: `Session ${session.id} is busy — a turn is already running`,
    });
  }
  try {
    const compacted = await session.compact();
    // omp's own busy guard can no-op the call after our pre-check (a turn
    // started in between). false means nothing was compacted — say so
    // instead of claiming success.
    if (compacted === false) {
      return jsonResponse(res, 409, {
        error: `Session ${session.id} compact skipped — a turn started; try again`,
      });
    }
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
  // typeof, not just truthiness: isProviderModel on the next boot requires
  // STRINGS, and a persisted number ("provider": 5) made the entry fail the
  // store guard — the saved loop silently vanished on restart.
  if (
    !body.model ||
    typeof body.model.provider !== 'string' ||
    !body.model.provider ||
    typeof body.model.modelId !== 'string' ||
    !body.model.modelId
  ) {
    return badRequest(res, 'loop.model.provider and loop.model.modelId required');
  }
  // The runner dereferences transition fields blindly — validate the whole
  // transition at the edge instead of 500-ing (or silently misbehaving) at
  // start() time.
  const kind = body.transition?.kind ?? 'none';
  if (!isTransitionKind(kind)) {
    return badRequest(
      res,
      `loop.transition.kind must be one of ${LOOP_TRANSITION_KINDS.join('|')}`,
    );
  }
  const rawSkillName = body.transition?.skillName;
  if (rawSkillName !== undefined && typeof rawSkillName !== 'string') {
    return badRequest(res, 'loop.transition.skillName must be a string when provided');
  }
  const rawArgs = body.transition?.args;
  if (rawArgs !== undefined && typeof rawArgs !== 'string') {
    return badRequest(res, 'loop.transition.args must be a string when provided');
  }
  // The store guard (isLoopDefinition) DROPS the whole entry at next boot for
  // a non-integer/≤0 maxRounds, and the old coercion here persisted exactly
  // that (2.5, "5") while silently vanishing 0/negatives. Save/load symmetry:
  // validate with the store's own rule at the edge — absent stays allowed,
  // present must be a positive integer.
  if (body.maxRounds !== undefined && !(Number.isInteger(body.maxRounds) && body.maxRounds > 0)) {
    return badRequest(res, 'maxRounds must be a positive integer');
  }
  if (body.maxTimeMs !== undefined && !(Number.isInteger(body.maxTimeMs) && body.maxTimeMs > 0)) {
    return badRequest(res, 'maxTimeMs must be a positive integer');
  }
  const cwd = ctx.workspaces.resolveCwd(body.cwd);
  if ('error' in cwd) return badRequest(res, cwd.error);
  const definition: LoopDefinition = {
    id: body.id ?? crypto.randomUUID(),
    name: body.name ?? 'Untitled loop',
    description: body.description,
    prompt: body.prompt,
    transition: {
      kind,
      skillName: rawSkillName,
      // Persist args ONLY as string|undefined; an empty string carries the
      // same meaning as absent (static skill prompt) — normalise it away.
      args: rawArgs === '' ? undefined : rawArgs,
    },
    // Already validated above: undefined stays undefined (no cap), a present
    // value is guaranteed a positive integer — what the store guard demands.
    maxRounds: body.maxRounds,
    maxTimeMs: body.maxTimeMs,
    // Persist the VALIDATED path (undefined body.cwd resolves to the first
    // workspace root). Falling back to process.cwd() here would store the
    // backend's own directory (/app in Docker) instead of a real workspace.
    cwd: cwd.path,
    model: body.model,
  };
  let saved: LoopDefinition;
  try {
    saved = ctx.loops.save(definition);
  } catch (err) {
    if (err instanceof LoopLimitError) {
      // 409: LoopManager threw BEFORE insert/persist — store untouched.
      return jsonResponse(res, 409, { error: err.message });
    }
    throw err; // genuine faults → the server's logged fixed-500 policy
  }
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
    handleLoopError(res, err);
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
    handleLoopError(res, err);
  }
}

export async function advanceLoop(
  req: IncomingMessage,
  res: ServerResponse,
  params: RouteParams,
  ctx: EngineRouteContext,
): Promise<void> {
  const id = params.id as string;
  const body = await jsonBody<{ action?: unknown }>(req, res, 'action');
  if (!body) return;
  // The gate is the human decision point — every other enum in this file is
  // 400-validated, and the old coercion made ANY garbage ('delet-everything',
  // 'Continue', null) mean CONTINUE, the costly direction. Strict set check:
  // only the two actions the runner actually implements.
  if (body.action !== 'continue' && body.action !== 'stop') {
    return badRequest(res, 'unknown action');
  }
  const progress = ctx.loops.advance(id, body.action);
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
