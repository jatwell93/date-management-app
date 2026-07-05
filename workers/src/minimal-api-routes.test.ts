import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resolveBootstrapApiRoute,
  resolveMinimalApiRoute,
  type MinimalApiRoute,
} from './minimal-api-routes';
import * as minimalEntrypoint from './index-minimal';
import { authenticateClerkRequest } from './clerk/bootstrap-handler';
import type { Database } from './database';
import type { Env } from './types/env';

vi.mock('./clerk/bootstrap-handler', () => ({
  authenticateClerkRequest: vi.fn(),
  getClerkAuthorizedParties: vi.fn(() => []),
  handleOrganizationBootstrap: vi.fn().mockResolvedValue(new Response('bootstrap')),
}));

const env = {} as Env;
const db = {} as Database;
const mockedAuthenticateClerkRequest = vi.mocked(authenticateClerkRequest);
const authenticatedClerkOrgContext = {
  clerkUserId: 'user_clerk_123',
  email: 'user@example.com',
  username: 'user',
  organizationId: 'org_123',
  organizationRole: 'org:admin',
};

function getMinimalRoutes(): MinimalApiRoute[] {
  return (
    minimalEntrypoint as typeof minimalEntrypoint & {
      MINIMAL_API_ROUTES?: MinimalApiRoute[];
    }
  ).MINIMAL_API_ROUTES!;
}

function createAuthenticatedOrgDatabase(tableRowsByQueryText: Record<string, unknown[]>): Database {
  return {
    sql: vi.fn((strings: TemplateStringsArray) => {
      const query = strings.join(' ');

      if (query.includes('FROM users')) {
        return Promise.resolve([{ id: 7, organizationId: 'org_123', role: 'admin' }]);
      }

      const matchingRows = Object.entries(tableRowsByQueryText).find(([queryText]) =>
        query.includes(queryText),
      )?.[1];

      return Promise.resolve(matchingRows ?? []);
    }),
  } as unknown as Database;
}

function resolveMinimalGet(pathname: string, database: Database = db) {
  return resolveMinimalApiRoute(getMinimalRoutes(), {
    request: new Request(`https://example.com${pathname}`),
    pathname,
    method: 'GET',
    db: database,
    env,
  });
}

