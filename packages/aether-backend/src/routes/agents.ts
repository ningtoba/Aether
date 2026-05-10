/**
 * Agent management routes
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RouteParams } from '../router.js';
import * as store from '../store.js';
import { jsonResponse, parseBody, notFound, badRequest } from '../utils.js';

export async function listAgents(req: IncomingMessage, res: ServerResponse): Promise<void> {
  jsonResponse(res, 200, { agents: store.listAgents() });
}

export async function createAgent(req: IncomingMessage, res: ServerResponse, _params: RouteParams): Promise<void> {
  const body = await parseBody<{ name?: string; config?: Record<string, unknown> }>(req);
  if (!body || !body.name) {
    return badRequest(res, 'Agent name is required');
  }
  const agent = store.createAgent({ name: body.name, config: body.config as any });
  jsonResponse(res, 201, { agent });
}

export async function getAgent(req: IncomingMessage, res: ServerResponse, params: RouteParams): Promise<void> {
  const agent = store.getAgent(params.id as any);
  if (!agent) return notFound(res, 'Agent not found');
  jsonResponse(res, 200, { agent });
}

export async function updateAgent(req: IncomingMessage, res: ServerResponse, params: RouteParams): Promise<void> {
  const body = await parseBody<Record<string, unknown>>(req);
  if (!body) return badRequest(res, 'Invalid request body');
  const agent = store.updateAgent(params.id as any, body as any);
  if (!agent) return notFound(res, 'Agent not found');
  jsonResponse(res, 200, { agent });
}

export async function deleteAgent(req: IncomingMessage, res: ServerResponse, params: RouteParams): Promise<void> {
  const deleted = store.deleteAgent(params.id as any);
  if (!deleted) return notFound(res, 'Agent not found');
  jsonResponse(res, 200, { success: true });
}
