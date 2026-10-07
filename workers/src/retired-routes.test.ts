/**
 * Routes retired in the 2.1 route matrix stay unserved.
 *
 * The legacy-auth set (`/api/auth/login`, `/api/auth/register`, `GET /api/users/me`,
 * `PUT /api/users/:id/reset-pin`) has no frontend caller: the app signs in through Clerk. The
 * login and register pair minted tokens no data route accepts and wrote unauthenticated users into
 * the oldest organization (#560); `reset-pin` only ever answered 410. Pinning the absence means
 * a future route that reuses one of these paths is a visible decision, not an accident.
 */
import { describe, expect, it } from 'vitest';
import { resolveMinimalApiRoute, type MinimalApiRoute } from './minimal-api-routes';
import * as minimalEntrypoint from './index-minimal';
import type { Database } from './database';
import type { Env } from './types/env';

function routes(): MinimalApiRoute[] {
  return (minimalEntrypoint as typeof minimalEntrypoint & { MINIMAL_API_ROUTES: MinimalApiRoute[] })
    .MINIMAL_API_ROUTES;
}

describe('retired legacy-auth routes', () => {
  it.each([
    ['POST', '/api/auth/login'],
    ['POST', '/api/auth/register'],
    ['GET', '/api/users/me'],
    ['PUT', '/api/users/5/reset-pin'],
  ])('%s %s is not served', async (method, pathname) => {
    const response = await resolveMinimalApiRoute(routes(), {
      request: new Request(`https://example.com${pathname}`, { method }),
      pathname,
      method,
      db: {} as Database,
      env: {} as Env,
    });

    expect(response).toBeNull();
  });
});
