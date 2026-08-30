/**
 * StaticFileServer is the security boundary between the public HTTP port and
 * the container filesystem — until now it had ZERO tests. These cases pin the
 * guards in resolve()/serve() as they actually behave:
 *
 *  - raw `..` traversal that would escape the root  → 403 Forbidden
 *    (the startsWith(root+sep) containment check in resolve());
 *  - encoded (%2e%2e%2f), backslash, and absolute-path injections are NOT
 *    decoded/backslash-normalized, so they resolve to literal names INSIDE the
 *    root and land on the SPA fallback — the discriminating assertion is that
 *    the planted parent-directory secret never appears in the body. If a
 *    future change adds decodeURIComponent() these flip to 403 and this test
 *    fails on purpose, forcing a conscious re-read of the semantics;
 *  - cache semantics exactly as coded: '.html' → no-cache, everything else →
 *    immutable year, including the index.html streamed for SPA fallbacks;
 *  - POST and /api/* return false (unhandled — the mock server answers 418);
 *  - missing dist/index.html → fixed 404 JSON, never a directory guess.
 *
 * Requests go through a real http.Server with RAW request paths (node:http
 * client does not normalize `..` the way new URL()/fetch do), so the server
 * sees exactly the bytes an attacker would put on the wire.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as http from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { StaticFileServer, resolveFrontendDist } from './static-server.js';

const INDEX_BODY = '<!doctype html><title>SPA-SHELL</title>';
const APP_JS = "console.log('app-payload');";
const SITE_CSS = 'body{color:#000}';
const META_JSON = '{"meta":true}';
const SECRET = 'TOP-SECRET-OUTSIDE-ROOT';

let base: string; // tmp base dir
let root: string; // served dist dir
let emptyRoot: string; // dist dir WITHOUT index.html (fresh-checkout state)
let server: http.Server;
let port: number;
let current: StaticFileServer;

/** The marker body the mock writes only when serve() declines the request. */
const FALLTHROUGH = 'FALLTHROUGH-NOT-HANDLED';

beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), 'aether-static-'));
  root = join(base, 'dist');
  emptyRoot = join(base, 'dist-empty');
  mkdirSync(join(root, 'assets'), { recursive: true });
  mkdirSync(join(root, 'styles'), { recursive: true });
  mkdirSync(join(root, 'data'), { recursive: true });
  mkdirSync(emptyRoot, { recursive: true });
  writeFileSync(join(root, 'index.html'), INDEX_BODY);
  writeFileSync(join(root, 'assets', 'app.js'), APP_JS);
  writeFileSync(join(root, 'assets', 'app.js.map'), '{"version":3}');
  writeFileSync(join(root, 'assets', 'font.woff2'), 'wOF2bytes');
  writeFileSync(join(root, 'styles', 'site.css'), SITE_CSS);
  writeFileSync(join(root, 'data', 'meta.json'), META_JSON);
  writeFileSync(join(root, 'icon.svg'), '<svg/>');
  // No-extension file: pins the slice(lastIndexOf('.')) quirk (see test).
  writeFileSync(join(root, 'LICENSE'), 'MIT');
  // Planted OUTSIDE the served root — any appearance of SECRET in a response
  // means containment broke.
  writeFileSync(join(base, 'secret.txt'), SECRET);

  server = http.createServer((req, res) => {
    if (current.serve(req, res)) return;
    res.writeHead(418, { 'content-type': 'text/plain' });
    res.end(FALLTHROUGH);
  });
  const { promise: listening, resolve: onListening } = Promise.withResolvers<void>();
  server.listen(0, '127.0.0.1', onListening);
  await listening;
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  const { promise: closed, resolve: onClosed } = Promise.withResolvers<void>();
  server.close(() => onClosed());
  await closed;
  rmSync(base, { recursive: true, force: true });
});

beforeEach(() => {
  current = new StaticFileServer(root);
});

/** Raw HTTP request — no URL normalization of `..`, `%2e`, backslashes. */
function raw(
  method: string,
  path: string,
  servedRoot?: string,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  if (servedRoot !== undefined) current = new StaticFileServer(servedRoot);
  const { promise, resolve, reject } = Promise.withResolvers<{
    status: number;
    headers: http.IncomingHttpHeaders;
    body: string;
  }>();
  const req = http.request({ host: '127.0.0.1', port, method, path }, (res) => {
    const chunks: Buffer[] = [];
    res.on('data', (c) => chunks.push(c as Buffer));
    res.on('end', () =>
      resolve({
        status: res.statusCode ?? 0,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }),
    );
  });
  req.on('error', reject);
  req.end();
  return promise;
}

