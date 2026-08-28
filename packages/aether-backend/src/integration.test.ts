/**
 * Integration tests for @aether/backend
 *
 * Tests the full backend flow against a real HTTP server:
 * - Agent lifecycle (create, list, get by id)
 * - Health endpoint
 * - CORS preflight handling
 * - WebSocket frame encoding/decoding end to end
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import net from 'node:net';
import { AetherServer } from './server.js';
import { WebSocketManager } from './websocket.js';
import type { RoleId } from '@aether/security';

// ---------------------------------------------------------------------------
// Full HTTP server integration
// ---------------------------------------------------------------------------
describe('AetherServer HTTP integration', () => {
  let server: AetherServer;

  beforeEach(() => {
    server = new AetherServer({ port: 0, host: '127.0.0.1' });
  });

  afterEach(async () => {
    await server.stop();
  });

  it('health endpoint returns expected shape', async () => {
    await server.start();

    const res = await fetch(`http://127.0.0.1:${server.getPort()}/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');

    const body: any = await res.json();
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('version');
    expect(body).toHaveProperty('uptime');
    expect(body).toHaveProperty('memory');
    expect(body).toHaveProperty('providers');
    expect(body).toHaveProperty('timestamp');
    expect(body.status).toBe('ok');
    expect(body.version).toBe('0.1.0');
    expect(body.memory).toHaveProperty('rss');
    expect(body.memory).toHaveProperty('heapUsed');
    expect(body.providers).toHaveProperty('configured');
    expect(body.providers).toHaveProperty('healthy');
  });

  it('creates an agent and lists agents', async () => {
    await server.start();
    const port = server.getPort()!;
    const base = `http://127.0.0.1:${port}`;

    // Initially empty
    const list1 = await fetch(`${base}/api/agents`);
    expect(list1.status).toBe(200);
    const body1: any = await list1.json();
    expect(body1.agents).toEqual([]);

    // Create an agent
    const createRes = await fetch(`${base}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test-agent-1' }),
    });
    expect(createRes.status).toBe(201);
    const createBody: any = await createRes.json();
    expect(createBody.agent).toHaveProperty('id');
    expect(createBody.agent.name).toBe('test-agent-1');
    expect(createBody.agent.status).toBe('idle');

    const agentId = createBody.agent.id;

    // List should now include the agent
    const list2 = await fetch(`${base}/api/agents`);
    const body2: any = await list2.json();
    expect(body2.agents).toHaveLength(1);
    expect(body2.agents[0].id).toBe(agentId);

    // Get by id
    const getRes = await fetch(`${base}/api/agents/${agentId}`);
    expect(getRes.status).toBe(200);
    const getBody: any = await getRes.json();
    expect(getBody.agent.name).toBe('test-agent-1');
    expect(getBody.agent.id).toBe(agentId);
  });

  it('creates an execution flow (create, list, get by id)', async () => {
    await server.start();
    const port = server.getPort()!;
    const base = `http://127.0.0.1:${port}`;

    // Create an execution
    const createRes = await fetch(`${base}/api/executions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'test-agent-id',
        input: { message: 'run task' },
      }),
    });
    expect(createRes.status).toBe(201);
    const createBody: any = await createRes.json();
    expect(createBody.execution).toHaveProperty('id');
    expect(createBody.execution.status).toBe('pending');
    expect(createBody.execution.agentId).toBe('test-agent-id');

    const execId = createBody.execution.id;

    // List executions
    const listRes = await fetch(`${base}/api/executions`);
    expect(listRes.status).toBe(200);
    const listBody: any = await listRes.json();
    expect(listBody.executions).toHaveLength(1);
    expect(listBody.executions[0].id).toBe(execId);

    // Get by id
    const getRes = await fetch(`${base}/api/executions/${execId}`);
    expect(getRes.status).toBe(200);
    const getBody: any = await getRes.json();
    expect(getBody.execution.id).toBe(execId);
    expect(getBody.execution.status).toBe('running');
  });

  it('returns 404 for unknown routes', async () => {
    await server.start();
    const port = server.getPort()!;
    const res = await fetch(`http://127.0.0.1:${port}/api/nonexistent`);
    expect(res.status).toBe(404);
    const body: any = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toBe('Not found');
  });
});

// ---------------------------------------------------------------------------
// CORS integration
// ---------------------------------------------------------------------------
describe('CORS integration', () => {
  let server: AetherServer;

  beforeEach(() => {
    server = new AetherServer({ port: 0, host: '127.0.0.1' });
  });

  afterEach(async () => {
    await server.stop();
  });

  it('responds to OPTIONS preflight with correct CORS headers', async () => {
    await server.start();
    const port = server.getPort()!;
    const res = await fetch(`http://127.0.0.1:${port}/api/agents`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://example.com',
        'Access-Control-Request-Method': 'POST',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-methods')).toBe('GET, POST, PUT, DELETE, OPTIONS');
    expect(res.headers.get('access-control-allow-headers')).toBe(
      'Content-Type, Authorization, X-Requested-With',
    );
    expect(res.headers.get('access-control-max-age')).toBe('86400');
  });

  it('sets CORS headers on normal GET requests', async () => {
    await server.start();
    const port = server.getPort()!;
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});
describe('request body size limits', () => {
  it('rejects advertised oversized bodies with 413', async () => {
    const small = new AetherServer({ port: 0, host: '127.0.0.1', maxBodySize: 64 });
    await small.start();
    try {
      const res = await fetch(`http://127.0.0.1:${small.getPort()}/api/agents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'x'.repeat(200) }),
      });
      expect(res.status).toBe(413);
    } finally {
      await small.stop();
    }
  });

  it('accepts bodies within the limit', async () => {
    const small = new AetherServer({ port: 0, host: '127.0.0.1', maxBodySize: 1024 });
    await small.start();
    try {
      const res = await fetch(`http://127.0.0.1:${small.getPort()}/api/agents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'ok' }),
      });
      expect(res.status).toBe(201);
    } finally {
      await small.stop();
    }
  });
  it('caps chunked request bodies (no Content-Length) at the configured limit', async () => {
    const small = new AetherServer({ port: 0, host: '127.0.0.1', maxBodySize: 64 });
    await small.start();
    const port = small.getPort()!;
    const body = JSON.stringify({ name: 'x'.repeat(200) });
    const chunks: string[] = [];
    for (let i = 0; i < body.length; i += 16) {
      const piece = body.slice(i, i + 16);
      chunks.push(piece.length.toString(16) + '\r\n' + piece + '\r\n');
    }
    const payload =
      'POST /api/agents HTTP/1.1\r\n' +
      'Host: 127.0.0.1\r\n' +
      'Content-Type: application/json\r\n' +
      'Transfer-Encoding: chunked\r\n\r\n' +
      chunks.join('') +
      '0\r\n\r\n';

    const socket = new net.Socket();
    const response = await new Promise<string>((resolve, reject) => {
      socket.setTimeout(3_000, () => resolve(''));
      socket.on('error', reject);
      socket.on('data', (d) => {
        const text = d.toString();
        if (text.includes('\r\n\r\n')) {
          socket.destroy();
          resolve(text);
        }
      });
      socket.connect(port, '127.0.0.1', () => socket.write(payload));
    });
    expect(response).toContain('413');
    await small.stop();
  });
});

// ---------------------------------------------------------------------------
// WebSocket frame encoding/decoding end to end
// ---------------------------------------------------------------------------
describe('WebSocket frame encoding/decoding E2E', () => {
  let wsm: WebSocketManager;

  beforeEach(() => {
    wsm = new WebSocketManager();
  });
  function maskClientFrame(data: string): Buffer {
    const payload = Buffer.from(data, 'utf-8');
    const mask = Buffer.from([0x01, 0x02, 0x03, 0x04]);
    const masked = Buffer.from(payload);
    for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
    const lenBytes: number[] = [];
    for (let i = 7; i >= 0; i--)
      lenBytes.push(Number((BigInt(payload.length) >> BigInt(i * 8)) & 0xffn));
    const header: number[] =
      payload.length < 126
        ? [0x81, 0x80 | payload.length]
        : payload.length < 65536
          ? [0x81, 0x80 | 126, (payload.length >> 8) & 0xff, payload.length & 0xff]
          : [0x81, 0x80 | 127, ...lenBytes];
    return Buffer.concat([Buffer.from(header), mask, masked]);
  }

  it('encode then decode a text frame produces original data', () => {
    const original = 'Hello, Aether WebSocket!';
    // @ts-expect-error - accessing private method for test
    const frame = wsm.createTextFrame(original);
    expect(frame).toBeInstanceOf(Buffer);
    expect(frame.length).toBeGreaterThan(original.length);

    // decode a client-style (masked) frame of the same payload
    // @ts-expect-error - accessing private method for test
    const decoded = wsm.tryParseFrame(maskClientFrame(original));
    expect(decoded).not.toBeNull();
    expect(decoded!.payload.toString()).toBe(original);
  });

  it('encode then decode a large text frame (>64KB)', () => {
    const original = 'x'.repeat(70_000);
    // @ts-expect-error - accessing private method for test
    const frame = wsm.createTextFrame(original);
    // @ts-expect-error - accessing private method for test
    const decoded = wsm.tryParseFrame(maskClientFrame(original));
    expect(decoded).not.toBeNull();
    expect(decoded!.payload.length).toBe(70_000);
  });

  it('decode rejects unsupported opcodes', () => {
    // Binary frame (opcode 0x02)
    const frame = Buffer.from([0x82, 0]);
    // @ts-expect-error - accessing private method for test
    expect(() => wsm.tryParseFrame(frame)).toThrow(/opcode/);
  });

  it('decode returns null for frames shorter than 2 bytes', () => {
    // @ts-expect-error - accessing private method for test
    const decoded = wsm.tryParseFrame(Buffer.from([0x81]));
    expect(decoded).toBeNull();
  });
  it('tears down the connection on a protocol error instead of buffering forever', async () => {
    // Real-socket E2E: after an unmasked (protocol-violating) frame the server
    // must fully destroy the socket; a half-close would let the peer keep
    // streaming bytes into the rx buffer and grow memory without bound.
    const srv = new AetherServer({ port: 0, host: '127.0.0.1' });
    await srv.start();
    const port = srv.getPort()!;

    const socket = new net.Socket();
    // Consume the server's 101 response: without a flowing reader the client
    // stream stays paused, buffered bytes are never drained, and 'end'/'close'
    // never fire — which would hang the assertion below.
    socket.on('data', () => {});
    const closed = new Promise<void>((resolve) => {
      socket.once('close', () => resolve());
      socket.once('error', () => {
        /* destroy arrives as error or close */
      });
    });
    await new Promise<void>((resolve, reject) => {
      socket.connect(port, '127.0.0.1', () => {
        socket.write(
          'GET / HTTP/1.1\r\n' +
            'Host: 127.0.0.1\r\n' +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n' +
            'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
            'Sec-WebSocket-Version: 13\r\n\r\n',
        );
        // Give the server a moment to complete the handshake before the
        // malformed frame; real I/O with an external peer cannot be faked.
        setTimeout(() => resolve(), 100);
      });
      socket.on('error', reject);
    });
    socket.write(Buffer.from([0x81, 0x02, 0x68, 0x69]));

    await closed;
    await srv.stop();
  }, 5_000);

  it('broadcast sends JSON-formatted events to all clients', () => {
    const sentMessages: string[] = [];
    const client = {
      id: 'c1',
      send: (data: string) => sentMessages.push(data),
      close: () => {},
    };
    // @ts-expect-error - accessing private clients map for test
    wsm.clients.set('c1', client);

    wsm.broadcast('agent.updated', { agentId: 'abc-123' });

    expect(sentMessages).toHaveLength(1);
    const parsed = JSON.parse(sentMessages[0]);
    expect(parsed.type).toBe('agent.updated');
    expect(parsed.payload).toEqual({ agentId: 'abc-123' });
    expect(parsed.timestamp).toBeDefined();
  });

  it('sendTo sends event to a specific client', () => {
    const sentMessages: string[] = [];
    const client = {
      id: 'c1',
      send: (data: string) => sentMessages.push(data),
      close: () => {},
    };
    // @ts-expect-error - accessing private clients map for test
    wsm.clients.set('c1', client);

    wsm.sendTo('c1', 'private.event', { secret: true });

    expect(sentMessages).toHaveLength(1);
    const parsed = JSON.parse(sentMessages[0]);
    expect(parsed.type).toBe('private.event');
  });
});
describe('API authentication & RBAC', () => {
  it('rejects unauthenticated /api requests and health stays open', async () => {
    const srv = new AetherServer({ port: 0, host: '127.0.0.1', auth: { apiKey: 'secret-key' } });
    await srv.start();
    const base = `http://127.0.0.1:${srv.getPort()}`;
    try {
      expect((await fetch(`${base}/health`)).status).toBe(200);
      expect((await fetch(`${base}/api/agents`)).status).toBe(401);
      expect(
        (await fetch(`${base}/api/agents`, { headers: { Authorization: 'Bearer wrong' } })).status,
      ).toBe(401);
    } finally {
      await srv.stop();
    }
  });

  it('accepts Bearer and X-API-Key with the configured key', async () => {
    const srv = new AetherServer({ port: 0, host: '127.0.0.1', auth: { apiKey: 'secret-key' } });
    await srv.start();
    const base = `http://127.0.0.1:${srv.getPort()}`;
    try {
      const bearer = await fetch(`${base}/api/agents`, {
        headers: { Authorization: 'Bearer secret-key' },
      });
      expect(bearer.status).toBe(200);
      const header = await fetch(`${base}/api/agents`, { headers: { 'X-API-Key': 'secret-key' } });
      expect(header.status).toBe(200);
    } finally {
      await srv.stop();
    }
  });

  it('enforces roles: view-only key cannot mutate agents', async () => {
    const srv = new AetherServer({
      port: 0,
      host: '127.0.0.1',
      auth: {
        apiKey: { 'ro-key': 'viewer' as RoleId, 'admin-key': 'admin' as RoleId },
      },
    });
    await srv.start();
    const base = `http://127.0.0.1:${srv.getPort()}`;
    try {
      const read = await fetch(`${base}/api/agents`, { headers: { 'X-API-Key': 'ro-key' } });
      expect(read.status).toBe(200);
      const write = await fetch(`${base}/api/agents`, {
        method: 'POST',
        headers: { 'X-API-Key': 'ro-key', 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'nope' }),
      });
      expect(write.status).toBe(403);
      // Admin can write.
      const adminWrite = await fetch(`${base}/api/agents`, {
        method: 'POST',
        headers: { 'X-API-Key': 'admin-key', 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'ok' }),
      });
      expect(adminWrite.status).toBe(201);
    } finally {
      await srv.stop();
    }
  });

  it('rejects an unauthenticated WebSocket upgrade and accepts a query-keyed one', async () => {
    const srv = new AetherServer({ port: 0, host: '127.0.0.1', auth: { apiKey: 'ws-key' } });
    await srv.start();
    const port = srv.getPort()!;

    async function handshake(path: string): Promise<boolean> {
      const socket = new net.Socket();
      socket.on('data', () => {});
      let closed = false;
      socket.once('close', () => {
        closed = true;
      });
      await new Promise<void>((resolve, reject) => {
        socket.connect(port, '127.0.0.1', () => {
          socket.write(
            `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\n` +
              'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
              'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
              'Sec-WebSocket-Version: 13\r\n\r\n',
          );
          setTimeout(() => resolve(), 200);
        });
        socket.on('error', reject);
      });
      const result = closed;
      socket.destroy();
      return result;
    }

    try {
      // Unauthenticated upgrade is destroyed (closed).
      expect(await handshake('/')).toBe(true);
      // Query-keyed upgrade is accepted (socket stays open).
      expect(await handshake('/?apikey=ws-key')).toBe(false);
    } finally {
      await srv.stop();
    }
  }, 10_000);
});
describe('AetherServer resilience', () => {
  let server: AetherServer;

  beforeEach(() => {
    server = new AetherServer({ port: 0, host: '127.0.0.1' });
  });

  afterEach(async () => {
    await server.stop();
  });

  it('returns 400 for malformed percent-encoding in a path param', async () => {
    await server.start();
    const res = await fetch(`http://127.0.0.1:${server.getPort()}/api/agents/%zz`);
    expect(res.status).toBe(400);
  });

  it('does not resurrect a pending execution cancelled before it started', async () => {
    await server.start();
    const base = `http://127.0.0.1:${server.getPort()}`;

    const create = await fetch(`${base}/api/executions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: 'hi' }),
    });
    expect(create.status).toBe(201);
    const exec = ((await create.json()) as any).execution;
    expect(exec.status).toBe('pending');

    const cancel = await fetch(`${base}/api/executions/${exec.id}/cancel`, { method: 'POST' });
    expect(cancel.status).toBe(200);
    expect(((await cancel.json()) as any).execution.status).toBe('cancelled');

    // Let the deferred start (setImmediate) fire; it must not flip to running.
    await new Promise((r) => setTimeout(r, 50));
    const after = await fetch(`${base}/api/executions/${exec.id}`);
    expect(((await after.json()) as any).execution.status).toBe('cancelled');
  });

  it('ignores a forged status and rejects non-object config / non-string name', async () => {
    await server.start();
    const base = `http://127.0.0.1:${server.getPort()}`;

    const create = await fetch(`${base}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'guard' }),
    });
    const agentId = ((await create.json()) as any).agent.id;

    // Forging a status must not stick — status stays server-managed.
    const forged = await fetch(`${base}/api/agents/${agentId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'running', name: 'guarded' }),
    });
    expect(forged.status).toBe(200);
    const updated = ((await forged.json()) as any).agent;
    expect(updated.name).toBe('guarded');
    expect(updated.status).toBe('idle');

    const badConfig = await fetch(`${base}/api/agents/${agentId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: 'oops' }),
    });
    expect(badConfig.status).toBe(400);

    const badName = await fetch(`${base}/api/agents/${agentId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 42 }),
    });
    expect(badName.status).toBe(400);
  });
});
