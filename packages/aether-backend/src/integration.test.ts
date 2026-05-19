/**
 * Integration tests for @aether/backend
 *
 * Tests the full backend flow against a real HTTP server:
 * - Agent lifecycle (create, list, get by id)
 * - Health endpoint
 * - CORS preflight handling
 * - WebSocket frame encoding/decoding end to end
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AetherServer } from "./server.js";
import { WebSocketManager } from "./websocket.js";

// ---------------------------------------------------------------------------
// Full HTTP server integration
// ---------------------------------------------------------------------------
describe("AetherServer HTTP integration", () => {
  let server: AetherServer;

  beforeEach(() => {
    server = new AetherServer({ port: 0, host: "127.0.0.1" });
  });

  afterEach(async () => {
    await server.stop();
  });

  it("health endpoint returns expected shape", async () => {
    await server.start();

    const res = await fetch(`http://127.0.0.1:${server.getPort()}/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");

    const body: any = await res.json();
    expect(body).toHaveProperty("status");
    expect(body).toHaveProperty("version");
    expect(body).toHaveProperty("uptime");
    expect(body).toHaveProperty("memory");
    expect(body).toHaveProperty("providers");
    expect(body).toHaveProperty("timestamp");
    expect(body.status).toBe("ok");
    expect(body.version).toBe("0.1.0");
    expect(body.memory).toHaveProperty("rss");
    expect(body.memory).toHaveProperty("heapUsed");
    expect(body.providers).toHaveProperty("configured");
    expect(body.providers).toHaveProperty("healthy");
  });

  it("creates an agent and lists agents", async () => {
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
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test-agent-1" }),
    });
    expect(createRes.status).toBe(201);
    const createBody: any = await createRes.json();
    expect(createBody.agent).toHaveProperty("id");
    expect(createBody.agent.name).toBe("test-agent-1");
    expect(createBody.agent.status).toBe("idle");

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
    expect(getBody.agent.name).toBe("test-agent-1");
    expect(getBody.agent.id).toBe(agentId);
  });

  it("creates an execution flow (create, list, get by id)", async () => {
    await server.start();
    const port = server.getPort()!;
    const base = `http://127.0.0.1:${port}`;

    // Create an execution
    const createRes = await fetch(`${base}/api/executions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: "test-agent-id",
        input: { message: "run task" },
      }),
    });
    expect(createRes.status).toBe(201);
    const createBody: any = await createRes.json();
    expect(createBody.execution).toHaveProperty("id");
    expect(createBody.execution.status).toBe("pending");
    expect(createBody.execution.agentId).toBe("test-agent-id");

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
    expect(getBody.execution.status).toBe("running");
  });

  it("returns 404 for unknown routes", async () => {
    await server.start();
    const port = server.getPort()!;
    const res = await fetch(`http://127.0.0.1:${port}/api/nonexistent`);
    expect(res.status).toBe(404);
    const body: any = await res.json();
    expect(body).toHaveProperty("error");
    expect(body.error).toBe("Not found");
  });
});

// ---------------------------------------------------------------------------
// CORS integration
// ---------------------------------------------------------------------------
describe("CORS integration", () => {
  let server: AetherServer;

  beforeEach(() => {
    server = new AetherServer({ port: 0, host: "127.0.0.1" });
  });

  afterEach(async () => {
    await server.stop();
  });

  it("responds to OPTIONS preflight with correct CORS headers", async () => {
    await server.start();
    const port = server.getPort()!;
    const res = await fetch(`http://127.0.0.1:${port}/api/agents`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://example.com",
        "Access-Control-Request-Method": "POST",
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toBe(
      "GET, POST, PUT, DELETE, OPTIONS"
    );
    expect(res.headers.get("access-control-allow-headers")).toBe(
      "Content-Type, Authorization, X-Requested-With"
    );
    expect(res.headers.get("access-control-max-age")).toBe("86400");
  });

  it("sets CORS headers on normal GET requests", async () => {
    await server.start();
    const port = server.getPort()!;
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});

// ---------------------------------------------------------------------------
// WebSocket frame encoding/decoding end to end
// ---------------------------------------------------------------------------
describe("WebSocket frame encoding/decoding E2E", () => {
  let wsm: WebSocketManager;

  beforeEach(() => {
    wsm = new WebSocketManager();
  });

  it("encode then decode a text frame produces original data", () => {
    const original = "Hello, Aether WebSocket!";
    // @ts-expect-error - accessing private method for test
    const frame = wsm.createTextFrame(original);
    expect(frame).toBeInstanceOf(Buffer);
    expect(frame.length).toBeGreaterThan(original.length);

    // @ts-expect-error - accessing private method for test
    const decoded = wsm.decodeFrame(frame);
    expect(decoded).not.toBeNull();
    expect(decoded!.toString()).toBe(original);
  });

  it("encode then decode a large text frame (>64KB)", () => {
    const original = "x".repeat(70_000);
    // @ts-expect-error - accessing private method for test
    const frame = wsm.createTextFrame(original);
    // @ts-expect-error - accessing private method for test
    const decoded = wsm.decodeFrame(frame);
    expect(decoded).not.toBeNull();
    expect(decoded!.toString()).toBe(original);
    expect(decoded!.length).toBe(70_000);
  });

  it("decode returns null for non-text opcodes", () => {
    // Binary frame (opcode 0x02)
    const frame = Buffer.from([0x82, 0]);
    // @ts-expect-error - accessing private method for test
    const decoded = wsm.decodeFrame(frame);
    expect(decoded).toBeNull();
  });

  it("decode returns null for frames shorter than 2 bytes", () => {
    // @ts-expect-error - accessing private method for test
    const decoded = wsm.decodeFrame(Buffer.from([0x81]));
    expect(decoded).toBeNull();
  });

  it("broadcast sends JSON-formatted events to all clients", () => {
    const sentMessages: string[] = [];
    const client = {
      id: "c1",
      send: (data: string) => sentMessages.push(data),
      close: () => {},
    };
    // @ts-expect-error - accessing private clients map for test
    wsm.clients.set("c1", client);

    wsm.broadcast("agent.updated", { agentId: "abc-123" });

    expect(sentMessages).toHaveLength(1);
    const parsed = JSON.parse(sentMessages[0]);
    expect(parsed.type).toBe("agent.updated");
    expect(parsed.payload).toEqual({ agentId: "abc-123" });
    expect(parsed.timestamp).toBeDefined();
  });

  it("sendTo sends event to a specific client", () => {
    const sentMessages: string[] = [];
    const client = {
      id: "c1",
      send: (data: string) => sentMessages.push(data),
      close: () => {},
    };
    // @ts-expect-error - accessing private clients map for test
    wsm.clients.set("c1", client);

    wsm.sendTo("c1", "private.event", { secret: true });

    expect(sentMessages).toHaveLength(1);
    const parsed = JSON.parse(sentMessages[0]);
    expect(parsed.type).toBe("private.event");
  });
});
