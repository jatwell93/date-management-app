/**
 * Authorization-precedence gates on the deployed Worker routes (task 3.2, batch 3).
 *
 * The Express suite asserted these through `req.userId`, `x-user-id`, and a role
 * hierarchy. The Worker has none of those: identity comes from a verified Clerk
 * token, the tenant from the user row it resolves to, and each route lists the
 * roles it admits. What carries over is the ORDER of the decisions, which is
 * what these tests pin:
 *
 *   1. no valid identity   -> 401, before the database is read;
 *   2. wrong role          -> 403, before anything is written, and before the
 *                             request body is judged on its merits (a caller
 *                             without the role must not learn which of their
 *                             fields were valid);
 *   3. a platform operator is a configured allow-list of user ids that refuses
 *      when the configuration is anything but a clean list.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveMinimalApiRoute, type MinimalApiRoute } from './minimal-api-routes';
import * as minimalEntrypoint from './index-minimal';
import { isPlatformAdminUser } from './index-minimal';
import { authenticateClerkRequest } from './clerk/bootstrap-handler';
import type { Database } from './database';
import type { Env } from './types/env';

vi.mock('./clerk/bootstrap-handler', () => ({
  authenticateClerkRequest: vi.fn(),
  getClerkAuthorizedParties: vi.fn(() => []),
  handleOrganizationBootstrap: vi.fn().mockResolvedValue(new Response('bootstrap')),
}));

const env = {} as Env;
const mockedAuthenticateClerkRequest = vi.mocked(authenticateClerkRequest);
const authenticatedContext = {
  clerkUserId: 'user_clerk_123',
  email: 'user@example.com',
  username: 'user',
  organizationId: 'org_123',
  organizationRole: 'org:admin',
};

function routes(): MinimalApiRoute[] {
  return (minimalEntrypoint as typeof minimalEntrypoint & { MINIMAL_API_ROUTES: MinimalApiRoute[] })
    .MINIMAL_API_ROUTES;
}

/** A database whose user lookup resolves to user 7 in `org_123` with `role`. */
function databaseWithRole(
  role: string,
  methods: Partial<Record<keyof Database, unknown>> = {},
): Database {
  return {
    ...methods,
    sql: vi.fn().mockResolvedValue([{ id: 7, organizationId: 'org_123', role }]),
  } as unknown as Database;
}

