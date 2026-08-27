/**
 * Provider configuration routes
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RouteParams } from '../router.js';
import { jsonResponse, parseBody, notFound, badRequest, payloadTooLarge } from '../utils.js';

interface ProviderRecord {
  id: string;
  name: string;
  type: string;
  endpoint?: string;
  apiKeyConfigured: boolean;
  createdAt: string;
}

const providers = new Map<string, ProviderRecord>();

export async function listProviders(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  jsonResponse(res, 200, { providers: Array.from(providers.values()) });
}

export async function addProvider(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const parsed = await parseBody<{
    id?: string;
    name?: string;
    type?: string;
    endpoint?: string;
    apiKey?: string;
  }>(req);

  if (!parsed.ok) {
    if (parsed.reason === 'too_large') return payloadTooLarge(res);
    return badRequest(res, 'Provider name and type are required');
  }
  const body = parsed.value;

  if (!body.name || !body.type) {
    return badRequest(res, 'Provider name and type are required');
  }

  const id = body.id ?? crypto.randomUUID();
  const record: ProviderRecord = {
    id,
    name: body.name,
    type: body.type,
    endpoint: body.endpoint,
    apiKeyConfigured: !!body.apiKey,
    createdAt: new Date().toISOString(),
  };
  providers.set(id, record);
  jsonResponse(res, 201, { provider: record });
}

export async function checkProviderHealth(
  _req: IncomingMessage,
  res: ServerResponse,
  params: RouteParams,
): Promise<void> {
  const provider = providers.get(params.id);
  if (!provider) return notFound(res, 'Provider not found');

  // Simulated health check — real implementation would ping the LLM endpoint
  const health = {
    id: provider.id,
    name: provider.name,
    status: 'reachable' as const,
    latency: Math.floor(Math.random() * 500) + 50,
    checkedAt: new Date().toISOString(),
  };
  jsonResponse(res, 200, { health });
}

export async function removeProvider(
  _req: IncomingMessage,
  res: ServerResponse,
  params: RouteParams,
): Promise<void> {
  const deleted = providers.delete(params.id);
  if (!deleted) return notFound(res, 'Provider not found');
  jsonResponse(res, 200, { success: true });
}
