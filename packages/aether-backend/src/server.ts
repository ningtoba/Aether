/**
 * AetherServer — HTTP/WebSocket server for the Aether backend API
 *
 * Uses Node.js built-in http module. No external dependencies required.
 * Structured for easy migration to Fastify/Express when needed.
 */
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import { Router, type RouteParams } from './router.js';
import { WebSocketManager } from './websocket.js';
import { badRequest, jsonResponse, serverError, DEFAULT_MAX_BODY_SIZE } from './utils.js';
import { getHealthStatus } from './routes/health.js';
import * as agentRoutes from './routes/agents.js';
import * as providerRoutes from './routes/providers.js';
import * as executionRoutes from './routes/executions.js';
import { RBACGuard, type RoleId } from '@aether/core';
import * as workspaceRoutes from './routes/workspaces.js';
import { WorkspacesService } from './engine/index.js';

import * as engineRoutes from './routes/engine.js';
import type { EngineService, LoopManager, SkillsService } from './engine/index.js';
import { OmpFacade } from './engine/index.js';
import * as facadeRoutes from './routes/facade.js';
import { StaticFileServer, resolveFrontendDist } from './static/static-server.js';

/** Optional engine/control-plane wiring supplied by main.ts when the engine is
 *  available (Bun runtime). When absent the server runs without sessions/loops/
 *  skills — the node-only test suite exercises that mode. */
export interface EngineWiring {
  engine: EngineService;
  loops: LoopManager;
  skills: SkillsService;
  /** Defensive omp capability/facade surface (settings, providers, agents,
   *  skills, persisted sessions). Constructed by main.ts when the engine runs. */
  facade: OmpFacade;
}

export interface AetherServerOptions {
  port?: number;
  host?: string;
  /** Maximum request body size in bytes (default: 1MB) */
  maxBodySize?: number;
  /** Optional API authentication + role-based authorization. */
  auth?: ServerAuthConfig;
  /** Static file root for the web GUI (defaults to the built frontend dist). */
  staticRoot?: string;
  /** Optional engine control-plane (sessions/loops/skills/models). */
  engine?: EngineWiring;
  /** Working-directory roots browser (defaults to the user's home). */
  workspaces?: WorkspacesService;
}

/** API auth for the HTTP/WebSocket server. */
export interface ServerAuthConfig {
  /**
   * Either a single API key (authenticates as `admin`) or a map of
   * key -> role. Requests must present the key via `Authorization: Bearer`
   * or `X-API-Key`. When unset, the API stays open (local development).
   */
  apiKey?: string | Record<string, RoleId>;
}

export class AetherServer {
  private server: Server | null = null;
  private router: Router;
  private wsManager: WebSocketManager;
  private port: number;
  private host: string;
  private running = false;
  private corsOrigins: string[];
  private maxBodySize: number;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private rbac: RBACGuard | null = null;
  private apiKeys = new Map<string, RoleId>();
  private engineWiring: EngineWiring | null = null;
  private staticServer: StaticFileServer | null = null;
  private workspaces: WorkspacesService;

  /** Extra fields merged into /health (realtime port, engine state, ...). */
  healthExtras: Record<string, unknown> = {};

  /** Extra realtime target injected by main.ts (the Bun-native hub). */
  broadcastRealtime: ((type: string, payload: unknown) => void) | null = null;

  constructor(options: AetherServerOptions = {}) {
    this.port = options.port ?? 3001;
    this.host = options.host ?? '0.0.0.0';
    this.router = new Router();
    this.wsManager = new WebSocketManager();
    this.corsOrigins = ['*'];
    this.maxBodySize = options.maxBodySize ?? DEFAULT_MAX_BODY_SIZE;
    this.engineWiring = options.engine ?? null;
    this.workspaces = options.workspaces ?? new WorkspacesService(process.env.AETHER_WORKSPACES);
    this.configureAuth(options.auth);
    this.initStatic(options.staticRoot);
    this.registerRoutes();
    this.wireEngineBroadcast();
  }

  /** Set up API keys and the RBAC guard from the auth config. */
  private configureAuth(auth?: ServerAuthConfig): void {
    if (!auth?.apiKey) return;
    if (typeof auth.apiKey === 'string') {
      this.apiKeys.set(auth.apiKey, 'admin' as RoleId);
    } else {
      for (const [key, role] of Object.entries(auth.apiKey)) {
        this.apiKeys.set(key, role);
      }
    }
    if (this.apiKeys.size > 0) {
      this.rbac = new RBACGuard();
    }
  }

  private initStatic(root?: string): void {
    const dir = root ?? resolveFrontendDist();
    if (dir) {
      this.staticServer = new StaticFileServer(dir);
    }
  }

  /** True when API authentication is enabled. */
  get authEnabled(): boolean {
    return this.apiKeys.size > 0;
  }

