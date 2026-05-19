import { describe, it, expect, beforeEach, vi } from "vitest";
import { WebSocketManager } from "./websocket.js";
import { createHash } from "node:crypto";

describe("WebSocketManager", () => {
  let wsm: WebSocketManager;

  beforeEach(() => {
    wsm = new WebSocketManager();
  });

  describe("connection management", () => {
    it("should start with zero connections", () => {
      expect(wsm.connectionCount).toBe(0);
    });

    it("should generate correct WebSocket accept key", () => {
      const key = "dGhlIHNhbXBsZSBub25jZQ==";
      const expectedAccept = createHash("sha1")
        .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11", "utf-8")
        .digest("base64");
      expect(expectedAccept).toBe("s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
    });
  });

  describe("frame encoding", () => {
    it("should encode small payload (<126 bytes) with single-byte length", () => {
      const data = "Hello";
      const frame = (wsm as any).createTextFrame(data);
      expect(frame[0]).toBe(0x81);
      expect(frame[1]).toBe(5);
      expect(frame.slice(2).toString()).toBe("Hello");
    });

    it("should encode medium payload (126-65535 bytes) with 2-byte extended length", () => {
      const data = "x".repeat(200);
      const frame = (wsm as any).createTextFrame(data);
      expect(frame[0]).toBe(0x81);
      expect(frame[1]).toBe(126);
      expect(frame.readUInt16BE(2)).toBe(200);
    });

    it("should encode large payload (>65535 bytes) with 8-byte extended length", () => {
      const data = "x".repeat(70000);
      const frame = (wsm as any).createTextFrame(data);
      expect(frame[0]).toBe(0x81);
      expect(frame[1]).toBe(127);
      // Total frame length should be 10 header bytes + 70000 payload
      expect(frame.length).toBe(70010);
    });
  });

  describe("frame decoding", () => {
    it("should decode an unmasked text frame", () => {
      const payload = Buffer.from("Hello, World!", "utf-8");
      const header = Buffer.from([0x81, payload.length]);
      const frame = Buffer.concat([header, payload]);
      const decoded = (wsm as any).decodeFrame(frame);
      expect(decoded).not.toBeNull();
      expect(decoded.toString()).toBe("Hello, World!");
    });

    it("should decode a masked text frame", () => {
      const payload = Buffer.from("Hello", "utf-8");
      const mask = Buffer.from([0x01, 0x02, 0x03, 0x04]);
      const maskedPayload = Buffer.alloc(payload.length);
      for (let i = 0; i < payload.length; i++) {
        maskedPayload[i] = payload[i] ^ mask[i % 4];
      }
      const header = Buffer.from([0x81, 0x80 | payload.length, ...mask]);
      const frame = Buffer.concat([header, maskedPayload]);
      const decoded = (wsm as any).decodeFrame(frame);
      expect(decoded).not.toBeNull();
      expect(decoded.toString()).toBe("Hello");
    });

    it("should decode frame with extended 16-bit length", () => {
      const data = "x".repeat(300);
      const payload = Buffer.from(data, "utf-8");
      const header = Buffer.from([0x81, 126, (300 >> 8) & 0xff, 300 & 0xff]);
      const frame = Buffer.concat([header, payload]);
      const decoded = (wsm as any).decodeFrame(frame);
      expect(decoded).not.toBeNull();
      expect(decoded.length).toBe(300);
    });

    it("should return null for frames shorter than 2 bytes", () => {
      const frame = Buffer.from([0x81]);
      const decoded = (wsm as any).decodeFrame(frame);
      expect(decoded).toBeNull();
    });

    it("should return null for non-text/close/ping opcodes", () => {
      const frame = Buffer.from([0x82, 0]);
      const decoded = (wsm as any).decodeFrame(frame);
      expect(decoded).toBeNull();
    });
  });

  describe("broadcast", () => {
    it("should broadcast to all connected clients", () => {
      const client1 = { id: "c1", send: vi.fn(), close: vi.fn() };
      const client2 = { id: "c2", send: vi.fn(), close: vi.fn() };
      (wsm as any).clients.set("c1", client1);
      (wsm as any).clients.set("c2", client2);

      wsm.broadcast("test.event", { foo: "bar" });

      expect(client1.send).toHaveBeenCalledTimes(1);
      expect(client2.send).toHaveBeenCalledTimes(1);
      const sentData = JSON.parse(client1.send.mock.calls[0][0]);
      expect(sentData.type).toBe("test.event");
      expect(sentData.payload).toEqual({ foo: "bar" });
      expect(sentData.timestamp).toBeDefined();
    });

    it("should respect client event filters", () => {
      const client = {
        id: "c1",
        send: vi.fn(),
        close: vi.fn(),
        filter: new Set(["allowed.event"]),
      };
      (wsm as any).clients.set("c1", client);

      wsm.broadcast("allowed.event", { data: 1 });
      expect(client.send).toHaveBeenCalledTimes(1);

      wsm.broadcast("blocked.event", { data: 2 });
      expect(client.send).toHaveBeenCalledTimes(1);
    });

    it("should handle no clients gracefully", () => {
      expect(() => wsm.broadcast("event", {})).not.toThrow();
    });
  });

  describe("sendTo", () => {
    it("should send to a specific client by ID", () => {
      const client = { id: "c1", send: vi.fn(), close: vi.fn() };
      (wsm as any).clients.set("c1", client);

      wsm.sendTo("c1", "private.event", { secret: true });
      expect(client.send).toHaveBeenCalledTimes(1);
      const sentData = JSON.parse(client.send.mock.calls[0][0]);
      expect(sentData.type).toBe("private.event");
    });

    it("should silently ignore non-existent client IDs", () => {
      expect(() => wsm.sendTo("nonexistent", "event", {})).not.toThrow();
    });
  });

  describe("detach", () => {
    it("should close all clients and clear the map", () => {
      const client = { id: "c1", send: vi.fn(), close: vi.fn() };
      (wsm as any).clients.set("c1", client);

      wsm.detach();

      expect(client.close).toHaveBeenCalled();
      expect(wsm.connectionCount).toBe(0);
    });
  });
});
