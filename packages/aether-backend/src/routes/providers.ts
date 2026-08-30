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
/** Cap on the in-memory provider registry (there is no eviction): POSTs
 * past the cap answer 503 and never mutate the map. */
const MAX_PROVIDERS = 500;

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
  // apiKey used to be accepted and silently dropped — the key is NEVER wired
  // to the engine from this route, so keeping it would lie about the secret
  // being stored. Fail loudly instead; empty/absent apiKey stays acceptable.
  // Real provider keys live in omp settings (PUT /api/omp/settings, the
  // credential-flagged paths).
  if (body.apiKey !== undefined && body.apiKey !== '') {
    return badRequest(
      res,
      'apiKey is not supported here; provider keys are managed via omp settings (PUT /api/omp/settings)',
    );
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
  // Bounded growth: nothing above this line mutates the map, so a rejected
  // over-cap POST leaves the registry untouched.
  if (providers.size >= MAX_PROVIDERS) {
    jsonResponse(res, 503, { error: `provider registry full (${MAX_PROVIDERS})` });
    return;
  }
  const id = body.id ?? crypto.randomUUID();
  const record: ProviderRecord = {
    id,
    name: body.name,
    type: body.type,
    endpoint: body.endpoint,
    // This route never receives a key (non-empty apiKey is rejected above),
    // so the flag is honestly always false — keys are an omp-settings concern.
    apiKeyConfigured: false,
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

  // Honest answer: nothing in this backend ever pings the provider's endpoint
  // (there is no engine wiring behind this legacy route), so the status is
  // unknown and the latency unmeasured. The previous handler fabricated
  // 'reachable' + a random latency; `simulated` lets clients tell this answer
  // carries no observation.
  const health = {
    id: provider.id,
    name: provider.name,
    status: 'unknown' as const,
    latency: null,
    simulated: true as const,
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
