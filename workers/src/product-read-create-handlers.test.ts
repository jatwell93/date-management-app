/**
 * Product read and create handlers (task 3.2, batch 6).
 *
 * Express tested these through `product.routes.test.ts` with a stubbed service. The Worker's
 * handlers call the database layer directly, so these tests drive the real routes with a stubbed
 * database and pin what the handler adds: the organization it passes down, the lookup keys it
 * decodes, the status it maps a missing or colliding row to, and the body it returns.
 *
 * Cross-tenant isolation of the queries themselves is real-SQL territory and lives in
 * `database.tenant-isolation.pglite.node.test.ts`. The update and delete routes are covered in
 * `minimal-api-routes.test.ts`.
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
const ENV = {} as Env;

const product = {
  id: 12,
  barcode: '12345678',
  sku: 'SKU-1',
  name: 'Tinned Tomatoes',
  costPrice: 1.5,
  notes: '',
};

function routes(): MinimalApiRoute[] {
  return (minimalEntrypoint as typeof minimalEntrypoint & { MINIMAL_API_ROUTES: MinimalApiRoute[] })
    .MINIMAL_API_ROUTES;
}

/** User 7 in `org_123`; `overrides` supply the product methods under test. */
function database(overrides: Partial<Record<keyof Database, unknown>> = {}): Database {
  return {
    ...overrides,
    sql: vi.fn((strings: TemplateStringsArray) =>
      strings.join(' ').includes('FROM users')
        ? Promise.resolve([{ id: 7, organizationId: 'org_123', role: 'admin' }])
        : Promise.resolve([]),
    ),
  } as unknown as Database;
}

function send(method: string, path: string, db: Database, body?: unknown) {
  return resolveMinimalApiRoute(routes(), {
    request: new Request(`https://example.com${path}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    pathname: path.split('?')[0],
    method,
    db,
    env: ENV,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mockedAuthenticateClerkRequest.mockResolvedValue({
    clerkUserId: 'user_clerk_123',
    email: 'user@example.com',
    username: 'user',
    organizationId: 'org_123',
    organizationRole: 'org:admin',
  });
});

describe('GET /api/products', () => {
  it('lists the products of the caller organization with the paging it was given', async () => {
    const findProducts = vi.fn().mockResolvedValue([product]);
    const countProducts = vi.fn().mockResolvedValue(41);

    const response = await send(
      'GET',
      '/api/products?search=tom&limit=5&offset=10',
      database({ findProducts, countProducts }),
    );

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({
      products: [product],
      total: 41,
      limit: 5,
      offset: 10,
    });
    expect(findProducts).toHaveBeenCalledWith('org_123', { search: 'tom', limit: 5, offset: 10 });
    expect(countProducts).toHaveBeenCalledWith('org_123', 'tom');
  });

  it('defaults to the first 100 products when no paging is given', async () => {
    const findProducts = vi.fn().mockResolvedValue([]);
    const countProducts = vi.fn().mockResolvedValue(0);

    const response = await send('GET', '/api/products', database({ findProducts, countProducts }));

    expect(await response?.json()).toEqual({ products: [], total: 0, limit: 100, offset: 0 });
    expect(findProducts).toHaveBeenCalledWith('org_123', {
      search: undefined,
      limit: 100,
      offset: 0,
    });
  });
});

describe.each([
  ['by-barcode', 'findProductByBarcode', '4011%2F1', '4011/1'],
  ['by-sku', 'findProductBySku', 'SKU%201', 'SKU 1'],
])('GET /api/products/%s/:key', (segment, method, encodedKey, decodedKey) => {
  it('looks the key up in the caller organization, decoding it first', async () => {
    const lookup = vi.fn().mockResolvedValue(product);

    const response = await send(
      'GET',
      `/api/products/${segment}/${encodedKey}`,
      database({ [method]: lookup }),
    );

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual(product);
    expect(lookup).toHaveBeenCalledWith('org_123', decodedKey);
  });

  it('answers 404 when the caller organization has no such product', async () => {
    const lookup = vi.fn().mockResolvedValue(null);

    const response = await send(
      'GET',
      `/api/products/${segment}/missing`,
      database({ [method]: lookup }),
    );

    expect(response?.status).toBe(404);
    expect(await response?.json()).toMatchObject({ error: 'Product not found' });
  });
});

describe('GET /api/products/:id', () => {
  it('returns the product when the caller organization owns it', async () => {
    const findProductById = vi.fn().mockResolvedValue(product);

    const response = await send('GET', '/api/products/12', database({ findProductById }));

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual(product);
    expect(findProductById).toHaveBeenCalledWith('org_123', 12);
  });

  it('answers 404 for a missing product, and for one owned by another organization', async () => {
    // The lookup is scoped by organization, so "owned by someone else" and "absent" are the
    // same null. Express answered 403 for the foreign one; the Worker deliberately does not,
    // because a 403 would confirm that a sequential id exists in another tenant.
    const findProductById = vi.fn().mockResolvedValue(null);

    const response = await send('GET', '/api/products/12', database({ findProductById }));

    expect(response?.status).toBe(404);
    expect(findProductById).toHaveBeenCalledWith('org_123', 12);
  });

  it('does not route a non-numeric id to the product lookup', async () => {
    const findProductById = vi.fn();

    const response = await send('GET', '/api/products/abc', database({ findProductById }));

    expect(findProductById).not.toHaveBeenCalled();
    expect(response?.status ?? 404).toBe(404);
  });
});

describe('POST /api/products', () => {
  const valid = { barcode: '12345678', sku: 'SKU-1', name: 'Tinned Tomatoes', costPrice: 1.5 };

  it('creates the product in the caller organization and answers 201 with it', async () => {
    const createProduct = vi.fn().mockResolvedValue(product);

    const response = await send('POST', '/api/products', database({ createProduct }), valid);

    expect(response?.status).toBe(201);
    expect(await response?.json()).toEqual(product);
    expect(createProduct).toHaveBeenCalledWith(
      'org_123',
      { barcode: '12345678', sku: 'SKU-1', name: 'Tinned Tomatoes', costPrice: 1.5, notes: '' },
      expect.anything(),
    );
  });

  it.each([
    ['barcode', { name: 'Tinned Tomatoes' }],
    ['name', { barcode: '12345678' }],
  ])('answers 400 when %s is absent', async (field, body) => {
    const createProduct = vi.fn();

    const response = await send('POST', '/api/products', database({ createProduct }), body);

    expect(response?.status).toBe(400);
    expect(await response?.json()).toMatchObject({ error: `Missing required field: ${field}` });
    expect(createProduct).not.toHaveBeenCalled();
  });

  it('answers 409 when the barcode or SKU already exists in the organization', async () => {
    const createProduct = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('dup'), { code: '23505' }));

    const response = await send('POST', '/api/products', database({ createProduct }), valid);

    expect(response?.status).toBe(409);
  });

  it('answers 500 with a fixed body when the database fails, without leaking the cause', async () => {
    const createProduct = vi.fn().mockRejectedValue(new Error('connection reset: secret-host'));

    const response = await send('POST', '/api/products', database({ createProduct }), valid);

    expect(response?.status).toBe(500);
    expect(JSON.stringify(await response?.json())).not.toContain('secret-host');
  });

  it('answers 401 before any database work when the request is not authenticated', async () => {
    mockedAuthenticateClerkRequest.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }) as never,
    );
    const createProduct = vi.fn();

    const response = await send('POST', '/api/products', database({ createProduct }), valid);

    expect(response?.status).toBe(401);
    expect(createProduct).not.toHaveBeenCalled();
  });
});
