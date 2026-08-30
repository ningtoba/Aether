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
 * the browser — Bun's node:http layer cannot host WebSockets itself. The hub
 * enforces the SAME credential + Origin policy as the REST API (D2).
 */
import { AetherServer, secretsEqual, validateRealtimeTicket } from './server.js';
import {
  EngineService,
  LoopManager,
  OmpFacade,
  SkillsService,
  WorkspacesService,
} from './engine/index.js';
import {
  BunRealtimeHub,
  extractRealtimeKey,
  type HubRequestLike,
} from './realtime/bun-realtime.js';
import { isUpgradeOriginAllowed } from './websocket.js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

// Deliberate split (C4): a rejected background promise (e.g. a fire-and-forget
// prompt() that fails after its route already answered) must NEVER take the
// server down — log and survive. An exception with no handler means invariants
// are already broken: log it and exit(1) so the supervisor restarts a clean
// process instead of limping on in an unknown state.
process.on('unhandledRejection', (err) => console.error('[Aether] unhandledRejection:', err));
process.on('uncaughtException', (err) => {
  console.error('[Aether] uncaughtException:', err);
  process.exit(1);
});

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
// Externally-reachable realtime port. Under Docker the host remaps the
// container's REALTIME_PORT (e.g. 3082->3002), so the browser can't connect
// to the raw container port — compose sets this to the host-side port and
// /health advertises it. Local dev (no remap) leaves it == REALTIME_PORT.
const REALTIME_PUBLIC_PORT = parseIntEnv('REALTIME_PUBLIC_PORT', REALTIME_PORT);

const API_KEY = process.env.AETHER_API_KEY;

// Comma-separated CORS allow-list: exact origins like
// "https://gui.example,http://localhost:5173" (or the literal "*" to allow
// any browser). Empty/unset = same-origin only: the server then NEVER emits
// Access-Control-Allow-Origin, so no web page can call this API
// cross-origin. Requests without an Origin header (curl, server-to-server)
// are unaffected. This list also restricts WebSocket upgrade Origins.
const CORS_ORIGINS = (process.env.AETHER_CORS_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter((o) => o.length > 0);

/**
 * Backend manifest version for /health (C5: never trust a stale literal).
 * Read relative to this module so it resolves identically from src (tsx),
 * dist (`node dist/main.js` → `../package.json` = the backend manifest) and
 * the Docker image. Falls back softly rather than crash-looping a container
 * over a version string.
 */
function resolveVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const raw = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf-8')) as {
      version?: unknown;
    };
    return typeof raw.version === 'string' && raw.version.length > 0 ? raw.version : '0.0.0-dev';
  } catch {
    return '0.0.0-dev';
  }
}
const VERSION = resolveVersion();

// ── Engine wiring (Bun runtime only) ────────────────────────────────────
const engine = new EngineService();
const skills = new SkillsService({ projectRoot: process.cwd() });
// Single source of truth for workspace roots (AETHER_WORKSPACES, default
// home). Shared by the browse/validate routes and the loop start fallback.
const workspaces = new WorkspacesService(process.env.AETHER_WORKSPACES);
// Loop definitions persist across restarts. Prefer the omp agent data dir
// (~/.omp/agent/aether), which persists in Docker via the ~/.omp mount and
// locally without creating stray root dirs. LOOP_STORE_DIR overrides it.
const DEFAULT_LOOP_STORE = join(homedir(), '.omp', 'agent', 'aether', 'loops');
const LOOP_STORE_DIR = process.env.LOOP_STORE_DIR ?? DEFAULT_LOOP_STORE;
const loops = new LoopManager(engine, skills, { storeDir: LOOP_STORE_DIR });
const facade = new OmpFacade();

// Realtime hub auth wiring (D2/X3). When an API key is configured, the hub
// demands the SAME credential surface as the REST API (Bearer / X-API-Key /
// ?apikey=, constant-time compared) or a single-use ?ticket= minted by
// POST /api/realtime-ticket — the browser never puts the key in a URL. When
// unset, the hub stays open (local dev), but the Origin gate below is ALWAYS
// installed: browser traffic from a foreign host is rejected either way (D5).
const hubAuth = API_KEY
  ? {
      authenticate: (req: HubRequestLike): boolean => {
        const key = extractRealtimeKey(req);
        return key !== null && secretsEqual(key, API_KEY);
      },
      // Same module-level store the /api/realtime-ticket route mints into;
      // delete-on-use (single-use) with a 30s TTL.
      validateTicket: validateRealtimeTicket,
    }
  : {};
