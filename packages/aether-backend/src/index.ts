/**
 * @aether/backend — barrel export
 */
export { AetherServer } from './server.js';
export type { AetherServerOptions } from './server.js';
export { WebSocketManager } from './websocket.js';
export { Router } from './router.js';
export type { RouteParams, RequestHandler, RouteEntry } from './router.js';
export { getHealthStatus } from './routes/health.js';
export type { HealthStatus } from './routes/health.js';
