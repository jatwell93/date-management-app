/**
 * Request-validation and result-mapping coverage for the supplier-credit routes
 * (task 3.2, batch 4c).
 *
 * Express put these rules in Zod request schemas and a service layer
 * (`supplier-policy-request-schema.test.ts`, `supplier-credit.service.test.ts`). The
 * Worker validates inside the route handlers, and the database methods answer with a
 * result code the handler maps to a status. These tests drive the real routes with a
 * stubbed database, so they pin the part the handlers own: which input is refused
 * with which status BEFORE the database is written, and how each database result is
 * reported. What the database does with the input is tested against real SQL in
 * `database.supplier-credit-writes.pglite.node.test.ts`.
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
const PLATFORM_ENV = { PLATFORM_ADMIN_USER_IDS: '7' } as Env;
const BASE = '/api/supplier-credits';

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

function dispatch(method: string, pathname: string, database: Database, body?: unknown) {
  const [path, query] = pathname.split('?');
  return resolveMinimalApiRoute(routes(), {
    request: new Request(`https://example.com${pathname}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    pathname: path,
    method,
    db: database,
    env: PLATFORM_ENV,
    ...(query === undefined ? {} : {}),
  });
}

const existingSupplier = {
  id: 5,
  name: 'Acme',
  creditType: 'FULL_CREDIT',
  contactEmail: null,
  contactPhone: '02 1111 2222',
  creditPolicyNote: 'Return monthly',
  policyWriteOffQty: 3,
  policyCreditQty: 1,
  followUpDays: 7,
  representativeName: null,
  representativeEmail: null,
  policyUpdatedAt: '2026-01-01T00:00:00.000Z',
};

const validCreate = { name: 'New Supplier', creditType: 'NONE' };

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

describe('supplier writes: request validation', () => {
  it.each([
    ['POST', `${BASE}/suppliers`, validCreate],
    ['PUT', `${BASE}/suppliers/5`, validCreate],
    ['PATCH', `${BASE}/suppliers/5`, {}],
  ])('%s %s refuses an unknown credit type and writes nothing', async (method, path, base) => {
    const write = vi.fn();
    const database = databaseWithRole('admin', {
      findSupplier: vi.fn().mockResolvedValue(existingSupplier),
      createSupplier: write,
      updateSupplier: write,
    });

    const response = await dispatch(method, path, database, { ...base, creditType: 'PARTIAL' });

    expect(response?.status).toBe(400);
    const body = await response?.json();
    expect(body).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(body.errors).toContainEqual(expect.objectContaining({ field: 'creditType' }));
    expect(write).not.toHaveBeenCalled();
  });

  it.each(['NONE', 'FULL_CREDIT'])(
    'accepts credit type %s on create, replace and patch',
    async (creditType) => {
      const createSupplier = vi.fn().mockResolvedValue({ ...existingSupplier, creditType });
      const updateSupplier = vi.fn().mockResolvedValue({ ...existingSupplier, creditType });
      const database = databaseWithRole('admin', {
        findSupplier: vi.fn().mockResolvedValue(existingSupplier),
        createSupplier,
        updateSupplier,
      });
      const body = {
        name: 'Acme',
        creditType,
        creditPolicyNote: 'Return monthly',
        contactEmail: 'claims@acme.test',
      };

      expect((await dispatch('POST', `${BASE}/suppliers`, database, body))?.status).toBe(201);
      expect((await dispatch('PUT', `${BASE}/suppliers/5`, database, body))?.status).toBe(200);
      expect(
        (await dispatch('PATCH', `${BASE}/suppliers/5`, database, { creditType }))?.status,
      ).toBe(200);
    },
  );

  it('accepts every field at its documented limit', async () => {
    const createSupplier = vi.fn().mockResolvedValue(existingSupplier);
    const database = databaseWithRole('admin', { createSupplier });

    const response = await dispatch('POST', `${BASE}/suppliers`, database, {
      name: 'N'.repeat(120),
      creditPolicyNote: 'p'.repeat(10_000),
      contactPhone: '1'.repeat(80),
      representativeName: 'r'.repeat(120),
      creditType: 'NONE',
    });

    expect(response?.status).toBe(201);
    expect(createSupplier).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['creditPolicyNote', 'p'.repeat(10_001)],
    ['contactPhone', '1'.repeat(81)],
    ['representativeName', 'r'.repeat(121)],
    ['name', 'N'.repeat(121)],
    ['representativeEmail', 'not-an-email'],
    ['contactEmail', 'also not an email'],
    ['followUpDays', 366],
  ])('refuses %s past its limit or format, naming the field', async (field, value) => {
    const createSupplier = vi.fn();
    const database = databaseWithRole('admin', { createSupplier });

    const response = await dispatch('POST', `${BASE}/suppliers`, database, {
      ...validCreate,
      [field]: value,
    });

    expect(response?.status).toBe(400);
    const body = await response?.json();
    expect(body.errors).toContainEqual(expect.objectContaining({ field }));
    expect(createSupplier).not.toHaveBeenCalled();
  });

  it('refuses a name containing HTML tags on create', async () => {
    const database = databaseWithRole('admin', { createSupplier: vi.fn() });

    const response = await dispatch('POST', `${BASE}/suppliers`, database, {
      name: '<b>Acme</b>',
    });

    expect(response?.status).toBe(400);
  });

  it('refuses a patch that carries no supplier field', async () => {
    const updateSupplier = vi.fn();
    const database = databaseWithRole('admin', {
      findSupplier: vi.fn().mockResolvedValue(existingSupplier),
      updateSupplier,
    });

    const response = await dispatch('PATCH', `${BASE}/suppliers/5`, database, {});

    expect(response?.status).toBe(400);
    expect(updateSupplier).not.toHaveBeenCalled();
  });
});

describe('supplier writes: credit ratio', () => {
  it.each([
    ['only a write-off quantity', { policyWriteOffQty: 3 }],
    ['only a credit quantity', { policyCreditQty: 1 }],
  ])('refuses a create with %s as a structured policy error', async (_label, ratio) => {
    const createSupplier = vi.fn();
    const database = databaseWithRole('admin', { createSupplier });

    const response = await dispatch('POST', `${BASE}/suppliers`, database, {
      name: 'Acme',
      creditType: 'FULL_CREDIT',
      creditPolicyNote: 'Return monthly',
      contactEmail: 'claims@acme.test',
      ...ratio,
    });

    expect(response?.status).toBe(422);
    const body = await response?.json();
    expect(body).toMatchObject({ code: 'POLICY_VALIDATION_ERROR', statusCode: 422 });
    // Only the ratio is wrong: store instructions and a contact are present.
    expect(body.errors).toEqual([expect.objectContaining({ field: 'policyCreditQty' })]);
    expect(createSupplier).not.toHaveBeenCalled();
  });

  it('refuses a full replacement that leaves half a ratio', async () => {
    const updateSupplier = vi.fn();
    const database = databaseWithRole('admin', {
      findSupplier: vi.fn().mockResolvedValue(existingSupplier),
      updateSupplier,
    });

    const response = await dispatch('PUT', `${BASE}/suppliers/5`, database, {
      name: 'Acme',
      creditType: 'FULL_CREDIT',
      creditPolicyNote: 'Return monthly',
      contactEmail: 'claims@acme.test',
      policyWriteOffQty: 3,
      policyCreditQty: null,
    });

    expect(response?.status).toBe(422);
    expect(updateSupplier).not.toHaveBeenCalled();
  });

  it('lets a patch change one leg because it merges with the stored record', async () => {
    const updateSupplier = vi.fn().mockResolvedValue(existingSupplier);
    const database = databaseWithRole('admin', {
      findSupplier: vi.fn().mockResolvedValue(existingSupplier),
      updateSupplier,
    });

    const response = await dispatch('PATCH', `${BASE}/suppliers/5`, database, {
      policyCreditQty: 2,
    });

    expect(response?.status).toBe(200);
    expect(updateSupplier).toHaveBeenCalledWith(
      'org_123',
      5,
      expect.objectContaining({ policyWriteOffQty: 3, policyCreditQty: 2 }),
    );
  });
});

describe('supplier writes: merge, replace and ownership', () => {
  it('answers 404 for a supplier outside the organization and writes nothing', async () => {
    const updateSupplier = vi.fn();
    const database = databaseWithRole('admin', {
      findSupplier: vi.fn().mockResolvedValue(null),
      updateSupplier,
    });

    const patch = await dispatch('PATCH', `${BASE}/suppliers/5`, database, { contactPhone: '1' });
    const put = await dispatch('PUT', `${BASE}/suppliers/5`, database, validCreate);

    expect(patch?.status).toBe(404);
    expect(put?.status).toBe(404);
    expect(await patch?.json()).toMatchObject({ code: 'NOT_FOUND_ERROR' });
    expect(updateSupplier).not.toHaveBeenCalled();
  });

  it('merges a contact-only patch and leaves the policy timestamp alone', async () => {
    const updateSupplier = vi.fn().mockResolvedValue(existingSupplier);
    // A manager may change contact details; only a policy change needs an admin.
    const database = databaseWithRole('manager', {
      findSupplier: vi.fn().mockResolvedValue(existingSupplier),
      updateSupplier,
    });

    const response = await dispatch('PATCH', `${BASE}/suppliers/5`, database, {
      contactPhone: '03 9999 0000',
    });

    expect(response?.status).toBe(200);
    expect(updateSupplier).toHaveBeenCalledWith(
      'org_123',
      5,
      expect.objectContaining({
        contactPhone: '03 9999 0000',
        name: 'Acme',
        creditPolicyNote: 'Return monthly',
        policyWriteOffQty: 3,
        policyCreditQty: 1,
        policyUpdatedAt: existingSupplier.policyUpdatedAt,
      }),
    );
  });

  it('bumps the policy timestamp when a policy field changes', async () => {
    const updateSupplier = vi.fn().mockResolvedValue(existingSupplier);
    const database = databaseWithRole('admin', {
      findSupplier: vi.fn().mockResolvedValue(existingSupplier),
      updateSupplier,
    });

    await dispatch('PATCH', `${BASE}/suppliers/5`, database, { creditPolicyNote: 'Changed' });

    const written = updateSupplier.mock.calls[0][2];
    expect(written.creditPolicyNote).toBe('Changed');
    expect(written.policyUpdatedAt).not.toBe(existingSupplier.policyUpdatedAt);
  });

  it('replaces the whole record on PUT instead of merging, resetting omitted fields', async () => {
    const updateSupplier = vi.fn().mockResolvedValue(existingSupplier);
    const database = databaseWithRole('admin', {
      findSupplier: vi.fn().mockResolvedValue(existingSupplier),
      updateSupplier,
    });

    const response = await dispatch('PUT', `${BASE}/suppliers/5`, database, {
      name: 'Renamed',
      creditType: 'NONE',
      creditPolicyNote: 'New note',
      contactEmail: 'claims@acme.test',
    });

    expect(response?.status).toBe(200);
    expect(updateSupplier).toHaveBeenCalledWith(
      'org_123',
      5,
      expect.objectContaining({
        name: 'Renamed',
        creditType: 'NONE',
        contactPhone: null,
        creditPolicyNote: 'New note',
        policyWriteOffQty: null,
        policyCreditQty: null,
        followUpDays: 7,
      }),
    );
  });
});

describe('bulk policy and brand requests', () => {
  it('refuses 501 brand ids even when they are duplicates, before any write', async () => {
    const bulkAttachSupplier = vi.fn();
    const database = databaseWithRole('admin', { bulkAttachSupplier });

    const response = await dispatch('POST', `${BASE}/policy-review/bulk-attach`, database, {
      supplierId: 5,
      brandIds: Array.from({ length: 501 }, () => 1),
    });

    expect(response?.status).toBe(422);
    expect(bulkAttachSupplier).not.toHaveBeenCalled();
  });

  it('accepts exactly 500 ids', async () => {
    const bulkAttachSupplier = vi.fn().mockResolvedValue({ kind: 'SUCCESS', attached: 500 });
    const database = databaseWithRole('admin', { bulkAttachSupplier });

    const response = await dispatch('POST', `${BASE}/policy-review/bulk-attach`, database, {
      supplierId: 5,
      brandIds: Array.from({ length: 500 }, (_, i) => i + 1),
    });

    expect(response?.status).toBe(200);
  });

  it('removes duplicate product ids and passes exactly one brand target', async () => {
    const bulkLinkProducts = vi.fn().mockResolvedValue({ kind: 'SUCCESS', linked: 2 });
    const database = databaseWithRole('admin', { bulkLinkProducts });

    const response = await dispatch('POST', `${BASE}/brands/bulk-link`, database, {
      productIds: [1, 1, 2, 2],
      brandId: 4,
    });

    expect(response?.status).toBe(200);
    expect(bulkLinkProducts).toHaveBeenCalledWith('org_123', { brandId: 4 }, [1, 2], 7);
  });

  it.each([
    ['both a brand id and a brand name', { brandId: 4, brandName: 'Brand' }],
    ['neither a brand id nor a brand name', {}],
    ['a brand id of 0', { brandId: 0 }],
    ['a negative brand id', { brandId: -1 }],
    ['a fractional brand id', { brandId: 1.5 }],
    ['a brand name over 160 characters', { brandName: 'b'.repeat(161) }],
  ])('refuses a bulk link with %s', async (_label, target) => {
    const bulkLinkProducts = vi.fn();
    const database = databaseWithRole('admin', { bulkLinkProducts });

    const response = await dispatch('POST', `${BASE}/brands/bulk-link`, database, {
      productIds: [1],
      ...target,
    });

    expect(response?.status).toBe(422);
    expect(bulkLinkProducts).not.toHaveBeenCalled();
  });
});

describe('brand review query', () => {
  it.each([
    ['page=0', 'page=0'],
    ['pageSize=101', 'pageSize=101'],
    ['page together with a cursor', 'page=1&cursor=5'],
    ['titleMatch=equals', 'titleMatch=equals'],
    ['sort=newest', 'sort=newest'],
    ['a claimability state', 'state=CLAIMABLE'],
    ['another claimability state', 'state=NO_POLICY'],
  ])('answers 400 for %s and does not query', async (_label, query) => {
    const reviewBrands = vi.fn();
    const database = databaseWithRole('admin', { reviewBrands });

    const response = await dispatch('GET', `${BASE}/brand-review?${query}`, database);

    expect(response?.status).toBe(400);
    expect(reviewBrands).not.toHaveBeenCalled();
  });

  it('passes a valid numbered request through with its defaults', async () => {
    const reviewBrands = vi.fn().mockResolvedValue({ items: [], total: 0 });
    const database = databaseWithRole('admin', { reviewBrands });

    const response = await dispatch(
      'GET',
      `${BASE}/brand-review?state=PENDING_CONFIRMATION&page=2`,
      database,
    );

    expect(response?.status).toBe(200);
    expect(reviewBrands).toHaveBeenCalledWith(
      'org_123',
      expect.objectContaining({
        state: 'PENDING_CONFIRMATION',
        page: 2,
        pageSize: 50,
        titleMatch: 'contains',
        sort: 'titleAsc',
      }),
    );
  });
});

describe('brand, product and write-off routes: result mapping', () => {
  it("adds a brand, and answers 404 when the product or supplier is not the caller's", async () => {
    const addBrand = vi
      .fn()
      .mockResolvedValueOnce({ id: 9, name: 'New', supplierId: 5, source: 'USER_ADDED' })
      .mockResolvedValueOnce(null);
    const database = databaseWithRole('admin', { addBrand });
    const body = { productId: 3, name: ' New ', supplierId: 5 };

    const created = await dispatch('POST', `${BASE}/brands`, database, body);
    const refused = await dispatch('POST', `${BASE}/brands`, database, body);

    expect(created?.status).toBe(201);
    expect(addBrand).toHaveBeenCalledWith('org_123', 7, {
      productId: 3,
      name: 'New',
      supplierId: 5,
    });
    expect(refused?.status).toBe(404);
  });

  it.each([
    ['no name', { productId: 3, name: '  ' }],
    ['no product', { name: 'New' }],
    ['a non-numeric supplier', { productId: 3, name: 'New', supplierId: 'abc' }],
  ])('refuses to add a brand with %s', async (_label, body) => {
    const addBrand = vi.fn();
    const database = databaseWithRole('admin', { addBrand });

    const response = await dispatch('POST', `${BASE}/brands`, database, body);

    expect(response?.status).toBe(400);
    expect(addBrand).not.toHaveBeenCalled();
  });

  it("confirms a brand supplier, and answers 404 when either is not the caller's", async () => {
    const confirmBrandSupplier = vi
      .fn()
      .mockResolvedValueOnce({ id: 4, supplierId: 5, source: 'CONFIRMED' })
      .mockResolvedValueOnce(null);
    const database = databaseWithRole('admin', { confirmBrandSupplier });

    const confirmed = await dispatch('PUT', `${BASE}/brands/4/supplier`, database, {
      supplierId: 5,
    });
    const refused = await dispatch('PUT', `${BASE}/brands/4/supplier`, database, { supplierId: 5 });
    const invalid = await dispatch('PUT', `${BASE}/brands/4/supplier`, database, {
      supplierId: 'x',
    });

    expect(confirmed?.status).toBe(200);
    expect(confirmBrandSupplier).toHaveBeenCalledWith('org_123', 4, 5);
    expect(refused?.status).toBe(404);
    expect(invalid?.status).toBe(400);
    expect(confirmBrandSupplier).toHaveBeenCalledTimes(2);
  });

  it('assigns a product supplier, clears it with null, and answers 404 when refused', async () => {
    const assignProductSupplier = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const database = databaseWithRole('admin', { assignProductSupplier });
    const path = `${BASE}/products/9/supplier`;

    const assigned = await dispatch('PUT', path, database, { supplierId: 5 });
    const cleared = await dispatch('PUT', path, database, { supplierId: null });
    const refused = await dispatch('PUT', path, database, { supplierId: 5 });
    const invalid = await dispatch('PUT', path, database, { supplierId: 'abc' });

    expect(assigned?.status).toBe(200);
    expect(assignProductSupplier).toHaveBeenNthCalledWith(1, 'org_123', 7, 9, 5);
    expect(cleared?.status).toBe(200);
    expect(assignProductSupplier).toHaveBeenNthCalledWith(2, 'org_123', 7, 9, null);
    expect(refused?.status).toBe(404);
    expect(invalid?.status).toBe(400);
    expect(assignProductSupplier).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['DISPOSED', 200],
    ['ALREADY_DISPOSED', 200],
    ['CLAIMED', 409],
    ['NOT_FOUND', 404],
  ])('reports a dispose result of %s as %i', async (result, status) => {
    const disposeClaimableWriteOff = vi.fn().mockResolvedValue(result);
    const database = databaseWithRole('admin', { disposeClaimableWriteOff });

    const response = await dispatch('POST', `${BASE}/claimable-pool/12/dispose`, database);

    expect(response?.status).toBe(status);
    expect(disposeClaimableWriteOff).toHaveBeenCalledWith('org_123', 12);
  });
});

describe('catalogue correction review', () => {
  const path = '/api/platform/catalogue-corrections/3';

  it.each(['PENDING', 'accepted', '', 7, null])(
    'refuses %s as a review status, before the database is touched',
    async (status) => {
      const reviewCatalogueCorrection = vi.fn();
      const database = databaseWithRole('admin', { reviewCatalogueCorrection });

      const response = await dispatch('PATCH', path, database, { status });

      expect(response?.status).toBe(400);
      expect(reviewCatalogueCorrection).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['UPDATED', 200],
    ['ALREADY_REVIEWED', 409],
    ['NOT_FOUND', 404],
  ])('reports a review result of %s as %i', async (result, status) => {
    const reviewCatalogueCorrection = vi.fn().mockResolvedValue(result);
    const database = databaseWithRole('admin', { reviewCatalogueCorrection });

    const response = await dispatch('PATCH', path, database, { status: 'REJECTED' });

    expect(response?.status).toBe(status);
    expect(reviewCatalogueCorrection).toHaveBeenCalledWith(3, 'REJECTED');
  });
});
