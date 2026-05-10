/**
 * WebSocket manager for streaming execution events
 */
import { createHash } from 'node:crypto';
import type { Server } from 'node:http';

interface WSClient {
  id: string;
  send: (data: string) => void;
  close: () => void;
  filter?: Set<string>;
}

interface WSEvent {
  type: string;
  payload: unknown;
  timestamp: string;
}

export class WebSocketManager {
  private clients = new Map<string, WSClient>();
  private server: Server | null = null;
  private upgradeHandler: ((req: any, socket: any, head: any) => void) | null = null;

  attach(server: Server): void {
    this.server = server;

    this.upgradeHandler = (req, socket, head) => {
      const key = req.headers['sec-websocket-key'];
      if (!key) {
        socket.destroy();
        return;
      }

      const acceptKey = this.generateAcceptValue(key);
      const responseHeaders = [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${acceptKey}`,
        '',
        '',
      ].join('\r\n');

      socket.write(responseHeaders);

      const clientId = crypto.randomUUID();
      const client: WSClient = {
        id: clientId,
        send: (data: string) => {
          try {
            const frame = this.createTextFrame(data);
            socket.write(frame);
          } catch {
            // client disconnected
          }
        },
        close: () => {
          try {
            socket.end();
          } catch { /* ignore */ }
          this.clients.delete(clientId);
        },
      };

      this.clients.set(clientId, client);

      socket.on('data', (buffer: Buffer) => {
        const message = this.decodeFrame(buffer);
        if (message) {
          try {
            const parsed = JSON.parse(message.toString());
            if (parsed.filter && Array.isArray(parsed.filter)) {
              client.filter = new Set<string>(parsed.filter);
            }
          } catch { /* ignore non-JSON control messages */ }
        }
      });

      socket.on('close', () => {
        this.clients.delete(clientId);
      });

      socket.on('error', () => {
        this.clients.delete(clientId);
      });
    };

    server.on('upgrade', this.upgradeHandler);
  }

  detach(): void {
    if (this.server && this.upgradeHandler) {
      this.server.removeListener('upgrade', this.upgradeHandler);
      this.upgradeHandler = null;
    }
    const entries = Array.from(this.clients.entries());
    for (const [, client] of entries) {
      client.close();
    }
    this.clients.clear();
  }

  broadcast(type: string, payload: unknown): void {
    const event: WSEvent = {
      type,
      payload,
      timestamp: new Date().toISOString(),
    };
    const data = JSON.stringify(event);
    const entries = Array.from(this.clients.entries());
    for (const [, client] of entries) {
      if (client.filter && !client.filter.has(type)) continue;
      client.send(data);
    }
  }

  sendTo(clientId: string, type: string, payload: unknown): void {
    const client = this.clients.get(clientId);
    if (!client) return;
    const event: WSEvent = {
      type,
      payload,
      timestamp: new Date().toISOString(),
    };
    client.send(JSON.stringify(event));
  }

  get connectionCount(): number {
    return this.clients.size;
  }

  private generateAcceptValue(key: string): string {
    const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
    return createHash('sha1').update(key + GUID, 'utf-8').digest('base64');
  }

  private createTextFrame(data: string): Buffer {
    const payload = Buffer.from(data, 'utf-8');
    const length = payload.length;
    const header: number[] = [0x81]; // FIN + text opcode

    if (length < 126) {
      header.push(length);
    } else if (length < 65536) {
      header.push(126, (length >> 8) & 0xff, length & 0xff);
    } else {
      header.push(127);
      for (let i = 7; i >= 0; i--) {
        header.push((length >> (i * 8)) & 0xff);
      }
    }

    return Buffer.concat([Buffer.from(header), payload]);
  }

  private decodeFrame(buffer: Buffer): Buffer | null {
    if (buffer.length < 2) return null;
    const opcode = buffer[0] & 0x0f;
    if (opcode !== 0x01 && opcode !== 0x08 && opcode !== 0x09) return null;

    const masked = (buffer[1] & 0x80) !== 0;
    let offset = 2;
    let length = buffer[1] & 0x7f;

    if (length === 126) {
      length = buffer.readUInt16BE(2);
      offset = 4;
    } else if (length === 127) {
      length = buffer.readUInt32BE(6);
      offset = 10;
    }

    if (masked) {
      const mask = buffer.subarray(offset, offset + 4);
      offset += 4;
      const unmasked = Buffer.alloc(length);
      for (let i = 0; i < length; i++) {
        unmasked[i] = buffer[offset + i] ^ mask[i % 4];
      }
      return unmasked;
    }

    return buffer.subarray(offset, offset + length);
  }
}
