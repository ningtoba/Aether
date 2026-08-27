import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WebSocketManager, MAX_WS_FRAME_SIZE } from './websocket.js';
import { createHash } from 'node:crypto';

describe('WebSocketManager', () => {
  let wsm: WebSocketManager;

  beforeEach(() => {
    wsm = new WebSocketManager();
  });

  describe('connection management', () => {
    it('should start with zero connections', () => {
      expect(wsm.connectionCount).toBe(0);
    });

    it('should generate correct WebSocket accept key', () => {
      const key = 'dGhlIHNhbXBsZSBub25jZQ==';
      const expectedAccept = createHash('sha1')
        .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11', 'utf-8')
        .digest('base64');
      expect(expectedAccept).toBe('s3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
    });
  });

  describe('frame encoding', () => {
    it('should encode small payload (<126 bytes) with single-byte length', () => {
      const data = 'Hello';
      const frame = (wsm as any).createTextFrame(data);
      expect(frame[0]).toBe(0x81);
      expect(frame[1]).toBe(5);
      expect(frame.slice(2).toString()).toBe('Hello');
    });

    it('should encode medium payload (126-65535 bytes) with 2-byte extended length', () => {
      const data = 'x'.repeat(200);
      const frame = (wsm as any).createTextFrame(data);
      expect(frame[0]).toBe(0x81);
      expect(frame[1]).toBe(126);
      expect(frame.readUInt16BE(2)).toBe(200);
    });

    it('should encode large payload (>65535 bytes) with 8-byte extended length', () => {
      const data = 'x'.repeat(70000);
      const frame = (wsm as any).createTextFrame(data);
      expect(frame[0]).toBe(0x81);
      expect(frame[1]).toBe(127);
      // Total frame length should be 10 header bytes + 70000 payload
      expect(frame.length).toBe(70010);
    });
  });

  describe('frame decoding', () => {
    const MASK = Buffer.from([0x01, 0x02, 0x03, 0x04]);

    function maskedFrame(opcode: number, payload: Buffer): Buffer {
      const masked = Buffer.alloc(payload.length);
      for (let i = 0; i < payload.length; i++) {
        masked[i] = payload[i] ^ MASK[i % 4];
      }
      return Buffer.concat([Buffer.from([0x80 | opcode, 0x80 | payload.length, ...MASK]), masked]);
    }

    it('should decode a masked text frame', () => {
      const decoded = (wsm as any).tryParseFrame(maskedFrame(0x01, Buffer.from('Hello')));
      expect(decoded).not.toBeNull();
      expect(decoded.payload.toString()).toBe('Hello');
      expect(decoded.consumed).toBe('Hello'.length + 6);
    });

    it('should decode a masked frame with extended 16-bit length', () => {
      const payload = Buffer.from('x'.repeat(300), 'utf-8');
      const masked = Buffer.alloc(payload.length);
      for (let i = 0; i < payload.length; i++) {
        masked[i] = payload[i] ^ MASK[i % 4];
      }
      const header = Buffer.from([0x81, 0x80 | 126, (300 >> 8) & 0xff, 300 & 0xff, ...MASK]);
      const decoded = (wsm as any).tryParseFrame(Buffer.concat([header, masked]));
      expect(decoded).not.toBeNull();
      expect(decoded.payload.length).toBe(300);
    });

    it('should wait for more bytes when a frame is incomplete', () => {
      expect((wsm as any).tryParseFrame(Buffer.from([0x81]))).toBeNull();
      // Full header but missing mask + payload.
      expect((wsm as any).tryParseFrame(Buffer.from([0x81, 0x80 | 5]))).toBeNull();
    });

    it('should reject unmasked client frames (RFC 6455 §5.1)', () => {
      const payload = Buffer.from('no-mask', 'utf-8');
      const frame = Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
      expect(() => (wsm as any).tryParseFrame(frame)).toThrow(/masked/);
    });

    it('should reject unsupported opcodes instead of silently dropping them', () => {
      expect(() => (wsm as any).tryParseFrame(Buffer.from([0x82, 0x80]))).toThrow(/opcode/);
    });

    it('should reject oversized lengths before allocating payload memory', () => {
      const header = Buffer.alloc(10);
      header[0] = 0x81;
      header[1] = 0x80 | 127; // 64-bit extended length, masked
      header.writeBigUInt64BE(BigInt(MAX_WS_FRAME_SIZE) + 1n, 2);
      expect(() => (wsm as any).tryParseFrame(header)).toThrow(/size limit/);
    });

    it('should reject control frames with payload larger than 125 bytes (RFC 6455 §5.5)', () => {
      const header = Buffer.from([0x89, 0x80 | 126, 0, 200, 1, 2, 3, 4]);
      expect(() => (wsm as any).tryParseFrame(header)).toThrow(/125 bytes/);
    });

    it('should reassemble a frame delivered across many TCP chunks', () => {
      const client = { id: 'c1', send: vi.fn(), close: vi.fn(), filter: new Set<string>() };
      const socket = { write: vi.fn(), end: vi.fn() };
      const msg = Buffer.from(JSON.stringify({ filter: ['alpha', 'beta'] }), 'utf-8');
      const frame = maskedFrame(0x01, msg);
      for (const byte of frame) {
        (wsm as any).pushRx(socket, Buffer.from([byte]));
        (wsm as any).processFrames(client, socket);
      }
      expect(client.filter).toEqual(new Set(['alpha', 'beta']));
    });

    it('should handle several frames coalesced in one TCP chunk', () => {
      const client = { id: 'c2', send: vi.fn(), close: vi.fn(), filter: new Set<string>() };
      const socket = { write: vi.fn(), end: vi.fn() };
      const first = JSON.stringify({ filter: ['unused'] });
      const second = JSON.stringify({ filter: ['kept'] });
      const chunk = Buffer.concat([
        maskedFrame(0x01, Buffer.from(first, 'utf-8')),
        maskedFrame(0x01, Buffer.from(second, 'utf-8')),
      ]);
      (wsm as any).pushRx(socket, chunk);
      (wsm as any).processFrames(client, socket);
      expect(client.filter).toEqual(new Set(['kept']));
    });

    it('coalesces receive chunks so a fragmented trickle cannot retain thousands of Buffer objects', () => {
      const socket = { write: vi.fn(), end: vi.fn() };
      for (let i = 0; i < 500; i++) {
        (wsm as any).pushRx(socket, Buffer.alloc(1));
      }
      const buf = (wsm as any).rx.get(socket);
      expect(buf.length).toBe(500);
      expect(buf.chunks.length).toBeLessThanOrEqual(65);
    });

    it('answers ping frames with a pong carrying the same payload', () => {
      const client = { id: 'c1', send: vi.fn(), close: vi.fn(), filter: new Set<string>() };
      const socket = { write: vi.fn(), end: vi.fn() };
      const frame = maskedFrame(0x09, Buffer.from('hi'));
      (wsm as any).pushRx(socket, frame);
      (wsm as any).processFrames(client, socket);
      expect(socket.write).toHaveBeenCalled();
      const written = socket.write.mock.calls[0][0] as Buffer;
      expect(written[0] & 0x0f).toBe(0x0a); // pong opcode
      expect(written.subarray(2).toString()).toBe('hi');
    });
  });

  describe('broadcast', () => {
    it('should broadcast to all connected clients', () => {
      const client1 = { id: 'c1', send: vi.fn(), close: vi.fn() };
      const client2 = { id: 'c2', send: vi.fn(), close: vi.fn() };
      (wsm as any).clients.set('c1', client1);
      (wsm as any).clients.set('c2', client2);

      wsm.broadcast('test.event', { foo: 'bar' });

      expect(client1.send).toHaveBeenCalledTimes(1);
      expect(client2.send).toHaveBeenCalledTimes(1);
      const sentData = JSON.parse(client1.send.mock.calls[0][0]);
      expect(sentData.type).toBe('test.event');
      expect(sentData.payload).toEqual({ foo: 'bar' });
      expect(sentData.timestamp).toBeDefined();
    });

    it('should respect client event filters', () => {
      const client = {
        id: 'c1',
        send: vi.fn(),
        close: vi.fn(),
        filter: new Set(['allowed.event']),
      };
      (wsm as any).clients.set('c1', client);

      wsm.broadcast('allowed.event', { data: 1 });
      expect(client.send).toHaveBeenCalledTimes(1);

      wsm.broadcast('blocked.event', { data: 2 });
      expect(client.send).toHaveBeenCalledTimes(1);
    });

    it('should handle no clients gracefully', () => {
      expect(() => wsm.broadcast('event', {})).not.toThrow();
    });
  });

  describe('sendTo', () => {
    it('should send to a specific client by ID', () => {
      const client = { id: 'c1', send: vi.fn(), close: vi.fn() };
      (wsm as any).clients.set('c1', client);

      wsm.sendTo('c1', 'private.event', { secret: true });
      expect(client.send).toHaveBeenCalledTimes(1);
      const sentData = JSON.parse(client.send.mock.calls[0][0]);
      expect(sentData.type).toBe('private.event');
    });

    it('should silently ignore non-existent client IDs', () => {
      expect(() => wsm.sendTo('nonexistent', 'event', {})).not.toThrow();
    });
  });

  describe('detach', () => {
    it('should close all clients and clear the map', () => {
      const client = { id: 'c1', send: vi.fn(), close: vi.fn() };
      (wsm as any).clients.set('c1', client);

      wsm.detach();

      expect(client.close).toHaveBeenCalled();
      expect(wsm.connectionCount).toBe(0);
    });
  });
});