// WebSocket upgrade origins: pass the FULL CORS_ORIGINS list so browsers
// see the same precedence as REST CORS — literal '*' opts upgrades into
// allow-any (remote/Docker GUI), an explicit list is exact-match, and an
// empty list falls back to same-HOST (port-insensitive), so a page on
// evil.example can no longer stream live engine frames off an open hub.
const hubIsOriginAllowed = (req: HubRequestLike): boolean => {
  let hostHeader = req.headers.get('host');
  if (!hostHeader) {
    try {
      hostHeader = new URL(req.url).host;
    } catch {
      /* malformed URL → header absence decides */
    }
  }
  return isUpgradeOriginAllowed(
    req.headers.get('origin') ?? undefined,
    hostHeader ?? undefined,
    CORS_ORIGINS,
  );
};

let realtime: BunRealtimeHub | null = null;
if (engine.isAvailable) {
  console.log('[AetherServer] Engine available; wiring agent sessions/loops/skills');
  // Only the Bun runtime can host the realtime hub.
  if (typeof Bun !== 'undefined') {
    realtime = new BunRealtimeHub({
      port: REALTIME_PORT,
      // D3: bind exactly HOST and log the actual address (no more false
      // loopback line on a 0.0.0.0 bind).
      host: HOST,
      ...hubAuth,
      isOriginAllowed: hubIsOriginAllowed,
    });
  }
} else {
  console.warn('[AetherServer] Agent engine unavailable; sessions/loops/skills disabled');
}
// Preload the omp facade (defers the SDK import to the Bun path only).
if (engine.isAvailable) {
  void facade.ensure().then((ok) => {
    console.log(
      `[AetherServer] Omp facade ${ok ? 'ready' : 'unavailable'} (${facade.statusOf().version ?? 'no version'})`,
    );
    // Reflect the resolved omp version in /health (healthExtras is captured at
    // startup while ensure() is still running).
    if (ok && server.healthExtras && typeof server.healthExtras === 'object') {
      server.healthExtras.omp = { version: facade.statusOf().version ?? null };
    }
  });
}

const server = new AetherServer({
  port: PORT,
  host: HOST,
  maxBodySize: MAX_BODY_SIZE,
  // Empty list (default) = same-origin only; also populates the WebSocket
  // upgrade origin allow-list via the server's setCorsOrigins wiring.
  corsOrigins: CORS_ORIGINS,
  // When AETHER_API_KEY is set, the API requires it (Bearer or X-API-Key)
  // and authorizes via RBAC (admin role). Leave unset for open local dev.
  ...(API_KEY ? { auth: { apiKey: API_KEY } } : {}),
  engine: { engine, loops, skills, facade },
  workspaces,
});

if (realtime) {
  server.broadcastRealtime = (type, payload) => realtime.broadcast(type, payload);
  server.healthExtras = {
    realtime: { port: REALTIME_PUBLIC_PORT, internalPort: REALTIME_PORT },
    engine: {
      available: engine.isAvailable,
      error: engine.availabilityError,
    },
    omp: { version: facade.statusOf().version ?? null },
  };
}
// C5: /health reports the backend manifest version, not a stale literal
// (healthExtras spread wins over getHealthStatus()'s placeholder).
server.healthExtras.version = VERSION;

async function shutdown(signal: string): Promise<void> {
  console.log(`[AetherServer] ${signal} received, shutting down...`);
  try {
    // Dispose live engine sessions BEFORE closing the transport so no omp
    // session state outlives the server. A dispose failure must never block
    // the transport stop — log and continue.
    try {
      await engine.disposeAll();
    } catch (err) {
      console.error('[AetherServer] engine disposeAll error:', err);
    }
    if (realtime) await realtime.stop();
    await server.stop();
  } catch (err) {
    console.error('[AetherServer] shutdown error:', err);
    process.exit(1);
  }
  process.exit(0);
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
  // Loud (non-fatal) warning when the open API is reachable beyond loopback:
  // any host that can reach the port could otherwise create sessions and run
  // agent tools (bash/edit) as this user — browser CORS is NOT a defense.
  if (!API_KEY && !['127.0.0.1', 'localhost', '::1'].includes(HOST)) {
    console.warn(
      [
        '***********************************************************************',
        `* WARNING: Aether API is UNAUTHENTICATED and bound to ${HOST}:${PORT},`,
        '* i.e. reachable from every network interface of this machine.',
        '* Anyone who can reach the port can create sessions and run agent',
        '* tools (bash/edit) on this machine as this user.',
        '* Fix: set AETHER_API_KEY (require an API key) and/or',
        '* AETHER_CORS_ORIGINS (restrict browser origins), or bind locally',
        '* with HOST=127.0.0.1. Docker users: keep the 127.0.0.1 port prefix.',
        '***********************************************************************',
      ].join('\n'),
    );
  }
} catch (err) {
  console.error('[AetherServer] failed to start:', err);
  process.exit(1);
}