describe('traversal containment (resolve)', () => {
  // If the `!candidate.startsWith(this.root + sep)` check in resolve() were
  // removed, every one of these would stream base/secret.txt with 200.
  it('rejects raw ../ escape with 403 Forbidden', async () => {
    for (const path of [
      '/../secret.txt',
      '/assets/../../secret.txt',
      '/a/b/../../../secret.txt',
      '/../',
    ]) {
      const res = await raw('GET', path);
      expect(res.status, path).toBe(403);
      expect(res.headers['content-type'], path).toBe('text/plain');
      expect(res.body, path).toBe('Forbidden');
      expect(res.body).not.toContain(SECRET);
    }
  });

  // The code never percent-decodes, so these stay literal single filenames
  // inside the root → not found → SPA fallback. Pinning the ACTUAL status:
  // if decoding is ever added the answer becomes 403 and this fails loudly.
  it('neutralizes encoded traversal (%2e%2e%2f) — falls back to the SPA shell, never leaks the secret', async () => {
    for (const path of [
      '/%2e%2e/secret.txt',
      '/%2e%2e%2f%2e%2e%2fsecret.txt',
      '/..%2f..%2fsecret.txt',
    ]) {
      const res = await raw('GET', path);
      expect(res.status, path).toBe(200);
      expect(res.body, path).toBe(INDEX_BODY);
      expect(res.body).not.toContain(SECRET);
    }
  });

  // path.join(root, '/etc/passwd') = root/etc/passwd — the injected absolute
  // path is re-based inside the root, so /etc/passwd is never readable.
  it('neutralizes absolute-path injection', async () => {
    for (const path of ['//etc/passwd', '///etc/passwd']) {
      const res = await raw('GET', path);
      expect(res.status, path).toBe(200);
      expect(res.body, path).toBe(INDEX_BODY);
      expect(res.body).not.toContain('root:');
    }
  });

  // POSIX treats '\' as an ordinary filename char — backslash traversal is a
  // literal name inside the root → SPA fallback, not an escape.
  it('neutralizes backslash traversal variants', async () => {
    for (const path of ['/\\..\\..\\etc\\passwd', '/..\\secret.txt', '/%2e%2e\\secret.txt']) {
      const res = await raw('GET', path);
      expect(res.status, path).toBe(200);
      expect(res.body, path).toBe(INDEX_BODY);
      expect(res.body).not.toContain(SECRET);
    }
  });

  // Query/fragment are stripped before containment: with the strip removed,
  // '/data/meta.json?x=1' would miss the file check and serve HTML instead.
  it('strips query and fragment before resolving', async () => {
    const json = await raw('GET', '/data/meta.json?next=/../secret.txt');
    expect(json.status).toBe(200);
    expect(json.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(json.body).toBe(META_JSON);
    const frag = await raw('GET', '/index.html#/loops/../x');
    expect(frag.status).toBe(200);
    expect(frag.body).toBe(INDEX_BODY);
  });

  // The `candidate !== this.root` arm of the containment check: '/.'
  // normalizes to the root itself and must be allowed through (then falls
  // back to the shell because the root is not a file).
  it('allows the root itself ("/.") through the containment check', async () => {
    const res = await raw('GET', '/.');
    expect(res.status).toBe(200);
    expect(res.body).toBe(INDEX_BODY);
  });
});

describe('real files: body, content-type, cache headers', () => {
  it('serves index.html with html type and no-cache', async () => {
    const res = await raw('GET', '/index.html');
    expect(res.status).toBe(200);
    expect(res.body).toBe(INDEX_BODY);
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
    // 'no-cache' because ext === '.html' in stream(); flipping the ternary breaks this.
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('serves hashed assets with their exact content types and immutable cache', async () => {
    const cases: Array<[string, string, string]> = [
      ['/assets/app.js', APP_JS, 'application/javascript; charset=utf-8'],
      ['/styles/site.css', SITE_CSS, 'text/css; charset=utf-8'],
      ['/data/meta.json', META_JSON, 'application/json; charset=utf-8'],
      ['/icon.svg', '<svg/>', 'image/svg+xml'],
      ['/assets/font.woff2', 'wOF2bytes', 'font/woff2'],
      // '.map' maps to JSON explicitly — not inherited from '.js'.
      ['/assets/app.js.map', '{"version":3}', 'application/json; charset=utf-8'],
    ];
    for (const [path, body, type] of cases) {
      const res = await raw('GET', path);
      expect(res.status, path).toBe(200);
      expect(res.body, path).toBe(body);
      expect(res.headers['content-type'], path).toBe(type);
      // Non-html → the fixed immutable year from stream().
      expect(res.headers['cache-control'], path).toBe('public, max-age=31536000, immutable');
    }
  });

  // Quirk pinned on purpose: stream() takes the ext via
  // file.slice(file.lastIndexOf('.')), so a dotless name yields its last
  // CHARACTER ('E'), not '' — unmapped → octet-stream, and non-'.html' →
  // immutable. If someone "fixes" the slice, this test documents the change.
  it('serves a no-extension file as octet-stream with immutable cache', async () => {
    const res = await raw('GET', '/LICENSE');
    expect(res.status).toBe(200);
    expect(res.body).toBe('MIT');
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });
});

describe('SPA fallback', () => {
  it('routes "/" to the shell (empty path → index.html)', async () => {
    const res = await raw('GET', '/');
    expect(res.status).toBe(200);
    expect(res.body).toBe(INDEX_BODY);
  });

  it('routes unknown client paths to the shell with html no-cache', async () => {
    for (const path of ['/loops', '/loops/42', '/settings/deep/link']) {
      const res = await raw('GET', path);
      expect(res.status, path).toBe(200);
      expect(res.body, path).toBe(INDEX_BODY);
      // Fallback streams index.html → the html arm of the cache ternary,
      // NOT the immutable year (client routes must stay revalidatable).
      expect(res.headers['content-type'], path).toBe('text/html; charset=utf-8');
      expect(res.headers['cache-control'], path).toBe('no-cache');
    }
  });

  // Directories exist but are not files — the statSync().isFile() gate sends
  // them to the shell instead of trying to stream a directory.
  it('routes a real directory request to the shell', async () => {
    const res = await raw('GET', '/assets');
    expect(res.status).toBe(200);
    expect(res.body).toBe(INDEX_BODY);
  });
});

describe('method and API-scope declines (serve returns false)', () => {
  // 418/FALLTHROUGH is written by the mock ONLY when serve() declined.
  // Without the decline, POST would get 200 + shell body from the fallback.
  it('declines POST/PUT/DELETE for the static layer', async () => {
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const res = await raw(method, '/index.html');
      expect(res.status, method).toBe(418);
      expect(res.body, method).toBe(FALLTHROUGH);
    }
  });

  // Without the '/api/' short-circuit, '/api/health' would resolve to a
  // nonexistent path and be answered with the SPA shell — masking the API 404.
  it('declines /api/* even for GET', async () => {
    const res = await raw('GET', '/api/health');
    expect(res.status).toBe(418);
    expect(res.body).toBe(FALLTHROUGH);
  });

  // HEAD must be served (headers identical, body suppressed by node for HEAD).
  it('serves HEAD like GET without a body', async () => {
    const res = await raw('HEAD', '/index.html');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.body).toBe('');
  });
});

describe('dist without index.html (fresh checkout / unbuilt GUI)', () => {
  it('answers the fixed 404 JSON for both root and unknown paths', async () => {
    for (const path of ['/', '/anything.css']) {
      const res = await raw('GET', path, emptyRoot);
      expect(res.status, path).toBe(404);
      expect(res.headers['content-type'], path).toBe('application/json');
      expect(res.body, path).toBe(JSON.stringify({ error: 'Not found' }));
    }
  });

  it('still 403s traversal before the missing-index path is even consulted', async () => {
    const res = await raw('GET', '/../secret.txt', emptyRoot);
    expect(res.status).toBe(403);
    expect(res.body).toBe('Forbidden');
  });
});

describe('resolveFrontendDist', () => {
  // The return depends on whether the workspace GUI is built, but the
  // contract is absolute: NEVER a directory lacking index.html (null when
  // nothing qualifies), so callers can pass the result straight into
  // StaticFileServer without a second existsSync.
  it('never returns a directory without index.html', () => {
    const dist = resolveFrontendDist();
    if (dist !== null) {
      expect(existsSync(join(dist, 'index.html'))).toBe(true);
    }
  });
});
