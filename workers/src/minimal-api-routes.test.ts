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
import { UNLIMITED_CAP } from './utils/usage-limits';

vi.mock('./clerk/bootstrap-handler', () => ({
  authenticateClerkRequest: vi.fn(),
  getClerkAuthorizedParties: vi.fn(() => []),
  handleOrganizationBootstrap: vi.fn().mockResolvedValue(new Response('bootstrap')),
}));

// The bare env is the deployed default: USAGE_LIMITS_ENFORCE unset, so limits
// are measured and logged but not enforced (workers/src/utils/usage-limits.ts).
const env = {} as Env;
const enforcingEnv = { USAGE_LIMITS_ENFORCE: 'true' } as Env;
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

function createAuthenticatedOrgDatabase(
  tableRowsByQueryText: Record<string, unknown[]>,
  methodOverrides: Partial<Record<keyof Database, unknown>> = {},
): Database {
  return {
    ...methodOverrides,
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

function resolveMinimalGet(pathname: string, database: Database = db, requestPath = pathname) {
  return resolveMinimalApiRoute(getMinimalRoutes(), {
    request: new Request(`https://example.com${requestPath}`),
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

  it('registers supplier credit brand review, correction, and disposal routes', () => {
    expect(getMinimalRoutes()).toEqual(
      expect.arrayContaining([
        expect.arrayContaining(['GET', '/api/supplier-credits/suppliers']),
        expect.arrayContaining(['POST', '/api/supplier-credits/suppliers']),
        expect.arrayContaining(['PUT', /^\/api\/supplier-credits\/suppliers\/\d+$/]),
        expect.arrayContaining(['PATCH', /^\/api\/supplier-credits\/suppliers\/\d+$/]),
        expect.arrayContaining(['DELETE', /^\/api\/supplier-credits\/suppliers\/\d+\/policy$/]),
        expect.arrayContaining(['GET', '/api/supplier-credits/policy-review']),
        expect.arrayContaining(['POST', '/api/supplier-credits/policy-review/bulk-attach']),
        expect.arrayContaining(['POST', '/api/supplier-credits/brands/bulk-link']),
        expect.arrayContaining(['GET', '/api/supplier-credits/brands']),
        expect.arrayContaining(['GET', '/api/supplier-credits/brand-review']),
        expect.arrayContaining(['POST', '/api/supplier-credits/brands']),
        expect.arrayContaining(['PUT', /^\/api\/supplier-credits\/brands\/\d+\/supplier$/]),
        expect.arrayContaining(['PUT', /^\/api\/supplier-credits\/products\/\d+\/supplier$/]),
        expect.arrayContaining(['POST', /^\/api\/supplier-credits\/claimable-pool\/\d+\/dispose$/]),
        expect.arrayContaining(['GET', '/api/supplier-credits/claimable-pool']),
        expect.arrayContaining(['GET', '/api/supplier-credits/recovery-report']),
        expect.arrayContaining(['GET', '/api/supplier-credits/claims']),
        expect.arrayContaining(['GET', '/api/platform/catalogue-corrections']),
        expect.arrayContaining(['PATCH', /^\/api\/platform\/catalogue-corrections\/\d+$/]),
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
      matrices: {
        NO_CREDIT: {
          band1: { percentage: 50, basis: 'cost' },
          band2: { percentage: 60, basis: 'cost' },
          band3: { percentage: 75, basis: 'cost' },
        },
        FULL_CREDIT: {
          band1: { percentage: 20, basis: 'cost' },
          band2: { percentage: 20, basis: 'cost' },
          band3: { percentage: 20, basis: 'cost' },
        },
      },
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
      matrices: {
        NO_CREDIT: {
          band1: { percentage: 40, basis: 'retail' },
          band2: { percentage: 55, basis: 'cost' },
          band3: { percentage: 80, basis: 'retail' },
        },
        FULL_CREDIT: {
          band1: { percentage: 20, basis: 'cost' },
          band2: { percentage: 20, basis: 'cost' },
          band3: { percentage: 20, basis: 'cost' },
        },
      },
      matrix: {
        band1: { percentage: 40, basis: 'retail' },
        band2: { percentage: 55, basis: 'cost' },
        band3: { percentage: 80, basis: 'retail' },
      },
      hasRetailData: true,
    });
  });

  it('persists both scoped matrices with one atomic upsert statement', async () => {
    mockedAuthenticateClerkRequest.mockResolvedValue(authenticatedClerkOrgContext);
    const queries: string[] = [];
    const database = {
      sql: vi.fn((strings: TemplateStringsArray) => {
        const query = strings.join(' ');
        queries.push(query);
        if (query.includes('FROM users')) {
          return Promise.resolve([{ id: 7, organizationId: 'org_123', role: 'admin' }]);
        }
        if (query.includes('FROM products')) return Promise.resolve([]);
        return Promise.resolve([]);
      }),
    } as unknown as Database;
    const NO_CREDIT = {
      band1: { percentage: 50, basis: 'cost' },
      band2: { percentage: 60, basis: 'cost' },
      band3: { percentage: 75, basis: 'cost' },
    };
    const FULL_CREDIT = {
      band1: { percentage: 10, basis: 'cost' },
      band2: { percentage: 20, basis: 'cost' },
      band3: { percentage: 30, basis: 'cost' },
    };

    const response = await resolveMinimalApiRoute(getMinimalRoutes(), {
      request: new Request('https://example.com/api/markdown-config', {
        method: 'PUT',
        body: JSON.stringify({ matrices: { NO_CREDIT, FULL_CREDIT } }),
      }),
      pathname: '/api/markdown-config',
      method: 'PUT',
      db: database,
      env,
    });

    expect(response?.status).toBe(200);
    expect(
      queries.filter((query) => query.includes('INSERT INTO organization_markdown_config')),
    ).toHaveLength(1);
    expect(
      queries.find((query) => query.includes('INSERT INTO organization_markdown_config')),
    ).toContain('ON CONFLICT (organization_id, credit_scope)');
    await expect(response?.json()).resolves.toMatchObject({
      matrices: { NO_CREDIT, FULL_CREDIT },
      matrix: NO_CREDIT,
    });
  });

  it.each([null, '', '50'])('rejects non-numeric markdown percentages (%j)', async (percentage) => {
    mockedAuthenticateClerkRequest.mockResolvedValue(authenticatedClerkOrgContext);
    const database = createAuthenticatedOrgDatabase({});

    const response = await resolveMinimalApiRoute(getMinimalRoutes(), {
      request: new Request('https://example.com/api/markdown-config', {
        method: 'PUT',
        body: JSON.stringify({
          band1: { percentage, basis: 'cost' },
          band2: { percentage: 60, basis: 'cost' },
          band3: { percentage: 75, basis: 'cost' },
        }),
      }),
      pathname: '/api/markdown-config',
      method: 'PUT',
      db: database,
      env,
    });

    expect(response?.status).toBe(400);
    expect(database.sql).not.toHaveBeenCalledWith(
      expect.arrayContaining([expect.stringContaining('INSERT INTO organization_markdown_config')]),
    );
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
      matrices: {
        NO_CREDIT: {
          band1: { percentage: 50, basis: 'cost' },
          band2: { percentage: 60, basis: 'cost' },
          band3: { percentage: 75, basis: 'cost' },
        },
        FULL_CREDIT: {
          band1: { percentage: 20, basis: 'cost' },
          band2: { percentage: 20, basis: 'cost' },
          band3: { percentage: 20, basis: 'cost' },
        },
      },
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
    // The organization_usage row below is deliberately populated AND
    // deliberately wrong. Before task 3.1.a this endpoint reported those
    // columns verbatim; in production they are written once as literal zeros
    // and never maintained, so every organization saw 0 of its limit. Seeding
    // contradictory values here means the assertion fails if anything ever
    // reads the columns again instead of counting.
    const dbWithRows = createAuthenticatedOrgDatabase(
      {
        'FROM organization_usage': [
          {
            total_skus: 999999,
            active_users: 999999,
            storage_used_bytes: 999999,
            total_inventory_items: 999999,
            max_skus: 1,
            max_users: 1,
            max_inventory_items: 1,
          },
        ],
        'FROM subscription_tiers': [{ tier_level: 'starter' }],
      },
      {
        getUsageCounts: vi.fn().mockResolvedValue({ skus: 42, users: 3, activeExpiries: 84 }),
        getStorageUsedBytes: vi.fn().mockResolvedValue(4096),
      },
    );

    const response = await resolveMinimalGet('/api/organization/usage', dbWithRows);

    expect(response?.status).toBe(200);
    // The frontend ProgressBar consumes a nested { current, limit } shape;
    // a flat number here is what crashed SubscriptionDashboard in production.
    // Every `current` is the live count and every `limit` is the starter-tier
    // entitlement -- neither comes from the row above.
    await expect(response?.json()).resolves.toEqual({
      skus: { current: 42, limit: 5000 },
      users: { current: 3, limit: 3 },
      storage: { current: 4096, limit: 10 * 1024 * 1024 * 1024 },
      inventoryItems: { current: 84, limit: 5000 },
    });
  });

  it('loads supplier credit read data from the authenticated organization', async () => {
    mockedAuthenticateClerkRequest.mockResolvedValue(authenticatedClerkOrgContext);
    const dbWithSupplierCredits = {
      sql: vi.fn((strings: TemplateStringsArray) => {
        const query = strings.join(' ');
        if (query.includes('FROM users')) {
          return Promise.resolve([{ id: 7, organizationId: 'org_123', role: 'admin' }]);
        }
        return Promise.resolve([]);
      }),
      listSuppliers: vi.fn().mockResolvedValue([{ id: 1, name: 'Blackmores' }]),
      getClaimablePool: vi.fn().mockResolvedValue([{ supplierId: 1, items: [] }]),
      getRecoveryReport: vi
        .fn()
        .mockResolvedValue({ outstandingValue: 0, unclaimedValue: 0, suppliers: [] }),
      listCreditClaims: vi.fn().mockResolvedValue([{ id: 12, status: 'SENT' }]),
    } as unknown as Database;

    const suppliers = await resolveMinimalGet(
      '/api/supplier-credits/suppliers',
      dbWithSupplierCredits,
    );
    const pool = await resolveMinimalGet(
      '/api/supplier-credits/claimable-pool',
      dbWithSupplierCredits,
    );
    const report = await resolveMinimalGet(
      '/api/supplier-credits/recovery-report',
      dbWithSupplierCredits,
    );
    const claims = await resolveMinimalGet(
      '/api/supplier-credits/claims',
      dbWithSupplierCredits,
      '/api/supplier-credits/claims?view=open',
    );

    expect(suppliers?.status).toBe(200);
    expect(pool?.status).toBe(200);
    expect(report?.status).toBe(200);
    expect(claims?.status).toBe(200);
    expect(dbWithSupplierCredits.listSuppliers).toHaveBeenCalledWith('org_123');
    expect(dbWithSupplierCredits.getClaimablePool).toHaveBeenCalledWith('org_123');
    expect(dbWithSupplierCredits.getRecoveryReport).toHaveBeenCalledWith('org_123');
    expect(dbWithSupplierCredits.listCreditClaims).toHaveBeenCalledWith('org_123', [
      'DRAFT',
      'SENDING',
      'SENT',
      'ACKNOWLEDGED',
    ]);
  });

  it('allows a team member to create a bare supplier', async () => {
    mockedAuthenticateClerkRequest.mockResolvedValue(authenticatedClerkOrgContext);
    const createSupplier = vi.fn().mockResolvedValue({
      id: 11,
      name: 'Bare Supplier',
      creditPolicyNote: '',
      policyUpdatedAt: null,
    });
    const database = {
      sql: vi.fn().mockResolvedValue([{ id: 7, organizationId: 'org_123', role: 'team_member' }]),
      createSupplier,
    } as unknown as Database;

    const response = await resolveMinimalApiRoute(getMinimalRoutes(), {
      request: new Request('https://example.com/api/supplier-credits/suppliers', {
        method: 'POST',
        body: JSON.stringify({ name: '  Bare Supplier  ' }),
      }),
      pathname: '/api/supplier-credits/suppliers',
      method: 'POST',
      db: database,
      env,
    });

    expect(response?.status).toBe(201);
    expect(createSupplier).toHaveBeenCalledWith(
      'org_123',
      expect.objectContaining({
        name: 'Bare Supplier',
        creditType: 'NONE',
        creditPolicyNote: '',
        followUpDays: 7,
        policyUpdatedAt: null,
      }),
    );
  });

  it('rejects an unknown supplier credit type before writing', async () => {
    mockedAuthenticateClerkRequest.mockResolvedValue(authenticatedClerkOrgContext);
    const createSupplier = vi.fn();
    const database = {
      sql: vi.fn().mockResolvedValue([{ id: 7, organizationId: 'org_123', role: 'admin' }]),
      createSupplier,
    } as unknown as Database;

    const response = await resolveMinimalApiRoute(getMinimalRoutes(), {
      request: new Request('https://example.com/api/supplier-credits/suppliers', {
        method: 'POST',
        body: JSON.stringify({ name: 'Supplier', creditType: 'PARTIAL' }),
      }),
      pathname: '/api/supplier-credits/suppliers',
      method: 'POST',
      db: database,
      env,
    });

    expect(response?.status).toBe(400);
    expect(createSupplier).not.toHaveBeenCalled();
  });

  it('forbids a changed policy for a non-admin before writing', async () => {
    mockedAuthenticateClerkRequest.mockResolvedValue(authenticatedClerkOrgContext);
    const createSupplier = vi.fn();
    const database = {
      sql: vi.fn().mockResolvedValue([{ id: 7, organizationId: 'org_123', role: 'team_member' }]),
      createSupplier,
    } as unknown as Database;

    const response = await resolveMinimalApiRoute(getMinimalRoutes(), {
      request: new Request('https://example.com/api/supplier-credits/suppliers', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Policy Supplier',
          creditPolicyNote: 'Return monthly',
          contactPhone: '02 1234 5678',
        }),
      }),
      pathname: '/api/supplier-credits/suppliers',
      method: 'POST',
      db: database,
      env,
    });

    expect(response?.status).toBe(403);
    expect(createSupplier).not.toHaveBeenCalled();
  });

  it('returns structured 422 field errors for an invalid admin policy', async () => {
    mockedAuthenticateClerkRequest.mockResolvedValue(authenticatedClerkOrgContext);
    const createSupplier = vi.fn();
    const database = {
      sql: vi.fn().mockResolvedValue([{ id: 7, organizationId: 'org_123', role: 'org:admin' }]),
      createSupplier,
    } as unknown as Database;

    const response = await resolveMinimalApiRoute(getMinimalRoutes(), {
      request: new Request('https://example.com/api/supplier-credits/suppliers', {
        method: 'POST',
        body: JSON.stringify({ name: 'Policy Supplier', creditPolicyNote: 'Return monthly' }),
      }),
      pathname: '/api/supplier-credits/suppliers',
      method: 'POST',
      db: database,
      env,
    });

    expect(response?.status).toBe(422);
    await expect(response?.json()).resolves.toEqual({
      code: 'POLICY_VALIDATION_ERROR',
      message: 'Supplier policy is invalid',
      statusCode: 422,
      errors: [
        { field: 'contact', message: 'Add a contact email, phone, or representative email' },
      ],
    });
    expect(createSupplier).not.toHaveBeenCalled();
  });

  it('matches Express supplier field boundaries in Worker create validation', async () => {
    mockedAuthenticateClerkRequest.mockResolvedValue(authenticatedClerkOrgContext);
    const createSupplier = vi.fn().mockImplementation((_organizationId, data) =>
      Promise.resolve({
        id: 9,
        ...data,
      }),
    );
    const database = {
      sql: vi.fn().mockResolvedValue([{ id: 7, organizationId: 'org_123', role: 'org:admin' }]),
      createSupplier,
    } as unknown as Database;

    const validZeroCredit = await resolveMinimalApiRoute(getMinimalRoutes(), {
      request: new Request('https://example.com/api/supplier-credits/suppliers', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Policy Supplier',
          contactPhone: '02 1234 5678',
          creditPolicyNote: 'No credit is issued',
          policyWriteOffQty: 1,
          policyCreditQty: 0,
          followUpDays: 365,
        }),
      }),
      pathname: '/api/supplier-credits/suppliers',
      method: 'POST',
      db: database,
      env,
    });

    expect(validZeroCredit?.status).toBe(201);
    expect(createSupplier).toHaveBeenCalledOnce();

    for (const body of [
      { name: 'x'.repeat(121) },
      { name: '<b>Policy Supplier</b>' },
      { name: 'Policy Supplier', followUpDays: 366 },
    ]) {
      const response = await resolveMinimalApiRoute(getMinimalRoutes(), {
        request: new Request('https://example.com/api/supplier-credits/suppliers', {
          method: 'POST',
          body: JSON.stringify(body),
        }),
        pathname: '/api/supplier-credits/suppliers',
        method: 'POST',
        db: database,
        env,
      });

      expect(response?.status).toBe(400);
    }
    expect(createSupplier).toHaveBeenCalledOnce();
  });

  it('rejects an empty Worker PATCH like the Express partial-update schema', async () => {
    mockedAuthenticateClerkRequest.mockResolvedValue(authenticatedClerkOrgContext);
    const updateSupplier = vi.fn();
    const database = {
      sql: vi.fn().mockResolvedValue([{ id: 7, organizationId: 'org_123', role: 'admin' }]),
      findSupplier: vi.fn(),
      updateSupplier,
    } as unknown as Database;

    const response = await resolveMinimalApiRoute(getMinimalRoutes(), {
      request: new Request('https://example.com/api/supplier-credits/suppliers/4', {
        method: 'PATCH',
        body: JSON.stringify({}),
      }),
      pathname: '/api/supplier-credits/suppliers/4',
      method: 'PATCH',
      db: database,
      env,
    });

    expect(response?.status).toBe(400);
    expect(database.findSupplier).not.toHaveBeenCalled();
    expect(updateSupplier).not.toHaveBeenCalled();
  });

  it('matches the Express bulk brand-name length limit before database work', async () => {
    mockedAuthenticateClerkRequest.mockResolvedValue(authenticatedClerkOrgContext);
    const bulkLinkProducts = vi.fn();
    const database = {
      sql: vi.fn().mockResolvedValue([{ id: 7, organizationId: 'org_123', role: 'admin' }]),
      bulkLinkProducts,
    } as unknown as Database;

    const response = await resolveMinimalApiRoute(getMinimalRoutes(), {
      request: new Request('https://example.com/api/supplier-credits/brands/bulk-link', {
        method: 'POST',
        body: JSON.stringify({ brandName: 'x'.repeat(161), productIds: [1] }),
      }),
      pathname: '/api/supplier-credits/brands/bulk-link',
      method: 'POST',
      db: database,
      env,
    });

    expect(response?.status).toBe(422);
    expect(bulkLinkProducts).not.toHaveBeenCalled();
  });

  it('allows a normalized unchanged PATCH for a team member without a timestamp bump', async () => {
    mockedAuthenticateClerkRequest.mockResolvedValue(authenticatedClerkOrgContext);
    const existing = {
      id: 4,
      name: 'Supplier',
      contactEmail: 'claims@example.com',
      contactPhone: null,
      creditPolicyNote: 'Return monthly',
      policyWriteOffQty: 3,
      policyCreditQty: 1,
      followUpDays: 7,
      representativeName: null,
      representativeEmail: null,
      policyUpdatedAt: '2026-07-01T00:00:00.000Z',
    };
    const updateSupplier = vi.fn().mockResolvedValue(existing);
    const database = {
      sql: vi.fn().mockResolvedValue([{ id: 7, organizationId: 'org_123', role: 'team_member' }]),
      findSupplier: vi.fn().mockResolvedValue(existing),
      updateSupplier,
    } as unknown as Database;

    const response = await resolveMinimalApiRoute(getMinimalRoutes(), {
      request: new Request('https://example.com/api/supplier-credits/suppliers/4', {
        method: 'PATCH',
        body: JSON.stringify({ creditPolicyNote: '  Return monthly  ' }),
      }),
      pathname: '/api/supplier-credits/suppliers/4',
      method: 'PATCH',
      db: database,
      env,
    });

    expect(response?.status).toBe(200);
    expect(updateSupplier).toHaveBeenCalledWith(
      'org_123',
      4,
      expect.objectContaining({
        creditPolicyNote: 'Return monthly',
        policyUpdatedAt: existing.policyUpdatedAt,
      }),
    );
  });

  it('rejects a raw 501-item bulk request before database work', async () => {
    mockedAuthenticateClerkRequest.mockResolvedValue(authenticatedClerkOrgContext);
    const bulkAttachSupplier = vi.fn();
    const database = {
      sql: vi.fn().mockResolvedValue([{ id: 7, organizationId: 'org_123', role: 'admin' }]),
      bulkAttachSupplier,
    } as unknown as Database;

    const response = await resolveMinimalApiRoute(getMinimalRoutes(), {
      request: new Request('https://example.com/api/supplier-credits/policy-review/bulk-attach', {
        method: 'POST',
        body: JSON.stringify({ supplierId: 4, brandIds: Array.from({ length: 501 }, () => 10) }),
      }),
      pathname: '/api/supplier-credits/policy-review/bulk-attach',
      method: 'POST',
      db: database,
      env,
    });

    expect(response?.status).toBe(422);
    expect(bulkAttachSupplier).not.toHaveBeenCalled();
  });

  // The three `normalizeRole(...) !== ROLES.ADMIN` gates in index-minimal.ts are the
  // only live consumers of constants/roles.ts. The supplier-policy write gate is
  // covered above ('forbids a changed policy for a non-admin before writing'); these
  // two cover the remaining gates, which had no test before task 3.1.0.
  // Task 3.1.a / #471. The tier cap itself is enforced inside the INSERT and is
  // covered against real SQL in database.usage-limits.pglite.node.test.ts; what
  // these assert is the route contract on top of it -- that a refusal from the
  // database layer becomes a 402 naming the limit rather than a 500 or a
  // success with a null body.
  const tierDatabase = (
    tierLevel: string,
    overrides: Partial<Record<keyof Database, unknown>>,
  ): Database =>
    ({
      sql: vi.fn((strings: TemplateStringsArray) => {
        const query = strings.join(' ');
        if (query.includes('FROM users')) {
          return Promise.resolve([{ id: 7, organizationId: 'org_123', role: 'admin' }]);
        }
        if (query.includes('FROM subscription_tiers')) {
          return Promise.resolve([{ tier_level: tierLevel }]);
        }
        return Promise.resolve([]);
      }),
      ...overrides,
    }) as unknown as Database;

  it('refuses a product create that would exceed the tier SKU cap', async () => {
    mockedAuthenticateClerkRequest.mockResolvedValue(authenticatedClerkOrgContext);
    // null is the database layer's "the cap subquery admitted no row" signal.
    const createProduct = vi.fn().mockResolvedValue(null);
    const database = tierDatabase('free', { createProduct });

    const response = await resolveMinimalApiRoute(getMinimalRoutes(), {
      request: new Request('https://example.com/api/products', {
        method: 'POST',
        body: JSON.stringify({ barcode: 'BAR-1', name: 'Milk' }),
      }),
      pathname: '/api/products',
      method: 'POST',
      db: database,
      env: enforcingEnv,
    });

    expect(response?.status).toBe(402);
    await expect(response?.json()).resolves.toMatchObject({
      error: expect.stringContaining('SKU limit reached'),
      limit: 500,
      retryable: false,
    });
  });

  it('passes the tier SKU cap to the database layer rather than a hardcoded one', async () => {
    mockedAuthenticateClerkRequest.mockResolvedValue(authenticatedClerkOrgContext);
    const createProduct = vi.fn().mockResolvedValue({ id: 1, name: 'Milk' });
    const database = tierDatabase('professional', { createProduct });

    const response = await resolveMinimalApiRoute(getMinimalRoutes(), {
      request: new Request('https://example.com/api/products', {
        method: 'POST',
        body: JSON.stringify({ barcode: 'BAR-1', name: 'Milk' }),
      }),
      pathname: '/api/products',
      method: 'POST',
      db: database,
      env,
    });

    expect(response?.status).toBe(201);
    // A cap resolved from the org's own tier, not the free-tier default: the
    // create would be wrongly refused at 500 SKUs if this regressed.
    expect(createProduct).toHaveBeenCalledWith('org_123', expect.anything(), 50000);
  });

  it('refuses an inventory create that would exceed the tier active-expiry cap', async () => {
    mockedAuthenticateClerkRequest.mockResolvedValue(authenticatedClerkOrgContext);
    const createInventoryItem = vi.fn().mockResolvedValue(null);
    const database = tierDatabase('free', { createInventoryItem });

    const response = await resolveMinimalApiRoute(getMinimalRoutes(), {
      request: new Request('https://example.com/api/inventory-items', {
        method: 'POST',
        body: JSON.stringify({ productId: 1, expiryDate: '2099-01-01', locationId: 1 }),
      }),
      pathname: '/api/inventory-items',
      method: 'POST',
      db: database,
      env: enforcingEnv,
    });

    expect(response?.status).toBe(402);
    await expect(response?.json()).resolves.toMatchObject({
      error: expect.stringContaining('active expiry item limit reached'),
      limit: 500,
    });
  });

  // Task 3.1.a, measure-only mode. The default is OFF because the numbers in
  // LAUNCH_TIER_LIMITS are estimates pending a usage trial, and a cap that
  // refuses writes during the trial would truncate the data the trial exists to
  // gather. These assert the two halves of that: the write still succeeds, and
  // the crossing is still recorded.
  it('allows an over-cap product create when enforcement is off, and records it', async () => {
    mockedAuthenticateClerkRequest.mockResolvedValue(authenticatedClerkOrgContext);
    // Refuses under the real cap, admits under the lifted one -- the same shape
    // the SQL has, where the cap is a parameter of the INSERT.
    const createProduct = vi
      .fn()
      .mockImplementation((_org: string, _data: unknown, cap: number) =>
        Promise.resolve(cap === UNLIMITED_CAP ? { id: 1, name: 'Milk' } : null),
      );
    const database = tierDatabase('free', { createProduct });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const response = await resolveMinimalApiRoute(getMinimalRoutes(), {
      request: new Request('https://example.com/api/products', {
        method: 'POST',
        body: JSON.stringify({ barcode: 'BAR-1', name: 'Milk' }),
      }),
      pathname: '/api/products',
      method: 'POST',
      db: database,
      env,
    });

    expect(response?.status).toBe(201);
    // The real cap is attempted first, so the refusal is observed rather than
    // skipped: a change that jumped straight to UNLIMITED_CAP would measure
    // nothing and this would catch it.
    expect(createProduct).toHaveBeenNthCalledWith(1, 'org_123', expect.anything(), 500);
    expect(createProduct).toHaveBeenNthCalledWith(2, 'org_123', expect.anything(), UNLIMITED_CAP);
    expect(JSON.parse(warn.mock.calls[0][0] as string)).toEqual({
      event: 'usage_limit_reached',
      resource: 'SKU',
      organizationId: 'org_123',
      tier: 'free',
      limit: 500,
      enforced: false,
    });
    warn.mockRestore();
  });

  it('allows an over-cap inventory create when enforcement is off, and records it', async () => {
    mockedAuthenticateClerkRequest.mockResolvedValue(authenticatedClerkOrgContext);
    const createInventoryItem = vi
      .fn()
      .mockImplementation((_org: string, _user: string, _data: unknown, cap: number) =>
        Promise.resolve(cap === UNLIMITED_CAP ? { id: 1 } : null),
      );
    const database = tierDatabase('free', { createInventoryItem });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const response = await resolveMinimalApiRoute(getMinimalRoutes(), {
      request: new Request('https://example.com/api/inventory-items', {
        method: 'POST',
        body: JSON.stringify({ productId: 1, expiryDate: '2099-01-01', locationId: 1 }),
      }),
      pathname: '/api/inventory-items',
      method: 'POST',
      db: database,
      env,
    });

    expect(response?.status).toBe(201);
    expect(createInventoryItem).toHaveBeenCalledTimes(2);
    expect(JSON.parse(warn.mock.calls[0][0] as string)).toMatchObject({
      event: 'usage_limit_reached',
      resource: 'active expiry item',
      enforced: false,
    });
    warn.mockRestore();
  });

  it('still records the crossing when enforcement IS on', async () => {
    mockedAuthenticateClerkRequest.mockResolvedValue(authenticatedClerkOrgContext);
    const database = tierDatabase('free', { createProduct: vi.fn().mockResolvedValue(null) });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await resolveMinimalApiRoute(getMinimalRoutes(), {
      request: new Request('https://example.com/api/products', {
        method: 'POST',
        body: JSON.stringify({ barcode: 'BAR-1', name: 'Milk' }),
      }),
      pathname: '/api/products',
      method: 'POST',
      db: database,
      env: enforcingEnv,
    });

    // The log is not a substitute for the refusal, it accompanies it -- so the
    // enforced flag is the only difference between the two states.
    expect(JSON.parse(warn.mock.calls[0][0] as string)).toMatchObject({
      event: 'usage_limit_reached',
      enforced: true,
    });
    warn.mockRestore();
  });

  it.each(['1', 'yes', 'TRUE', ''])(
    'leaves enforcement off for the near-miss flag value %o',
    async (value) => {
      mockedAuthenticateClerkRequest.mockResolvedValue(authenticatedClerkOrgContext);
      const createProduct = vi
        .fn()
        .mockImplementation((_org: string, _data: unknown, cap: number) =>
          Promise.resolve(cap === UNLIMITED_CAP ? { id: 1, name: 'Milk' } : null),
        );
      const database = tierDatabase('free', { createProduct });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const response = await resolveMinimalApiRoute(getMinimalRoutes(), {
        request: new Request('https://example.com/api/products', {
          method: 'POST',
          body: JSON.stringify({ barcode: 'BAR-1', name: 'Milk' }),
        }),
        pathname: '/api/products',
        method: 'POST',
        db: database,
        env: { USAGE_LIMITS_ENFORCE: value } as Env,
      });

      // A guard on customer writes should only arm on the exact opt-in string;
      // anything else must leave it disarmed rather than half-enabled.
      expect(response?.status).toBe(201);
      warn.mockRestore();
    },
  );

  it('forbids clearing a supplier policy for a non-admin before writing', async () => {
    mockedAuthenticateClerkRequest.mockResolvedValue(authenticatedClerkOrgContext);
    const clearSupplierPolicy = vi.fn();
    const database = {
      sql: vi.fn().mockResolvedValue([{ id: 7, organizationId: 'org_123', role: 'manager' }]),
      clearSupplierPolicy,
    } as unknown as Database;

    const response = await resolveMinimalApiRoute(getMinimalRoutes(), {
      request: new Request('https://example.com/api/supplier-credits/suppliers/4/policy', {
        method: 'DELETE',
      }),
      pathname: '/api/supplier-credits/suppliers/4/policy',
      method: 'DELETE',
      db: database,
      env,
    });

    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toMatchObject({ code: 'AUTHORIZATION_ERROR' });
    expect(clearSupplierPolicy).not.toHaveBeenCalled();
  });

  it('forbids a bulk policy attach for a non-admin before writing', async () => {
    mockedAuthenticateClerkRequest.mockResolvedValue(authenticatedClerkOrgContext);
    const bulkAttachSupplier = vi.fn();
    const database = {
      sql: vi.fn().mockResolvedValue([{ id: 7, organizationId: 'org_123', role: 'team_member' }]),
      bulkAttachSupplier,
    } as unknown as Database;

    const response = await resolveMinimalApiRoute(getMinimalRoutes(), {
      request: new Request('https://example.com/api/supplier-credits/policy-review/bulk-attach', {
        method: 'POST',
        body: JSON.stringify({ supplierId: 4, brandIds: [10] }),
      }),
      pathname: '/api/supplier-credits/policy-review/bulk-attach',
      method: 'POST',
      db: database,
      env,
    });

    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toMatchObject({ code: 'AUTHORIZATION_ERROR' });
    expect(bulkAttachSupplier).not.toHaveBeenCalled();
  });

  it('admits a legacy Clerk admin role string through the bulk policy attach gate', async () => {
    mockedAuthenticateClerkRequest.mockResolvedValue(authenticatedClerkOrgContext);
    const bulkAttachSupplier = vi.fn().mockResolvedValue({ attached: 1 });
    const database = {
      sql: vi.fn().mockResolvedValue([{ id: 7, organizationId: 'org_123', role: 'org:admin' }]),
      bulkAttachSupplier,
    } as unknown as Database;

    const response = await resolveMinimalApiRoute(getMinimalRoutes(), {
      request: new Request('https://example.com/api/supplier-credits/policy-review/bulk-attach', {
        method: 'POST',
        body: JSON.stringify({ supplierId: 4, brandIds: [10] }),
      }),
      pathname: '/api/supplier-credits/policy-review/bulk-attach',
      method: 'POST',
      db: database,
      env,
    });

    expect(response?.status).not.toBe(403);
    expect(bulkAttachSupplier).toHaveBeenCalled();
  });

  it('rejects claimability vocabulary on catalogue review', async () => {
    mockedAuthenticateClerkRequest.mockResolvedValue(authenticatedClerkOrgContext);
    const reviewBrands = vi.fn().mockResolvedValue({ items: [], nextCursor: null });
    const database = {
      sql: vi.fn().mockResolvedValue([{ id: 7, organizationId: 'org_123', role: 'admin' }]),
      reviewBrands,
    } as unknown as Database;

    const response = await resolveMinimalGet(
      '/api/supplier-credits/brand-review',
      database,
      '/api/supplier-credits/brand-review?state=CLAIMABLE',
    );

    expect(response?.status).toBe(400);
    expect(reviewBrands).not.toHaveBeenCalled();
  });

  it('passes the CONFIRMED catalogue-review state to the database', async () => {
    mockedAuthenticateClerkRequest.mockResolvedValue(authenticatedClerkOrgContext);
    const reviewBrands = vi.fn().mockResolvedValue({ items: [], nextCursor: null });
    const database = {
      sql: vi.fn().mockResolvedValue([{ id: 7, organizationId: 'org_123', role: 'admin' }]),
      reviewBrands,
    } as unknown as Database;

    const response = await resolveMinimalGet(
      '/api/supplier-credits/brand-review',
      database,
      '/api/supplier-credits/brand-review?state=CONFIRMED',
    );

    expect(response?.status).toBe(200);
    expect(reviewBrands).toHaveBeenCalledWith('org_123', {
      state: 'CONFIRMED',
      group: undefined,
      cursor: undefined,
      limit: 50,
    });
  });

  it('passes numbered catalogue pagination and title controls to the database', async () => {
    mockedAuthenticateClerkRequest.mockResolvedValue(authenticatedClerkOrgContext);
    const reviewBrands = vi.fn().mockResolvedValue({
      items: [],
      page: 2,
      pageSize: 25,
      totalItems: 0,
      totalPages: 0,
      nextCursor: null,
    });
    const database = {
      sql: vi.fn().mockResolvedValue([{ id: 7, organizationId: 'org_123', role: 'admin' }]),
      reviewBrands,
    } as unknown as Database;

    const response = await resolveMinimalGet(
      '/api/supplier-credits/brand-review',
      database,
      '/api/supplier-credits/brand-review?page=2&pageSize=25&title=Vitamin&titleMatch=startsWith&sort=titleDesc',
    );

    expect(response?.status).toBe(200);
    expect(reviewBrands).toHaveBeenCalledWith('org_123', {
      state: undefined,
      group: undefined,
      page: 2,
      pageSize: 25,
      title: 'Vitamin',
      titleMatch: 'startsWith',
      sort: 'titleDesc',
    });
  });

  it.each(['page=0', 'pageSize=101', 'page=1&cursor=5', 'titleMatch=equals', 'sort=newest'])(
    'rejects invalid numbered catalogue query %s',
    async (query) => {
      mockedAuthenticateClerkRequest.mockResolvedValue(authenticatedClerkOrgContext);
      const reviewBrands = vi.fn();
      const database = {
        sql: vi.fn().mockResolvedValue([{ id: 7, organizationId: 'org_123', role: 'admin' }]),
        reviewBrands,
      } as unknown as Database;

      const response = await resolveMinimalGet(
        '/api/supplier-credits/brand-review',
        database,
        `/api/supplier-credits/brand-review?${query}`,
      );

      expect(response?.status).toBe(400);
      expect(reviewBrands).not.toHaveBeenCalled();
    },
  );

  it('conflicts when a platform correction already has a terminal decision', async () => {
    mockedAuthenticateClerkRequest.mockResolvedValue(authenticatedClerkOrgContext);
    const database = {
      sql: vi.fn().mockResolvedValue([{ id: 7, organizationId: 'org_123', role: 'admin' }]),
      reviewCatalogueCorrection: vi.fn().mockResolvedValue('ALREADY_REVIEWED'),
    } as unknown as Database;
    const adminEnv = { PLATFORM_ADMIN_USER_IDS: '7' } as Env;

    const response = await resolveMinimalApiRoute(getMinimalRoutes(), {
      request: new Request('https://example.com/api/platform/catalogue-corrections/12', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'REJECTED' }),
      }),
      pathname: '/api/platform/catalogue-corrections/12',
      method: 'PATCH',
      db: database,
      env: adminEnv,
    });

    expect(response?.status).toBe(409);
  });

  it('creates default organization usage with production-required timestamps', async () => {
    mockedAuthenticateClerkRequest.mockResolvedValue(authenticatedClerkOrgContext);
    const dbWithRows = createAuthenticatedOrgDatabase(
      { 'FROM organization_usage': [] },
      {
        getUsageCounts: vi.fn().mockResolvedValue({ skus: 0, users: 0, activeExpiries: 0 }),
        getStorageUsedBytes: vi.fn().mockResolvedValue(0),
      },
    );

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

  it.each([
    '/api/supplier-credits/suppliers',
    '/api/supplier-credits/claimable-pool',
    '/api/supplier-credits/recovery-report',
    '/api/supplier-credits/claims',
  ])('dispatches %s to auth instead of returning route-not-found', async (pathname) => {
    mockedAuthenticateClerkRequest.mockResolvedValue(new Response('Unauthorized', { status: 401 }));
    const response = await resolveMinimalApiRoute(getMinimalRoutes(), {
      request: new Request(`https://example.com${pathname}`),
      pathname,
      method: 'GET',
      db,
      env,
    });

    expect(response).not.toBeNull();
    expect(response?.status).toBe(401);
  });
});