function dispatch(
  method: string,
  pathname: string,
  database: Database,
  body?: unknown,
  withEnv: Env = env,
) {
  return resolveMinimalApiRoute(routes(), {
    request: new Request(`https://example.com${pathname}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    pathname,
    method,
    db: database,
    env: withEnv,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('an unauthenticated caller is refused before the database is read', () => {
  // The Express tests staged "no userId on the request" by hand. The Worker has
  // one way to arrive without an identity, a token that does not verify, and the
  // property worth holding is that nothing downstream runs for such a caller.
  // `sql` doubles as the tripwire: the user lookup is the first query any
  // authenticated handler makes, so an untouched mock means no handler logic ran.
  it.each([
    ['GET', '/api/storage-quota/7'],
    ['POST', '/api/inventory-items'],
    ['PUT', '/api/inventory-items/12'],
    ['DELETE', '/api/inventory-items/12'],
    ['GET', '/api/expired-items'],
    ['POST', '/api/expired-items/process'],
    ['GET', '/api/organization/usage'],
    ['POST', '/api/subscription/create-checkout-session'],
    ['GET', '/api/platform/catalogue-corrections'],
  ])('answers 401 for %s %s and touches nothing', async (method, pathname) => {
    mockedAuthenticateClerkRequest.mockResolvedValue(new Response('Unauthorized', { status: 401 }));
    const sql = vi.fn();
    const mutate = vi.fn();
    const database = {
      sql,
      createInventoryItem: mutate,
      updateInventoryItem: mutate,
      deleteInventoryItem: mutate,
      processExpiredItem: mutate,
    } as unknown as Database;

    const response = await dispatch(method, pathname, database, method === 'GET' ? undefined : {});

    expect(response).not.toBeNull();
    expect(response?.status).toBe(401);
    expect(sql).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('answers 401 for a verified user who never completed bootstrap', async () => {
    // A valid token with no user row is a different way to have no identity: the
    // caller proved who they are to Clerk but belongs to no organization here.
    mockedAuthenticateClerkRequest.mockResolvedValue(authenticatedContext);
    const database = { sql: vi.fn().mockResolvedValue([]) } as unknown as Database;

    const response = await dispatch('POST', '/api/inventory-items', database, {});

    expect(response?.status).toBe(401);
  });
});

describe('a platform operator is a clean allow-list or nobody', () => {
  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['blank', '   '],
    ['non-numeric', 'abc'],
    ['one bad entry poisons a good one', '7,abc'],
    ['an empty entry', '7,,9'],
    ['zero', '0'],
    ['negative', '-7'],
    ['decimal', '7.5'],
    ['leading zero', '07'],
    ['scientific notation', '7e0'],
  ])('refuses user 7 when the list is %s', (_label, configuration) => {
    expect(isPlatformAdminUser(7, configuration)).toBe(false);
  });

  it.each([
    ['undefined', undefined],
    ['zero', 0],
    ['negative', -7],
    ['fractional', 7.5],
    ['NaN', Number.NaN],
    ['unsafe', Number.MAX_SAFE_INTEGER + 2],
  ])('refuses a %s user id even when a list is configured', (_label, userId) => {
    expect(isPlatformAdminUser(userId, '7,9')).toBe(false);
  });

  it('admits exactly the listed ids, tolerating whitespace around them', () => {
    expect(isPlatformAdminUser(7, '7')).toBe(true);
    expect(isPlatformAdminUser(9, ' 7 , 9 ')).toBe(true);
    expect(isPlatformAdminUser(8, '7,9')).toBe(false);
    expect(isPlatformAdminUser(70, '7')).toBe(false);
  });

  it.each([
    ['GET', '/api/platform/catalogue-corrections', undefined],
    ['GET', '/api/platform/catalogue/provenance', undefined],
    ['PATCH', '/api/platform/catalogue-corrections/3', { status: 'ACCEPTED' }],
  ])('%s %s answers 403 to a malformed allow-list that names the caller', async (m, p, body) => {
    mockedAuthenticateClerkRequest.mockResolvedValue(authenticatedContext);
    const platform = vi.fn();
    const database = databaseWithRole('admin', {
      listCatalogueCorrections: platform,
      getCatalogueProvenance: platform,
      reviewCatalogueCorrection: platform,
    });

    // User 7 is in the list, but the list as a whole is not valid, so the gate
    // refuses everyone. A parser that skipped the bad token would admit user 7.
    const response = await dispatch(m, p, database, body, {
      PLATFORM_ADMIN_USER_IDS: '7,abc',
    } as Env);

    expect(response?.status).toBe(403);
    expect(platform).not.toHaveBeenCalled();
  });

  it('admits the listed operator and refuses a tenant admin who is not listed', async () => {
    mockedAuthenticateClerkRequest.mockResolvedValue(authenticatedContext);
    const listCatalogueCorrections = vi.fn().mockResolvedValue({ items: [], nextCursor: null });
    const database = databaseWithRole('admin', { listCatalogueCorrections });

    const listed = await dispatch(
      'GET',
      '/api/platform/catalogue-corrections',
      database,
      undefined,
      {
        PLATFORM_ADMIN_USER_IDS: '7',
      } as Env,
    );
    expect(listed?.status).toBe(200);

    listCatalogueCorrections.mockClear();
    // Role `admin` is a tenant role. It confers nothing on the platform surface.
    const unlisted = await dispatch(
      'GET',
      '/api/platform/catalogue-corrections',
      database,
      undefined,
      { PLATFORM_ADMIN_USER_IDS: '8' } as Env,
    );
    expect(unlisted?.status).toBe(403);
    expect(listCatalogueCorrections).not.toHaveBeenCalled();
  });
});

describe('supplier policy authorization runs before validation and before the write', () => {
  const existing = {
    id: 4,
    name: 'Supplier',
    contactEmail: 'claims@example.com',
    contactPhone: null,
    creditType: 'NONE',
    creditPolicyNote: 'Return monthly',
    policyWriteOffQty: 3,
    policyCreditQty: 1,
    followUpDays: 7,
    representativeName: null,
    representativeEmail: null,
    policyUpdatedAt: '2026-07-01T00:00:00.000Z',
  };

  function supplierDatabase(role: string) {
    const updateSupplier = vi.fn().mockResolvedValue(existing);
    const database = databaseWithRole(role, {
      findSupplier: vi.fn().mockResolvedValue(existing),
      updateSupplier,
    });
    return { database, updateSupplier };
  }

  beforeEach(() => {
    mockedAuthenticateClerkRequest.mockResolvedValue(authenticatedContext);
  });

  it.each(['team_member', 'manager'])(
    'refuses a changed policy note from %s on PATCH',
    async (role) => {
      const { database, updateSupplier } = supplierDatabase(role);

      const response = await dispatch('PATCH', '/api/supplier-credits/suppliers/4', database, {
        creditPolicyNote: 'Return weekly',
      });

      expect(response?.status).toBe(403);
      await expect(response?.json()).resolves.toMatchObject({ code: 'AUTHORIZATION_ERROR' });
      expect(updateSupplier).not.toHaveBeenCalled();
    },
  );

  it('treats a credit-type change on its own as a policy change', async () => {
    // Classification is policy: a caller who cannot edit the note must not be able
    // to reclassify the supplier by sending only `creditType`.
    const { database, updateSupplier } = supplierDatabase('team_member');

    const response = await dispatch('PATCH', '/api/supplier-credits/suppliers/4', database, {
      creditType: 'FULL_CREDIT',
    });

    expect(response?.status).toBe(403);
    expect(updateSupplier).not.toHaveBeenCalled();
  });

  it('lets an admin make the same credit-type change, and stamps the policy time', async () => {
    const { database, updateSupplier } = supplierDatabase('admin');

    const response = await dispatch('PATCH', '/api/supplier-credits/suppliers/4', database, {
      creditType: 'FULL_CREDIT',
    });

    expect(response?.status).toBe(200);
    expect(updateSupplier).toHaveBeenCalledWith(
      'org_123',
      4,
      expect.objectContaining({
        creditType: 'FULL_CREDIT',
        policyUpdatedAt: expect.not.stringMatching(existing.policyUpdatedAt),
      }),
    );
  });

  it('refuses a non-admin full replacement before judging its credit ratio', async () => {
    // Half a ratio is invalid for anyone. The point is WHO is told so: a team
    // member gets 403 and learns nothing about the policy fields, an admin gets
    // the 422 field error. Swapping the two checks would turn the first into a
    // 422 and tell a caller without the role which of their fields were wrong.
    const replacement = {
      name: 'Replacement',
      contactPhone: '02 1234 5678',
      creditPolicyNote: 'Return monthly',
      policyWriteOffQty: 3,
    };
    const member = supplierDatabase('team_member');
    const admin = supplierDatabase('admin');

    const refused = await dispatch(
      'PUT',
      '/api/supplier-credits/suppliers/4',
      member.database,
      replacement,
    );
    const judged = await dispatch(
      'PUT',
      '/api/supplier-credits/suppliers/4',
      admin.database,
      replacement,
    );

    expect(refused?.status).toBe(403);
    expect(judged?.status).toBe(422);
    expect(member.updateSupplier).not.toHaveBeenCalled();
    expect(admin.updateSupplier).not.toHaveBeenCalled();
  });
});

describe('bulk policy attach', () => {
  beforeEach(() => {
    mockedAuthenticateClerkRequest.mockResolvedValue(authenticatedContext);
  });

  it('deduplicates brand ids, keeping the first occurrence, for an admin', async () => {
    const bulkAttachSupplier = vi.fn().mockResolvedValue({ kind: 'SUCCESS', attached: 2 });
    const database = databaseWithRole('admin', { bulkAttachSupplier });

    await dispatch('POST', '/api/supplier-credits/policy-review/bulk-attach', database, {
      supplierId: 4,
      brandIds: [10, 10, 11],
    });

    expect(bulkAttachSupplier).toHaveBeenCalledWith('org_123', 4, [10, 11], 7);
  });

  it('counts the raw list against the cap, so 501 copies of one id are still refused', async () => {
    // Deduplicating first would let a caller send an unbounded list that
    // collapses to one id. The cap bounds the work of reading the request.
    const bulkAttachSupplier = vi.fn();
    const database = databaseWithRole('admin', { bulkAttachSupplier });

    const response = await dispatch(
      'POST',
      '/api/supplier-credits/policy-review/bulk-attach',
      database,
      { supplierId: 4, brandIds: Array.from({ length: 501 }, () => 10) },
    );

    expect(response?.status).toBe(422);
    expect(bulkAttachSupplier).not.toHaveBeenCalled();
  });

  it('refuses a manager even with a well-formed request', async () => {
    const bulkAttachSupplier = vi.fn();
    const database = databaseWithRole('manager', { bulkAttachSupplier });

    const response = await dispatch(
      'POST',
      '/api/supplier-credits/policy-review/bulk-attach',
      database,
      { supplierId: 4, brandIds: [10] },
    );

    expect(response?.status).toBe(403);
    expect(bulkAttachSupplier).not.toHaveBeenCalled();
  });
});
