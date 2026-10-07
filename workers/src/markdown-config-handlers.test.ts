/**
 * `GET` and `PUT /api/markdown-config` (task 3.2, batch 6).
 *
 * Express tested the markdown matrix as a service (`markdown-config.service.test.ts`) and its
 * schema (`markdown-config-schema.test.ts`). The Worker reads and validates in the handler, so
 * these tests drive the real routes with a stubbed database and pin the gaps the existing
 * `minimal-api-routes.test.ts` cases leave: a stored record read back into a matrix, each
 * credit scope defaulting on its own, the retail-basis rule, and the band-ordering rule on a
 * scoped save.
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

/** User 7, an admin of `org_123`; `config` and `retail` answer the two markdown reads. */
function database(config: Array<Record<string, unknown>>, retail: Array<Record<string, unknown>>) {
  const queries: string[] = [];
  const db = {
    sql: vi.fn((strings: TemplateStringsArray) => {
      const query = strings.join(' ');
      queries.push(query);
      if (query.includes('FROM users')) {
        return Promise.resolve([{ id: 7, organizationId: 'org_123', role: 'admin' }]);
      }
      if (query.includes('FROM organization_markdown_config')) return Promise.resolve(config);
      if (query.includes('FROM products')) return Promise.resolve(retail);
      return Promise.resolve([]);
    }),
  } as unknown as Database;
  return { db, queries };
}

function send(method: string, body: unknown, db: Database) {
  return resolveMinimalApiRoute(routes(), {
    request: new Request('https://example.com/api/markdown-config', {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    pathname: '/api/markdown-config',
    method,
    db,
    env: {} as Env,
  });
}

const band = (percentage: number, basis: 'cost' | 'retail' = 'cost') => ({ percentage, basis });
const matrix = (a: number, b: number, c: number, basis: 'cost' | 'retail' = 'cost') => ({
  band1: band(a, basis),
  band2: band(b, basis),
  band3: band(c, basis),
});

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

describe('GET /api/markdown-config', () => {
  it('reads a stored record into a matrix, with each band percentage and basis', async () => {
    const { db } = database(
      [
        {
          credit_scope: 'NO_CREDIT',
          band1_percentage: '12.5',
          band2_percentage: 30,
          band3_percentage: '45',
          band1_basis: 'retail',
          band2_basis: 'cost',
          band3_basis: 'retail',
        },
      ],
      [{ id: 1 }],
    );

    const body = (await (await send('GET', undefined, db))?.json()) as Record<string, any>;

    expect(body.matrices.NO_CREDIT).toEqual({
      band1: { percentage: 12.5, basis: 'retail' },
      band2: { percentage: 30, basis: 'cost' },
      band3: { percentage: 45, basis: 'retail' },
    });
    expect(body.matrix).toEqual(body.matrices.NO_CREDIT);
    expect(body.hasRetailData).toBe(true);
  });

  it('defaults each credit scope on its own when only one is stored', async () => {
    const { db } = database(
      [
        {
          credit_scope: 'FULL_CREDIT',
          band1_percentage: 5,
          band2_percentage: 6,
          band3_percentage: 7,
          band1_basis: 'cost',
          band2_basis: 'cost',
          band3_basis: 'cost',
        },
      ],
      [],
    );

    const body = (await (await send('GET', undefined, db))?.json()) as Record<string, any>;

    expect(body.matrices.FULL_CREDIT).toEqual(matrix(5, 6, 7));
    // The scope that is not stored keeps its own default, not the stored scope's values.
    expect(body.matrices.NO_CREDIT).toEqual(matrix(50, 60, 75));
  });
});

describe('PUT /api/markdown-config', () => {
  it('refuses a retail-basis band when the organization has no retail prices', async () => {
    const { db, queries } = database([], []);

    const response = await send('PUT', matrix(10, 20, 30, 'retail'), db);

    expect(response?.status).toBe(400);
    expect(await response?.json()).toMatchObject({
      error: expect.stringContaining('Retail-based markdowns require retail prices'),
    });
    expect(
      queries.some((query) => query.includes('INSERT INTO organization_markdown_config')),
    ).toBe(false);
  });

  it('saves a cost-only matrix even when the organization has no retail prices', async () => {
    const { db, queries } = database([], []);

    const response = await send('PUT', matrix(10, 20, 30), db);

    expect(response?.status).toBe(200);
    expect(
      queries.some((query) => query.includes('INSERT INTO organization_markdown_config')),
    ).toBe(true);
  });

  it.each([
    ['NO_CREDIT', { NO_CREDIT: matrix(60, 40, 70), FULL_CREDIT: matrix(10, 20, 30) }],
    ['FULL_CREDIT', { NO_CREDIT: matrix(10, 20, 30), FULL_CREDIT: matrix(10, 50, 30) }],
  ])('refuses a scoped save whose %s bands decrease as expiry nears', async (scope, matrices) => {
    const { db, queries } = database([], []);

    const response = await send('PUT', { matrices }, db);

    expect(response?.status).toBe(400);
    const body = (await response?.json()) as { error: string };
    expect(body.error.startsWith(`${scope}: Discounts must not decrease`)).toBe(true);
    expect(
      queries.some((query) => query.includes('INSERT INTO organization_markdown_config')),
    ).toBe(false);
  });
});