  /** True when the embedded agent engine is wired and available. */
  get hasEngine(): boolean {
    return this.engineWiring !== null && this.engineWiring.engine.isAvailable;
  }

  /** Extract the API key supplied via Authorization: Bearer or X-API-Key. */
  private extractApiKey(req: IncomingMessage): string | null {
    const auth = req.headers.authorization;
    // RFC 7235 auth-schemes are case-insensitive; accept lowercase `bearer`.
    if (auth && /^bearer[ \t]+/i.test(auth)) {
      const token = auth.replace(/^bearer[ \t]+/i, '').trim();
      if (token) return token;
    }
    const headerKey = req.headers['x-api-key'];
    if (typeof headerKey === 'string' && headerKey.length > 0) return headerKey;
    return null;
  }

  /** Constant-time key comparison (digest-compare). */
  private keysEqual(a: string, b: string): boolean {
    const ha = createHash('sha256').update(a).digest();
    const hb = createHash('sha256').update(b).digest();
    return ha.equals(hb);
  }

  /** Authenticate a request; returns the granted role or null. */
  private authenticate(req: IncomingMessage): RoleId | null {
    if (this.apiKeys.size === 0) return null;
    const provided = this.extractApiKey(req);
    if (!provided) return null;
    for (const [key, role] of this.apiKeys) {
      if (this.keysEqual(key, provided)) return role;
    }
    return null;
  }

  /** Authenticate a WebSocket upgrade request (header or ?apikey= query). */
  private authenticateWebSocket(req: IncomingMessage): boolean {
    if (this.apiKeys.size === 0) return true;
    if (this.authenticate(req)) return true;
    const query = req.url?.split('?')[1] ?? '';
    const match = /\bapikey=([^&]+)/.exec(query);
    let provided: string | null = null;
    if (match) {
      try {
        provided = decodeURIComponent(match[1]);
      } catch {
        // Malformed percent-encoding (e.g. `?apikey=%zz`): treat as no key,
        // never let a single request kill the process.
        return false;
      }
    }
    if (!provided) return false;
    for (const key of this.apiKeys.keys()) {
      if (this.keysEqual(key, provided)) return true;
    }
    return false;
  }

  /** Map an HTTP method + path to an RBAC (resource, action). */
  private routePermission(
    method: string,
    pathname: string,
  ): { resource: string; action: string } | null {
    if (pathname.startsWith('/api/agents')) {
      return { resource: 'agents:*', action: method === 'GET' ? 'read' : 'write' };
    }
    if (pathname.startsWith('/api/providers')) {
      return { resource: 'providers:config', action: method === 'GET' ? 'read' : 'write' };
    }
    if (pathname.startsWith('/api/executions')) {
      return { resource: 'agents:*', action: method === 'GET' ? 'read' : 'execute' };
    }
    if (pathname.startsWith('/api/sessions')) {
      return { resource: 'agents:*', action: method === 'GET' ? 'read' : 'execute' };
    }
    if (pathname.startsWith('/api/loops')) {
      return { resource: 'agents:*', action: method === 'GET' ? 'read' : 'execute' };
    }
    if (pathname.startsWith('/api/omp/settings')) {
      return { resource: 'settings:*', action: method === 'GET' ? 'read' : 'write' };
    }
    return null;
  }

  /** Bridge engine session/loop events to every realtime surface. */
  private wireEngineBroadcast(): void {
    if (!this.engineWiring) return;
    const { engine, loops } = this.engineWiring;
    engine.onBroadcast = (sessionId, ev) => {
      const frame = { namespace: 'session', sessionId, event: ev };
      this.wsManager.broadcast('engine', frame);
      this.broadcastRealtime?.('engine', frame);
    };
    loops.onBroadcast = (ev) => {
      const frame = { namespace: 'loop', event: ev };
      this.wsManager.broadcast('engine', frame);
      this.broadcastRealtime?.('engine', frame);
    };
  }

