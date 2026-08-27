/**
 * AetherServer — HTTP/WebSocket server for the Aether backend API
 *
 * Uses Node.js built-in http module. No external dependencies required.
 * Structured for easy migration to Fastify/Express when needed.
 */
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import { Router } from './router.js';
import { WebSocketManager } from './websocket.js';
import { jsonResponse, parseBody, serverError, DEFAULT_MAX_BODY_SIZE } from './utils.js';
import { getHealthStatus } from './routes/health.js';
import * as agentRoutes from './routes/agents.js';
import * as providerRoutes from './routes/providers.js';
import * as executionRoutes from './routes/executions.js';
import { RBACGuard, type RoleId } from '@aether/security';

export interface AetherServerOptions {
  port?: number;
  host?: string;
  /** Maximum request body size in bytes (default: 1MB) */
  maxBodySize?: number;
  /** Optional API authentication + role-based authorization. */
  auth?: ServerAuthConfig;
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

  constructor(options: AetherServerOptions = {}) {
    this.port = options.port ?? 3001;
    this.host = options.host ?? '0.0.0.0';
    this.router = new Router();
    this.wsManager = new WebSocketManager();
    this.corsOrigins = ['*'];
    this.maxBodySize = options.maxBodySize ?? DEFAULT_MAX_BODY_SIZE;
    this.configureAuth(options.auth);
    this.registerRoutes();
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

  /** True when API authentication is enabled. */
  get authEnabled(): boolean {
    return this.apiKeys.size > 0;
  }

  /** Extract the API key supplied via Authorization: Bearer or X-API-Key. */
  private extractApiKey(req: IncomingMessage): string | null {
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) {
      const token = auth.slice('Bearer '.length).trim();
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
    return null;
  }

  /** Register all API routes */
  private registerRoutes(): void {
    // Health
    this.router.get('/health', (_req, res) => {
      jsonResponse(res, 200, getHealthStatus());
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

    const route = this.router.match(method, url);
    if (route) {
      try {
        await route.handler(req, res, route.params);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Internal server error';
        serverError(res, message);
      }
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
