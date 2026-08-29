/**
 * @aether/backend — production entrypoint
 *
 * Reads PORT/HOST from the environment, starts the HTTP/WebSocket server, and
 * shuts it down gracefully on SIGINT/SIGTERM. Used by the Docker image and the
 * `start`/`dev` npm scripts.
 *
 * When running under the Bun runtime (with the @oh-my-pi omp SDK resolvable),
 * the embedded agent engine is wired in automatically so sessions, loops,
 * skills, and the model catalog are served to the web GUI. A Bun-native
 * WebSocket hub (`REALTIME_PORT`, default 3002) streams live engine events to
 * the browser — Bun's node:http layer cannot host WebSockets itself.
 */
import { AetherServer } from './server.js';
import { EngineService, LoopManager, SkillsService } from './engine/index.js';
import { BunRealtimeHub } from './realtime/bun-realtime.js';

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const PORT = parseIntEnv('PORT', 3001);
const HOST = process.env.HOST ?? '0.0.0.0';
const MAX_BODY_SIZE = parseIntEnv('MAX_BODY_SIZE', 1_000_000);
const REALTIME_PORT = parseIntEnv('REALTIME_PORT', 3002);

const API_KEY = process.env.AETHER_API_KEY;

// ── Engine wiring (Bun runtime only) ────────────────────────────────────
const engine = new EngineService();
const skills = new SkillsService({ projectRoot: process.cwd() });
const loops = new LoopManager(engine, skills);

let realtime: BunRealtimeHub | null = null;
if (engine.isAvailable) {
  console.log('[AetherServer] Engine available; wiring agent sessions/loops/skills');
  // Only the Bun runtime can host the realtime hub.
  if (typeof Bun !== 'undefined') {
    realtime = new BunRealtimeHub(REALTIME_PORT);
  }
} else {
  console.warn('[AetherServer] Agent engine unavailable; sessions/loops/skills disabled');
}

const server = new AetherServer({
  port: PORT,
  host: HOST,
  maxBodySize: MAX_BODY_SIZE,
  // When AETHER_API_KEY is set, the API requires it (Bearer or X-API-Key)
  // and authorizes via RBAC (admin role). Leave unset for open local dev.
  ...(API_KEY ? { auth: { apiKey: API_KEY } } : {}),
  engine: { engine, loops, skills },
});

// Wire the Bun WebSocket hub as the realtime engine-event target.
if (realtime) {
  server.broadcastRealtime = (type, payload) => realtime.broadcast(type, payload);
  server.healthExtras = {
    realtime: { port: REALTIME_PORT },
    engine: {
      available: engine.isAvailable,
      error: engine.availabilityError,
    },
  };
}

async function shutdown(signal: string): Promise<void> {
  console.log(`[AetherServer] ${signal} received, shutting down...`);
  try {
    if (realtime) await realtime.stop();
    await server.stop();
  } finally {
    process.exit(0);
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  if (engine.isAvailable) {
    await engine.start();
  }
  if (realtime) {
    await realtime.start();
  }
  await server.start();
  console.log(`[AetherServer] ready at http://${HOST}:${PORT} (health: /health)`);
} catch (err) {
  console.error('[AetherServer] failed to start:', err);
  process.exit(1);
}
