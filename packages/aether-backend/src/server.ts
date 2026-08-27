/**
 * AetherServer — HTTP/WebSocket server for the Aether backend API
 *
 * Uses Node.js built-in http module. No external dependencies required.
 * Structured for easy migration to Fastify/Express when needed.
 */
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { Router } from './router.js';
import { WebSocketManager } from './websocket.js';
import { jsonResponse, parseBody, serverError, DEFAULT_MAX_BODY_SIZE } from './utils.js';
import { getHealthStatus } from './routes/health.js';
import * as agentRoutes from './routes/agents.js';
import * as providerRoutes from './routes/providers.js';
import * as executionRoutes from './routes/executions.js';

export interface AetherServerOptions {
  port?: number;
  host?: string;
  /** Maximum request body size in bytes (default: 1MB) */
  maxBodySize?: number;
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

  constructor(options: AetherServerOptions = {}) {
    this.port = options.port ?? 3001;
    this.host = options.host ?? '0.0.0.0';
    this.router = new Router();
    this.wsManager = new WebSocketManager();
    this.corsOrigins = ['*'];
    this.maxBodySize = options.maxBodySize ?? DEFAULT_MAX_BODY_SIZE;
    this.registerRoutes();
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

      // Attach WebSocket upgrade handling
      this.wsManager.attach(this.server);

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
