import type { IncomingMessage, ServerResponse } from 'node:http';

/** Parsed URL route parameters */
export interface RouteParams {
  [key: string]: string;
}

/** HTTP request handler */
export type RequestHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  params?: RouteParams,
  body?: unknown,
) => void | Promise<void>;

/** Registered route entry */
export interface RouteEntry {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: RequestHandler;
}

/** Router for simple pattern-matched HTTP routing */
export class Router {
  private routes: RouteEntry[] = [];

  /** Register a route with :param placeholders */
  on(method: string, path: string, handler: RequestHandler): void {
    const paramNames: string[] = [];
    const patternString = path.replace(/:([a-zA-Z_]+)/g, (_match, name) => {
      paramNames.push(name);
      return '([^/]+)';
    });
    const pattern = new RegExp(`^${patternString}$`);
    this.routes.push({ method: method.toUpperCase(), pattern, paramNames, handler });
  }

  /** Convenience methods */
  get(path: string, handler: RequestHandler): void { this.on('GET', path, handler); }
  post(path: string, handler: RequestHandler): void { this.on('POST', path, handler); }
  put(path: string, handler: RequestHandler): void { this.on('PUT', path, handler); }
  delete(path: string, handler: RequestHandler): void { this.on('DELETE', path, handler); }

  /** Match an incoming request to a route handler */
  match(method: string, url: string): { handler: RequestHandler; params: RouteParams } | null {
    // Strip query string
    const pathname = url.split('?')[0];
    const methodUpper = method.toUpperCase();

    for (const route of this.routes) {
      if (route.method !== methodUpper) continue;
      const match = pathname.match(route.pattern);
      if (match) {
        const params: RouteParams = {};
        route.paramNames.forEach((name, i) => {
          params[name] = decodeURIComponent(match[i + 1]);
        });
        return { handler: route.handler, params };
      }
    }
    return null;
  }
}
