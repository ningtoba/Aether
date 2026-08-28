/**
 * Agent management routes
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RouteParams } from '../router.js';
import * as store from '../store.js';
import { jsonResponse, parseBody, notFound, badRequest, payloadTooLarge } from '../utils.js';

export async function listAgents(req: IncomingMessage, res: ServerResponse): Promise<void> {
  jsonResponse(res, 200, { agents: store.listAgents() });
}

export async function createAgent(
  req: IncomingMessage,
  res: ServerResponse,
  _params: RouteParams,
): Promise<void> {
  const parsed = await parseBody<{ name?: string; config?: Record<string, unknown> }>(req);
  if (!parsed.ok) {
    if (parsed.reason === 'too_large') return payloadTooLarge(res);
    return badRequest(res, 'Agent name is required');
  }
  const body = parsed.value;
  if (!body.name) {
    return badRequest(res, 'Agent name is required');
  }
  const config =
    body.config && typeof body.config === 'object' && !Array.isArray(body.config)
      ? (body.config as Record<string, unknown>)
      : undefined;
  const agent = store.createAgent({
    name: body.name,
    config,
  });
  jsonResponse(res, 201, { agent });
}

export async function getAgent(
  req: IncomingMessage,
  res: ServerResponse,
  params: RouteParams,
): Promise<void> {
  const agent = store.getAgent(params.id as any);
  if (!agent) return notFound(res, 'Agent not found');
  jsonResponse(res, 200, { agent });
}

export async function updateAgent(
  req: IncomingMessage,
  res: ServerResponse,
  params: RouteParams,
): Promise<void> {
  const parsed = await parseBody<Record<string, unknown>>(req);
  if (!parsed.ok) {
    if (parsed.reason === 'too_large') return payloadTooLarge(res);
    return badRequest(res, 'Invalid request body');
  }
  // Only whitelisted, type-checked fields may be updated by a client; status
  // and record metadata stay server-managed so a forged body cannot corrupt
  // the record.
  const body = parsed.value;
  const patch: Partial<{ name: string; config: Record<string, unknown> }> = {};
  if (body.name !== undefined) {
    if (typeof body.name !== 'string') return badRequest(res, 'Invalid request body');
    patch.name = body.name;
  }
  if (body.config !== undefined) {
    if (typeof body.config !== 'object' || body.config === null || Array.isArray(body.config)) {
      return badRequest(res, 'Invalid request body');
    }
    patch.config = body.config as Record<string, unknown>;
  }
  const agent = store.updateAgent(params.id as any, patch as any);
  if (!agent) return notFound(res, 'Agent not found');
  jsonResponse(res, 200, { agent });
}

export async function deleteAgent(
  req: IncomingMessage,
  res: ServerResponse,
  params: RouteParams,
): Promise<void> {
  const deleted = store.deleteAgent(params.id as any);
  if (!deleted) return notFound(res, 'Agent not found');
  jsonResponse(res, 200, { success: true });
}
