/**
 * HTTP utility helpers
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
declare module 'node:http' {
  interface IncomingMessage {
    /** Server-configured body size cap, attached by AetherServer before routing. */
    maxBodySize?: number;
  }
}

/** Send a JSON response */
export function jsonResponse(res: ServerResponse, statusCode: number, data: unknown): void {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

/** Default cap on request body size in bytes (1 MB). */
export const DEFAULT_MAX_BODY_SIZE = 1_000_000;

/** Result of parsing a request body. */
export type BodyParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'too_large' | 'invalid' | 'empty' };

/**
 * Parse JSON body from an incoming request, enforcing a size cap so a single
 * request cannot exhaust server memory. `reason === 'too_large'` lets callers
 * respond 413 (Payload Too Large); 'invalid' means malformed JSON; 'empty'
 * means no body was sent.
 */
export function parseBody<T = Record<string, unknown>>(
  req: IncomingMessage,
  maxBytes: number = req.maxBodySize ?? DEFAULT_MAX_BODY_SIZE,
): Promise<BodyParseResult<T>> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;

    req.on('data', (chunk: Buffer) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > maxBytes) {
        tooLarge = true;
        // Drain the rest without buffering so the socket stays usable and the
        // caller can still send a 413 response.
        req.resume();
        resolve({ ok: false, reason: 'too_large' });
      } else {
        chunks.push(chunk);
      }
    });

    req.on('end', () => {
      if (tooLarge) return;
      if (chunks.length === 0) return resolve({ ok: false, reason: 'empty' });
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
        resolve({ ok: true, value: body as T });
      } catch {
        resolve({ ok: false, reason: 'invalid' });
      }
    });

    req.on('error', () => resolve({ ok: false, reason: 'invalid' }));
  });
}

/** Send a 413 Payload Too Large response. */
export function payloadTooLarge(res: ServerResponse, message = 'Request body too large'): void {
  jsonResponse(res, 413, { error: message });
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
