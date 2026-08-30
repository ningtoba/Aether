/**
 * Health check endpoint
 */

export interface HealthStatus {
  status: 'ok' | 'degraded' | 'error';
  version: string;
  uptime: number;
  memory: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
  };
  providers: {
    configured: number;
    healthy: number;
  };
  timestamp: string;
}

const startTime = Date.now();

/**
 * Build the /health payload. `providers` is engine-derived truth passed in
 * by the server (EngineService.providerHealthStats() over the WARM registry
 * + AuthStorage, TTL-memoized): `configured` counts distinct catalog
 * providers and `healthy` counts those with authStorage.hasAuth — honest
 * zeros when no engine is wired, NEVER a copy of `configured`, never a
 * guess.
 */
export function getHealthStatus(
  providers: { configured: number; healthy: number } = { configured: 0, healthy: 0 },
): HealthStatus {
  const mem = process.memoryUsage();
  return {
    status: 'ok',
    version: '0.1.0',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    memory: {
      rss: mem.rss,
      heapTotal: mem.heapTotal,
      heapUsed: mem.heapUsed,
      external: mem.external,
    },
    providers: {
      configured: providers.configured,
      healthy: providers.healthy,
    },
    timestamp: new Date().toISOString(),
  };
}
