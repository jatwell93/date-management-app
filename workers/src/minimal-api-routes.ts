import type { Database } from './database';
import type { Env } from './types/env';

type StaticApiHandler = (request: Request, db: Database, env: Env) => Promise<Response>;
type PathApiHandler = (
  request: Request,
  db: Database,
  env: Env,
  pathname: string,
) => Promise<Response>;
type BootstrapApiHandler = (request: Request, env: Env) => Promise<Response>;

/**
 * A route is a compact tuple of `[method, match, handler, kind?]`.
 *
 * `match` is an exact pathname string or a RegExp. The handler reference is
 * stored directly (no string indirection or injected handler map) to keep the
 * Worker bundle small. `kind` defaults to `'static'` — the most common shape —
 * so the discriminator is only written for `'path'` and `'bootstrap'` routes.
 */
export type MinimalApiRoute =
  | [method: string, match: string | RegExp, handler: StaticApiHandler]
  | [method: string, match: string | RegExp, handler: PathApiHandler, kind: 'path']
  | [method: string, match: string | RegExp, handler: BootstrapApiHandler, kind: 'bootstrap'];

type MinimalApiRouteContext = {
  request: Request;
  pathname: string;
  method: string;
  db: Database;
  env: Env;
};

function matches(match: string | RegExp, pathname: string): boolean {
  return typeof match === 'string' ? match === pathname : match.test(pathname);
}

export function resolveMinimalApiRoute(
  routes: readonly MinimalApiRoute[],
  { request, pathname, method, db, env }: MinimalApiRouteContext,
): Promise<Response> | null {
  for (const [routeMethod, match, handler, kind] of routes) {
    if (routeMethod !== method || !matches(match, pathname)) {
      continue;
    }

    if (kind === 'bootstrap') {
      return (handler as BootstrapApiHandler)(request, env);
    }
    if (kind === 'path') {
      return (handler as PathApiHandler)(request, db, env, pathname);
    }
    return (handler as StaticApiHandler)(request, db, env);
  }

  return null;
}