  /** Register all API routes */
  private registerRoutes(): void {
    // Health
    this.router.get('/health', (_req, res) => {
      jsonResponse(res, 200, { ...getHealthStatus(), ...this.healthExtras });
    });

    // Agents
    this.router.get('/api/agents', agentRoutes.listAgents);
    this.router.post('/api/agents', agentRoutes.createAgent);
    this.router.get('/api/agents/:id', agentRoutes.getAgent);
    this.router.put('/api/agents/:id', agentRoutes.updateAgent);
    this.router.delete('/api/agents/:id', agentRoutes.deleteAgent);

    // Providers
    this.router.get('/api/providers', providerRoutes.listProviders);
    this.router.post('/api/providers', providerRoutes.addProvider);
    this.router.get('/api/providers/:id/health', providerRoutes.checkProviderHealth);
    this.router.delete('/api/providers/:id', providerRoutes.removeProvider);

    // Executions
    this.router.get('/api/executions', executionRoutes.listExecutions);
    this.router.post('/api/executions', executionRoutes.startExecution);
    this.router.get('/api/executions/:id', executionRoutes.getExecution);
    this.router.post('/api/executions/:id/cancel', executionRoutes.cancelExecution);
    // Workspaces (working-directory browser; engine-independent)
    const wsp = this.workspaces;
    this.router.get('/api/workspaces', (_req, res) =>
      workspaceRoutes.listWorkspaces(_req, res, {} as RouteParams, { workspaces: wsp }),
    );
    this.router.get('/api/workspaces/browse', (req, res) =>
      workspaceRoutes.browseWorkspace(req, res, {} as RouteParams, { workspaces: wsp }),
    );

    // Engine control-plane (bound to the wiring when present, else 501)
    const ctx = this.engineWiring;
    const engCtx = ctx ? { ...ctx, workspaces: this.workspaces } : null;
    const engineUnavailable = (_req: IncomingMessage, res: ServerResponse): void => {
      jsonResponse(res, 501, { error: 'Agent engine not configured (requires Bun runtime)' });
    };
    // (req, res, params) → fn with its `ctx` argument bound
    const bind =
      <P extends RouteParams>(
        fn: (
          req: IncomingMessage,
          res: ServerResponse,
          params: P,
          c: NonNullable<typeof engCtx>,
        ) => Promise<void>,
      ) =>
      (req: IncomingMessage, res: ServerResponse, params: P): Promise<void> =>
        engCtx ? fn(req, res, params, engCtx) : Promise.resolve(engineUnavailable(req, res));

    this.router.get('/api/models', bind(engineRoutes.listModels));
    this.router.get('/api/sessions', bind(engineRoutes.listSessions));
    this.router.post('/api/sessions', bind(engineRoutes.createSession));
    this.router.get('/api/sessions/:id', bind(engineRoutes.getSessionInfo));
    this.router.get('/api/sessions/:id/transcript', bind(engineRoutes.getSessionTranscript));
    this.router.post('/api/sessions/:id/prompt', bind(engineRoutes.promptSession));
    this.router.post('/api/sessions/:id/compact', bind(engineRoutes.compactSession));
    this.router.post('/api/sessions/:id/dispose', bind(engineRoutes.disposeSession));
    this.router.get('/api/loops', bind(engineRoutes.listLoops));
    this.router.post('/api/loops', bind(engineRoutes.saveLoop));
    this.router.get('/api/loops/:id', bind(engineRoutes.getLoop));
    this.router.delete('/api/loops/:id', bind(engineRoutes.deleteLoop));
    this.router.post('/api/loops/:id/start', bind(engineRoutes.startLoop));
    this.router.post('/api/loops/:id/stop', bind(engineRoutes.stopLoop));
    this.router.post('/api/loops/:id/advance', bind(engineRoutes.advanceLoop));
    this.router.get('/api/skills', bind(engineRoutes.listSkills));

    // Omp facade control-plane (engine-wired: status, settings, providers,
    // agents, skills, persisted sessions — else 501 like the rest).
    const fakerCtx = ctx ? { facade: ctx.facade } : null;
    const bindF =
      <P extends RouteParams>(
        fn: (
          req: IncomingMessage,
          res: ServerResponse,
          params: P,
          c: NonNullable<typeof fakerCtx>,
        ) => Promise<void>,
      ) =>
      (req: IncomingMessage, res: ServerResponse, params: P): Promise<void> =>
        fakerCtx ? fn(req, res, params, fakerCtx) : Promise.resolve(engineUnavailable(req, res));

    this.router.get('/api/omp/status', bindF(facadeRoutes.facadeStatus));
    this.router.get('/api/omp/settings', bindF(facadeRoutes.settingsSchema));
    this.router.get('/api/omp/settings/values', bindF(facadeRoutes.settingsGet));
    this.router.put('/api/omp/settings', bindF(facadeRoutes.settingsSet));
    this.router.get('/api/omp/providers', bindF(facadeRoutes.listFacadeProviders));
    this.router.get('/api/omp/agents', bindF(facadeRoutes.listFacadeAgents));
    this.router.get('/api/omp/skills', bindF(facadeRoutes.listFacadeSkills));
    this.router.get('/api/omp/sessions', bindF(facadeRoutes.listDiskSessions));
    this.router.get('/api/omp/sessions/read', bindF(facadeRoutes.readDiskSession));
  }

  /** Set CORS allowed origins */
  setCorsOrigins(origins: string[]): void {
    this.corsOrigins = origins;
    this.wsManager.setAllowedOrigins(origins.filter((o) => o !== '*'));
  }

