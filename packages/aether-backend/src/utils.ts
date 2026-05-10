/**
 * HTTP utility helpers
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

/** Send a JSON response */
export function jsonResponse(res: ServerResponse, statusCode: number, data: unknown): void {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

/** Parse JSON body from incoming request */
export function parseBody<T = Record<string, unknown>>(req: IncomingMessage): Promise<T | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      if (chunks.length === 0) return resolve(null);
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
        resolve(body as T);
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

/** Send a 404 response */
export function notFound(res: ServerResponse, message = 'Not found'): void {
  jsonResponse(res, 404, { error: message });
}

/** Send a 400 response */
export function badRequest(res: ServerResponse, message = 'Bad request'): void {
  jsonResponse(res, 400, { error: message });
}

/** Send a 500 response */
export function serverError(res: ServerResponse, message = 'Internal server error'): void {
  jsonResponse(res, 500, { error: message });
}
