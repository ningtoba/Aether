/**
 * StaticFileServer — serve the built aether-frontend from the backend.
 *
 * Makes Aether a single container/app: the backend serves both the JSON API
 * and the compiled React GUI from the same port, so `docker compose up`
 * followed by a browser visit to the host port is all the user needs.
 *
 * Path discipline:
 *  - `/` and `/index.html` → the SPA shell
 *  - `/assets/*` and other real files → served with a content type
 *  - unknown non-API paths → SPA fallback to index.html (client routing)
 *  - any path traversal (`..`) or absolute escapes are rejected outright.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';

const EXT_CONTENT_TYPE: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.map': 'application/json; charset=utf-8',
};

export class StaticFileServer {
  private root: string;

  constructor(root: string) {
    this.root = normalize(root);
  }

  private resolve(rel: string): string | null {
    // Reject traversal and absolute escapes.
    const clean = rel.split('?')[0].split('#')[0];
    const safe = clean.startsWith('/') ? clean.slice(1) : clean;
    if (safe.includes('\0')) return null;
    // Empty path → the SPA shell.
    const relPath = safe || 'index.html';
    const candidate = normalize(join(this.root, relPath));
    if (!candidate.startsWith(this.root + sep) && candidate !== this.root) return null;
    return candidate;
  }

  /** Attempt to serve a static request. Returns true when the response is handled. */
  serve(req: IncomingMessage, res: ServerResponse): boolean {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    const url = req.url as string;
    if (url.startsWith('/api/')) return false;

    const file = this.resolve(url);
    if (!file) {
      res.writeHead(403, { 'content-type': 'text/plain' });
      res.end('Forbidden');
      return true;
    }

    // Directory or no extension → SPA fallback to index.html unless the path
    // points at a real file.
    if (existsSync(file) && statSync(file).isFile()) {
      this.stream(res, file);
      return true;
    }

    // SPA fallback: a client route like /loops or /settings.
    const index = join(this.root, 'index.html');
    if (!existsSync(index)) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return true;
    }
    this.stream(res, index);
    return true;
  }

  private stream(res: ServerResponse, file: string): void {
    const ext = file.slice(file.lastIndexOf('.'));
    const type = EXT_CONTENT_TYPE[ext] ?? 'application/octet-stream';
    const fh = createReadStream(file);
    fh.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      } else {
        res.destroy();
      }
    });
    res.writeHead(200, {
      'content-type': type,
      'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    });
    fh.pipe(res);
  }
}

/** Resolve the frontend dist directory relative to this package. */
export function resolveFrontendDist(): string | null {
  const here = fileURLToPath(new URL('..', import.meta.url));
  // dist/ of aether-backend → ../../aether-frontend/dist, or the presence of a
  // prebuilt sibling. Prefer the workspace path when it exists.
  const candidates = [
    join(here, '..', '..', 'aether-frontend', 'dist'),
    join(here, '..', '..', '..', 'packages', 'aether-frontend', 'dist'),
    join(process.cwd(), 'packages', 'aether-frontend', 'dist'),
  ];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'index.html'))) return normalize(candidate);
  }
  return null;
}
