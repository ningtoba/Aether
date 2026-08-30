/**
 * Workspace routes — browse working-directory roots and validate a chosen cwd.
 *
 * These are plain filesystem operations (no engine required), so they work in
 * every mode. The GUI uses them to pick a real working directory for sessions
 * and loops.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RouteParams } from '../router.js';
import { jsonResponse, badRequest } from '../utils.js';
import { WorkspacesService } from '../engine/index.js';

export interface WorkspaceRouteContext {
  workspaces: WorkspacesService;
}

export async function listWorkspaces(
  _req: IncomingMessage,
  res: ServerResponse,
  _p: RouteParams,
  ctx: WorkspaceRouteContext,
): Promise<void> {
  jsonResponse(res, 200, { workspaces: ctx.workspaces.listRoots() });
}

export async function browseWorkspace(
  req: IncomingMessage,
  res: ServerResponse,
  _p: RouteParams,
  ctx: WorkspaceRouteContext,
): Promise<void> {
  const url = new URL(req.url ?? '', 'http://localhost');
  const path = url.searchParams.get('path') ?? undefined;
  const out = ctx.workspaces.browse(path);
  if (!out) return badRequest(res, 'Invalid or inaccessible working directory');
  jsonResponse(res, 200, out);
}