  /** Handle CORS preflight and headers */
  private handleCors(req: IncomingMessage, res: ServerResponse): boolean {
    const origin = req.headers.origin ?? '*';
    const allowOrigin = this.corsOrigins.includes('*')
      ? '*'
      : this.corsOrigins.includes(origin)
        ? origin
        : 'null';

    res.setHeader('Access-Control-Allow-Origin', allowOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.setHeader('Access-Control-Max-Age', '86400');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return true; // request handled
    }
    return false;
  }

  /** Main request handler */
  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (this.handleCors(req, res)) return;

    const url = req.url ?? '/';
    const method = req.method ?? 'GET';

    // Carry the server's configured limit through to body parsing so no
    // Content-Length (e.g. chunked transfer-encoding) is bounded too.
    req.maxBodySize = this.maxBodySize;

    // Reject advertised oversized bodies up front, before any bytes are read.
    if (method === 'POST' || method === 'PUT') {
      const declared = Number(req.headers['content-length']);
      if (Number.isFinite(declared) && declared > this.maxBodySize) {
        return jsonResponse(res, 413, { error: 'Request body too large' });
      }
    }

    // Authenticate + authorize /api/* routes when auth is enabled.
    // /health stays open (container healthchecks/probes).
    if (this.authEnabled && url.startsWith('/api/')) {
      const role = this.authenticate(req);
      if (!role) {
        return jsonResponse(res, 401, { error: 'Unauthorized' });
      }
      const perm = this.routePermission(method, url.split('?')[0]);
      if (perm && this.rbac && !this.rbac.isAllowed([role], perm.resource, perm.action)) {
        return jsonResponse(res, 403, { error: 'Forbidden' });
      }
    }

    let route: ReturnType<typeof this.router.match>;
    try {
      route = this.router.match(method, url);
    } catch {
      // Malformed percent-encoding in a path param (e.g. '/api/agents/%zz')
      // makes decodeURIComponent throw; surface it as a 400, never a 500/hang.
      return badRequest(res, 'Malformed URL');
    }
    if (route) {
      try {
        await route.handler(req, res, route.params);
      } catch (err) {
        // Never echo exception internals (paths, store keys) to remote clients;
        // log them server-side and return a fixed message.
        console.error('Route handler error:', err);
        if (res.headersSent) {
          // The handler wrote a partial response before failing; do not try to
          // write a second response over already-sent headers.
          res.destroy();
          return;
        }
        serverError(res, 'Internal server error');
      }
    } else if (this.staticServer && !url.startsWith('/api/')) {
      // Non-API GET → serve the web GUI (SPA fallback handles client routes).
      this.staticServer.serve(req, res);
    } else {
      jsonResponse(res, 404, {
        error: 'Not found',
        path: url,
        method,
      });
    }
  }

  /** Start the HTTP server */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.running) {
        resolve();
        return;
      }
      if (this.stopTimer) {
        clearTimeout(this.stopTimer);
        this.stopTimer = null;
      }

      this.server = createServer((req, res) => {
        this.handleRequest(req, res).catch((err) => {
          console.error('Unhandled request error:', err);
          res.statusCode = 500;
          res.end('Internal Server Error');
        });
      });

      // Attach WebSocket upgrade handling (with API-key auth when enabled)
      this.wsManager.attach(this.server, (req) => this.authenticateWebSocket(req));

      this.server.on('error', (err) => {
        this.running = false;
        reject(err);
      });

      this.server.listen(this.port, this.host, () => {
        this.running = true;
        console.log(`[AetherServer] Listening on ${this.host}:${this.port}`);
        resolve();
      });
    });
  }

  /** Stop the HTTP server */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server || !this.running) {
        resolve();
        return;
      }

      this.wsManager.detach();

      const server = this.server;
      if (this.stopTimer) {
        clearTimeout(this.stopTimer);
        this.stopTimer = null;
      }

      server.close(() => {
        if (this.stopTimer) {
          clearTimeout(this.stopTimer);
          this.stopTimer = null;
        }
        this.running = false;
        this.server = null;
        console.log('[AetherServer] Stopped');
        resolve();
      });

      // Force close after timeout
      this.stopTimer = setTimeout(() => {
        this.running = false;
        this.server = null;
        resolve();
      }, 5000);

      // Drop idle keep-alive connections that would otherwise pin server.close().
      // (closeIdleConnections avoids aborting in-flight requests.)
      server.closeIdleConnections();
    });
  }

  /** Get the port the server is running on */
  getPort(): number | undefined {
    const addr = this.server?.address();
    if (addr && typeof addr !== 'string') {
      return addr.port;
    }
    return this.port;
  }

  /** Check if the server is running */
  isRunning(): boolean {
    return this.running && this.server !== null && this.server.listening;
  }

  /** Access the WebSocket manager for broadcasting events */
  get ws(): WebSocketManager {
    return this.wsManager;
  }
}
