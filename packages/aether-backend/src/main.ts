/**
 * @aether/backend — production entrypoint
 *
 * Reads PORT/HOST from the environment, starts the HTTP/WebSocket server,
 * and shuts it down gracefully on SIGINT/SIGTERM. Used by the Docker image
 * and the `start`/`dev` npm scripts.
 */
import { AetherServer } from './server.js';

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const PORT = parseIntEnv('PORT', 3001);
const HOST = process.env.HOST ?? '0.0.0.0';
const MAX_BODY_SIZE = parseIntEnv('MAX_BODY_SIZE', 1_000_000);

const API_KEY = process.env.AETHER_API_KEY;

const server = new AetherServer({
  port: PORT,
  host: HOST,
  maxBodySize: MAX_BODY_SIZE,
  // When AETHER_API_KEY is set, the API requires it (Bearer or X-API-Key)
  // and authorizes via RBAC (admin role). Leave unset for open local dev.
  ...(API_KEY ? { auth: { apiKey: API_KEY } } : {}),
});

async function shutdown(signal: string): Promise<void> {
  console.log(`[AetherServer] ${signal} received, shutting down...`);
  try {
    await server.stop();
  } finally {
    process.exit(0);
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await server.start();
  console.log(`[AetherServer] ready at http://${HOST}:${PORT} (health: /health)`);
} catch (err) {
  console.error('[AetherServer] failed to start:', err);
  process.exit(1);
}
