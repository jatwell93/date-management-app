/**
 * Report route handlers (task 3.2, batch 6).
 *
 * Express tested these through `report.routes.test.ts` with a stubbed service. The Worker
 * handlers authenticate, pass the organization (and one query parameter) to the database layer
 * and return its answer, so these tests pin that hand-off. The SQL is covered with real data in
 * `database.rehomed-reads.pglite.node.test.ts` and `database.report.pglite.node.test.ts`; a
 * failing read becomes a 500 in `unhandled-error-response.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveMinimalApiRoute, type MinimalApiRoute } from './minimal-api-routes';
import * as minimalEntrypoint from './index-minimal';
import { authenticateClerkRequest } from './clerk/bootstrap-handler';
import type { Database } from './database';
import type { Env } from './types/env';

vi.mock('./clerk/bootstrap-handler', () => ({
  authenticateClerkRequest: vi.fn(),
  getClerkAuthorizedParties: vi.fn(() => []),
  handleOrganizationBootstrap: vi.fn().mockResolvedValue(new Response('bootstrap')),
}));

const mockedAuthenticateClerkRequest = vi.mocked(authenticateClerkRequest);

function routes(): MinimalApiRoute[] {
  return (minimalEntrypoint as typeof minimalEntrypoint & { MINIMAL_API_ROUTES: MinimalApiRoute[] })
    .MINIMAL_API_ROUTES;
}

function database(methods: Partial<Record<keyof Database, unknown>>): Database {
  return {
    ...methods,
    sql: vi.fn((strings: TemplateStringsArray) =>
      strings.join('').includes('FROM users')
        ? Promise.resolve([{ id: 7, organizationId: 'org_123', role: 'admin' }])
        : Promise.resolve([]),
    ),
  } as unknown as Database;
}

function get(pathAndQuery: string, db: Database) {
  return resolveMinimalApiRoute(routes(), {
    request: new Request(`https://example.com${pathAndQuery}`),
    pathname: pathAndQuery.split('?')[0],
    method: 'GET',
    db,
    env: {} as Env,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedAuthenticateClerkRequest.mockResolvedValue({
    clerkUserId: 'user_clerk_123',
    email: 'user@example.com',
    username: 'user',
    organizationId: 'org_123',
    organizationRole: 'org:admin',
  });
});

describe('GET /api/reports/items-by-user', () => {
  it.each([
    ['?timeFrame=30', '30'],
    ['?timeFrame=all-time', 'all-time'],
    ['', undefined],
  ])('with the query %j passes the time frame %j to the report', async (query, timeFrame) => {
    const rows = [{ userId: 7, userName: 'user', itemCount: 3 }];
    const getItemsByUserReport = vi.fn().mockResolvedValue(rows);

    const response = await get(
      `/api/reports/items-by-user${query}`,
      database({ getItemsByUserReport }),
    );

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual(rows);
    expect(getItemsByUserReport).toHaveBeenCalledWith('org_123', timeFrame);
  });
});

describe('GET /api/reports/items-by-user with an invalid time frame', () => {
  it.each(['0', '-7', 'abc', '1.5', '30days'])(
    'answers 400 for %j without reading',
    async (timeFrame) => {
      const getItemsByUserReport = vi.fn();

      const response = await get(
        `/api/reports/items-by-user?timeFrame=${timeFrame}`,
        database({ getItemsByUserReport }),
      );

      expect(response?.status).toBe(400);
      expect(getItemsByUserReport).not.toHaveBeenCalled();
    },
  );
});

describe.each([
  ['/api/reports/expiry-overall', 'getOverallExpiryReport'],
  ['/api/reports/loss-by-department', 'getLossByDepartmentReport'],
  ['/api/reports/items-by-date', 'getItemsByDateReport'],
])('GET %s', (path, method) => {
  it('returns what the database produced for the caller organization', async () => {
    const payload = [{ marker: path }];
    const read = vi.fn().mockResolvedValue(payload);

    const response = await get(path, database({ [method]: read }));

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual(payload);
    expect(read).toHaveBeenCalledWith('org_123');
  });
});