describe('minimal API route table', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dispatches static API routes by method and pathname', async () => {
    const handleGetProducts = vi.fn().mockResolvedValue(new Response('products'));
    const routes: MinimalApiRoute[] = [['GET', '/api/products', handleGetProducts]];

    const response = await resolveMinimalApiRoute(routes, {
      request: new Request('https://example.com/api/products'),
      pathname: '/api/products',
      method: 'GET',
      db,
      env,
    });

    expect(response?.status).toBe(200);
    expect(handleGetProducts).toHaveBeenCalledWith(expect.any(Request), db, env);
  });

  it('passes dynamic pathnames to matching handlers', async () => {
    const handleUpdateInventoryItem = vi.fn().mockResolvedValue(new Response('inventory'));
    const routes: MinimalApiRoute[] = [
      ['PUT', /^\/api\/inventory-items\/\d+$/, handleUpdateInventoryItem, 'path'],
    ];

    const response = await resolveMinimalApiRoute(routes, {
      request: new Request('https://example.com/api/inventory-items/42', { method: 'PUT' }),
      pathname: '/api/inventory-items/42',
      method: 'PUT',
      db,
      env,
    });

    expect(response?.status).toBe(200);
    expect(handleUpdateInventoryItem).toHaveBeenCalledWith(
      expect.any(Request),
      db,
      env,
      '/api/inventory-items/42',
    );
  });

  it('returns null for unknown routes', async () => {
    const routes: MinimalApiRoute[] = [['GET', '/api/products', vi.fn()]];

    const response = await resolveMinimalApiRoute(routes, {
      request: new Request('https://example.com/api/nope'),
      pathname: '/api/nope',
      method: 'GET',
      db,
      env,
    });

    expect(response).toBeNull();
  });

  it('dispatches bootstrap routes without requiring a database instance', async () => {
    const handleBootstrap = vi.fn().mockResolvedValue(new Response('bootstrap'));
    const routes: MinimalApiRoute[] = [
      ['POST', '/api/organization/bootstrap', handleBootstrap, 'bootstrap'],
      ['GET', '/api/products', vi.fn()],
    ];

    const response = await resolveBootstrapApiRoute(routes, {
      request: new Request('https://example.com/api/organization/bootstrap', { method: 'POST' }),
      pathname: '/api/organization/bootstrap',
      method: 'POST',
      env,
    });

    expect(response?.status).toBe(200);
    expect(handleBootstrap).toHaveBeenCalledWith(expect.any(Request), env);
  });

  it('registers the expired-loss report route used by the frontend', () => {
    const routes = getMinimalRoutes();

    expect(routes).toEqual(
      expect.arrayContaining([
        expect.arrayContaining(['GET', '/api/expired-items/reports/expired-losses']),
      ]),
    );
  });

  it('registers subscription settings routes used by the frontend', () => {
    expect(getMinimalRoutes()).toEqual(
      expect.arrayContaining([
        expect.arrayContaining(['GET', '/api/subscription/current']),
        expect.arrayContaining(['GET', '/api/organization/usage']),
      ]),
    );
  });

  it('returns current subscription details for an authenticated organization', async () => {
    mockedAuthenticateClerkRequest.mockResolvedValue(authenticatedClerkOrgContext);
    const dbWithRows = createAuthenticatedOrgDatabase({
      'FROM subscription_tiers': [
        {
          tier_level: 'professional',
          status: 'active',
          billing_cycle: 'annual',
          trial_end_date: '2026-08-01T00:00:00.000Z',
        },
      ],
    });

    const response = await resolveMinimalGet('/api/subscription/current', dbWithRows);

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual({
      tierLevel: 'professional',
      status: 'active',
      billingCycle: 'annual',
      currentPeriodEnd: '2026-08-01T00:00:00.000Z',
    });
  });

  it('returns organization usage for an authenticated organization', async () => {
    mockedAuthenticateClerkRequest.mockResolvedValue(authenticatedClerkOrgContext);
    const dbWithRows = createAuthenticatedOrgDatabase({
      'FROM organization_usage': [
        {
          total_skus: 42,
          active_users: 3,
          storage_used_bytes: 4096,
          total_inventory_items: 84,
        },
      ],
    });

    const response = await resolveMinimalGet('/api/organization/usage', dbWithRows);

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual({
      skus: 42,
      users: 3,
      storage: 4096,
      inventoryItems: 84,
    });
  });

  it('creates default organization usage with production-required timestamps', async () => {
    mockedAuthenticateClerkRequest.mockResolvedValue(authenticatedClerkOrgContext);
    const dbWithRows = createAuthenticatedOrgDatabase({
      'FROM organization_usage': [],
    });

    const response = await resolveMinimalGet('/api/organization/usage', dbWithRows);

    expect(response?.status).toBe(200);
    const sqlCalls = vi.mocked(dbWithRows.sql).mock.calls.map(([strings]) => strings.join(' '));
    const insertUsageQuery = sqlCalls.find((query) =>
      query.includes('INSERT INTO organization_usage'),
    );

    expect(insertUsageQuery).toContain('created_at');
    expect(insertUsageQuery).toContain('updated_at');
    expect(insertUsageQuery).toContain('NOW()');
  });
  it.each(['/api/subscription/current', '/api/organization/usage'])(
    'dispatches %s to auth instead of returning route-not-found',
    async (pathname) => {
      mockedAuthenticateClerkRequest.mockResolvedValue(
        new Response('Unauthorized', { status: 401 }),
      );
      const response = await resolveMinimalApiRoute(getMinimalRoutes(), {
        request: new Request(`https://example.com${pathname}`),
        pathname,
        method: 'GET',
        db,
        env,
      });

      expect(response).not.toBeNull();
      expect(response?.status).toBe(401);
    },
  );
});
