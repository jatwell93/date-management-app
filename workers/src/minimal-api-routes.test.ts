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
        expect.arrayContaining(['GET', '/api/reports/store-walk-audit']),
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

  it('registers store walk tracking routes under store areas', () => {
    expect(getMinimalRoutes()).toEqual(
      expect.arrayContaining([
        expect.arrayContaining(['GET', '/api/store-areas/check-cycles']),
        expect.arrayContaining(['POST', '/api/store-areas/check-cycles']),
        expect.arrayContaining(['POST', /^\/api\/store-areas\/check-cycles\/\d+\/complete$/]),
        expect.arrayContaining(['POST', '/api/store-areas/bay-checks']),
        expect.arrayContaining(['GET', '/api/store-areas/floor-progress']),
      ]),
    );
  });

  it('creates, completes, records, and reads store walk tracking from authenticated org context', async () => {
    mockedAuthenticateClerkRequest.mockResolvedValue(authenticatedClerkOrgContext);
    const dbWithStoreWalk = {
      sql: vi.fn((strings: TemplateStringsArray) => {
        const query = strings.join(' ');
        if (query.includes('FROM users')) {
          return Promise.resolve([{ id: 7, organizationId: 'org_123', role: 'admin' }]);
        }
        return Promise.resolve([]);
      }),
      createCheckCycle: vi.fn().mockResolvedValue({ id: 11, name: 'Morning walk' }),
      completeCheckCycle: vi.fn().mockResolvedValue({ id: 11, status: 'completed' }),
      recordBayCheck: vi.fn().mockResolvedValue({ id: 22, storeAreaId: 5 }),
      getFloorProgress: vi.fn().mockResolvedValue({ activeCycle: { id: 11 }, departments: [] }),
    } as unknown as Database;

    const createCycle = await resolveMinimalApiRoute(getMinimalRoutes(), {
      request: new Request('https://example.com/api/store-areas/check-cycles', {
        method: 'POST',
        body: JSON.stringify({ name: 'Morning walk' }),
      }),
      pathname: '/api/store-areas/check-cycles',
      method: 'POST',
      db: dbWithStoreWalk,
      env,
    });
    const completeCycle = await resolveMinimalApiRoute(getMinimalRoutes(), {
      request: new Request('https://example.com/api/store-areas/check-cycles/11/complete', {
        method: 'POST',
      }),
      pathname: '/api/store-areas/check-cycles/11/complete',
      method: 'POST',
      db: dbWithStoreWalk,
      env,
    });
    const recordCheck = await resolveMinimalApiRoute(getMinimalRoutes(), {
      request: new Request('https://example.com/api/store-areas/bay-checks', {
        method: 'POST',
        body: JSON.stringify({ storeAreaId: 5, itemsAddedCount: 2 }),
      }),
      pathname: '/api/store-areas/bay-checks',
      method: 'POST',
      db: dbWithStoreWalk,
      env,
    });
    const progress = await resolveMinimalGet('/api/store-areas/floor-progress', dbWithStoreWalk);

    expect(createCycle?.status).toBe(201);
    expect(completeCycle?.status).toBe(200);
    expect(recordCheck?.status).toBe(201);
    expect(progress?.status).toBe(200);
    expect(dbWithStoreWalk.createCheckCycle).toHaveBeenCalledWith('org_123', {
      name: 'Morning walk',
      startedAt: undefined,
    });
    expect(dbWithStoreWalk.completeCheckCycle).toHaveBeenCalledWith('org_123', 11);
    expect(dbWithStoreWalk.recordBayCheck).toHaveBeenCalledWith('org_123', 7, {
      storeAreaId: 5,
      checkedAt: undefined,
      itemsAddedCount: 2,
      notes: undefined,
    });
    expect(dbWithStoreWalk.getFloorProgress).toHaveBeenCalledWith('org_123');
  });

  it('returns the default markdown matrix for an authenticated organization', async () => {
    mockedAuthenticateClerkRequest.mockResolvedValue(authenticatedClerkOrgContext);
    const dbWithRows = createAuthenticatedOrgDatabase({
      'FROM organization_markdown_config': [],
      'FROM products': [],
    });

    const response = await resolveMinimalGet('/api/markdown-config', dbWithRows);

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual({
      matrix: {
        band1: { percentage: 50, basis: 'cost' },
        band2: { percentage: 60, basis: 'cost' },
        band3: { percentage: 75, basis: 'cost' },
      },
      hasRetailData: false,
    });
  });

  it('persists a valid markdown matrix for organization admins', async () => {
    mockedAuthenticateClerkRequest.mockResolvedValue(authenticatedClerkOrgContext);
    const dbWithRows = createAuthenticatedOrgDatabase({
      'FROM products': [{ id: 1 }],
      'INSERT INTO organization_markdown_config': [
        {
          band1_percentage: 40,
          band2_percentage: 55,
          band3_percentage: 80,
          band1_basis: 'retail',
          band2_basis: 'cost',
          band3_basis: 'retail',
        },
      ],
    });

    const response = await resolveMinimalApiRoute(getMinimalRoutes(), {
      request: new Request('https://example.com/api/markdown-config', {
        method: 'PUT',
        body: JSON.stringify({
          band1: { percentage: 40, basis: 'retail' },
          band2: { percentage: 55, basis: 'cost' },
          band3: { percentage: 80, basis: 'retail' },
        }),
      }),
      pathname: '/api/markdown-config',
      method: 'PUT',
      db: dbWithRows,
      env,
    });

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual({
      matrix: {
        band1: { percentage: 40, basis: 'retail' },
        band2: { percentage: 55, basis: 'cost' },
        band3: { percentage: 80, basis: 'retail' },
      },
      hasRetailData: true,
    });
  });

  it('degrades to the default matrix when the markdown schema is not yet migrated', async () => {
    mockedAuthenticateClerkRequest.mockResolvedValue(authenticatedClerkOrgContext);
    // Simulate Neon migration 0003 not applied: the config table and
    // products.retail_price column are missing (undefined_table / undefined_column).
    const dbMissingSchema = {
      sql: vi.fn((strings: TemplateStringsArray) => {
        const query = strings.join(' ');
        if (query.includes('FROM users')) {
          return Promise.resolve([{ id: 7, organizationId: 'org_123', role: 'admin' }]);
        }
        if (query.includes('organization_markdown_config')) {
          return Promise.reject(
            Object.assign(new Error('relation "organization_markdown_config" does not exist'), {
              code: '42P01',
            }),
          );
        }
        if (query.includes('retail_price')) {
          return Promise.reject(
            Object.assign(new Error('column "retail_price" does not exist'), { code: '42703' }),
          );
        }
        return Promise.resolve([]);
      }),
    } as unknown as Database;

    const response = await resolveMinimalGet('/api/markdown-config', dbMissingSchema);

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual({
      matrix: {
        band1: { percentage: 50, basis: 'cost' },
        band2: { percentage: 60, basis: 'cost' },
        band3: { percentage: 75, basis: 'cost' },
      },
      hasRetailData: false,
    });
  });

  it('returns an actionable 503 when saving before the markdown schema is migrated', async () => {
    mockedAuthenticateClerkRequest.mockResolvedValue(authenticatedClerkOrgContext);
    const dbMissingSchema = {
      sql: vi.fn((strings: TemplateStringsArray) => {
        const query = strings.join(' ');
        if (query.includes('FROM users')) {
          return Promise.resolve([{ id: 7, organizationId: 'org_123', role: 'admin' }]);
        }
        if (query.includes('organization_markdown_config') || query.includes('retail_price')) {
          return Promise.reject(
            Object.assign(new Error('relation "organization_markdown_config" does not exist'), {
              code: '42P01',
            }),
          );
        }
        return Promise.resolve([]);
      }),
    } as unknown as Database;

    const response = await resolveMinimalApiRoute(getMinimalRoutes(), {
      request: new Request('https://example.com/api/markdown-config', {
        method: 'PUT',
        body: JSON.stringify({
          band1: { percentage: 50, basis: 'cost' },
          band2: { percentage: 60, basis: 'cost' },
          band3: { percentage: 75, basis: 'cost' },
        }),
      }),
      pathname: '/api/markdown-config',
      method: 'PUT',
      db: dbMissingSchema,
      env,
    });

    expect(response?.status).toBe(503);
  });

  it('returns a 503 (not a misleading 400) when saving retail bands before the retail column exists', async () => {
    mockedAuthenticateClerkRequest.mockResolvedValue(authenticatedClerkOrgContext);
    // products.retail_price missing (migration 0003 not applied). A retail-based
    // save must surface as a 503 "migration not applied", not a 400 telling the
    // admin to upload retail prices (which would be unactionable).
    const dbMissingRetailColumn = {
      sql: vi.fn((strings: TemplateStringsArray) => {
        const query = strings.join(' ');
        if (query.includes('FROM users')) {
          return Promise.resolve([{ id: 7, organizationId: 'org_123', role: 'admin' }]);
        }
        if (query.includes('retail_price')) {
          return Promise.reject(
            Object.assign(new Error('column "retail_price" does not exist'), { code: '42703' }),
          );
        }
        return Promise.resolve([]);
      }),
    } as unknown as Database;

    const response = await resolveMinimalApiRoute(getMinimalRoutes(), {
      request: new Request('https://example.com/api/markdown-config', {
        method: 'PUT',
        body: JSON.stringify({
          band1: { percentage: 40, basis: 'retail' },
          band2: { percentage: 55, basis: 'cost' },
          band3: { percentage: 80, basis: 'retail' },
        }),
      }),
      pathname: '/api/markdown-config',
      method: 'PUT',
      db: dbMissingRetailColumn,
      env,
    });

    expect(response?.status).toBe(503);
  });

  it('returns current subscription details for an authenticated organization', async () => {
    mockedAuthenticateClerkRequest.mockResolvedValue(authenticatedClerkOrgContext);
    const dbWithRows = createAuthenticatedOrgDatabase({
      'FROM subscription_tiers': [
        {
          tier_level: 'professional',
          status: 'active',
          billing_cycle: 'annual',
          current_period_end: '2026-08-01T00:00:00.000Z',
          cancel_at_period_end: false,
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
      cancelAtPeriodEnd: false,
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
          max_skus: 5000,
          max_users: 3,
          max_inventory_items: 5000,
        },
      ],
      'FROM subscription_tiers': [{ tier_level: 'starter' }],
    });

    const response = await resolveMinimalGet('/api/organization/usage', dbWithRows);

    expect(response?.status).toBe(200);
    // The frontend ProgressBar consumes a nested { current, limit } shape;
    // a flat number here is what crashed SubscriptionDashboard in production.
    await expect(response?.json()).resolves.toEqual({
      skus: { current: 42, limit: 5000 },
      users: { current: 3, limit: 3 },
      storage: { current: 4096, limit: 10 * 1024 * 1024 * 1024 },
      inventoryItems: { current: 84, limit: 5000 },
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
