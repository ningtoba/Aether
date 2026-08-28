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

  // parseBody accepts any JSON value (null, arrays, scalars); dereferencing a
  // non-object body would throw and surface as a 500 instead of a 400.
  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    return badRequest(res, 'Provider name and type are required');
  }
  if (!body.name || !body.type) {
    return badRequest(res, 'Provider name and type are required');
  }

  // Client-supplied ids are a silent-overwrite/orphan hazard on an
  // unauthenticated API: reject duplicates and non-string ids so records stay
  // reachable via the (string-typed) router params.
  if (body.id !== undefined) {
    if (typeof body.id !== 'string' || body.id.length === 0) {
      return badRequest(res, 'Provider id must be a non-empty string');
    }
    if (providers.has(body.id)) {
      jsonResponse(res, 409, { error: 'Provider already exists' });
      return;
    }
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

/** Aggregate provider counts for the /health endpoint. */
export function providerStats(): { configured: number; healthy: number } {
  return { configured: providers.size, healthy: providers.size };
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
