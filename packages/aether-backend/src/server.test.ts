import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AetherServer } from './server.js';

describe('AetherServer', () => {
  let server: AetherServer;

  beforeEach(() => {
    server = new AetherServer({ port: 0, host: '127.0.0.1' });
  });

  afterEach(async () => {
    await server.stop();
  });

  describe('initialization', () => {
    it('should be created with default options', () => {
      const s = new AetherServer();
      expect(s).toBeDefined();
    });

    it('should not be running initially', () => {
      expect(server.isRunning()).toBe(false);
    });

    it('should expose WebSocket manager', () => {
      expect(server.ws).toBeDefined();
    });
  });

  describe('start/stop', () => {
    it('should start and listen on the assigned port', async () => {
      await server.start();
      expect(server.isRunning()).toBe(true);
      const port = server.getPort();
      expect(port).toBeGreaterThan(0);
    });

    it('should stop and mark as not running', async () => {
      await server.start();
      expect(server.isRunning()).toBe(true);
      await server.stop();
      expect(server.isRunning()).toBe(false);
    });

    it('should be idempotent on double start', async () => {
      await server.start();
      await server.start(); // second start should resolve immediately
      expect(server.isRunning()).toBe(true);
    });

    it('should be idempotent on double stop', async () => {
      await server.start();
      await server.stop();
      await server.stop(); // should not throw
    });
  });

  describe('CORS', () => {
    it('should default to allow all origins', () => {
      // The default is ['*'] which produces '*' in responses
      // Access the private corsOrigins via casting
      const origins = (server as any).corsOrigins;
      expect(origins).toEqual(['*']);
    });

    it('should allow setting custom origins', () => {
      server.setCorsOrigins(['http://localhost:3000']);
      const origins = (server as any).corsOrigins;
      expect(origins).toEqual(['http://localhost:3000']);
    });
  });

  describe('health endpoint', () => {
    it('should have health route registered', () => {
      // Access the router to check routes
      const router = (server as any).router;
      // Try matching the health route
      const match = router.match('GET', '/health');
      expect(match).not.toBeNull();
    });
  });

  describe('API routes', () => {
    it('should register all agent routes', () => {
      const router = (server as any).router;
      expect(router.match('GET', '/api/agents')).not.toBeNull();
      expect(router.match('POST', '/api/agents')).not.toBeNull();
      expect(router.match('GET', '/api/agents/test-id')).not.toBeNull();
      expect(router.match('PUT', '/api/agents/test-id')).not.toBeNull();
      expect(router.match('DELETE', '/api/agents/test-id')).not.toBeNull();
    });

    it('should register all provider routes', () => {
      const router = (server as any).router;
      expect(router.match('GET', '/api/providers')).not.toBeNull();
      expect(router.match('POST', '/api/providers')).not.toBeNull();
      expect(router.match('GET', '/api/providers/test/health')).not.toBeNull();
      expect(router.match('DELETE', '/api/providers/test')).not.toBeNull();
    });

    it('should register all execution routes', () => {
      const router = (server as any).router;
      expect(router.match('GET', '/api/executions')).not.toBeNull();
      expect(router.match('POST', '/api/executions')).not.toBeNull();
      expect(router.match('GET', '/api/executions/test-id')).not.toBeNull();
      expect(router.match('POST', '/api/executions/test-id/cancel')).not.toBeNull();
    });

    it('should return 404 for unknown routes', async () => {
      const router = (server as any).router;
      expect(router.match('GET', '/api/nonexistent')).toBeNull();
    });
  });
});
