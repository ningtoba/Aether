/**
 * Health check endpoint
 */
import { providerStats } from './providers.js';

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

export function getHealthStatus(): HealthStatus {
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
      configured: providerStats().configured,
      healthy: providerStats().healthy,
    },
    timestamp: new Date().toISOString(),
  };
}
