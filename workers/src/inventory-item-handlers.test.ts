/**
 * Request validation and result mapping for the inventory item routes (task 3.2, batch 5).
 *
 * Express tested these through `inventory.routes.test.ts` with a stubbed service. The Worker
 * validates inside the route handlers and the database methods answer with a row, `null`,
 * `false` or a thrown reference error that the handler maps to a status. These tests drive
 * the real routes with a stubbed database, so they pin what the handlers own: which request is
 * refused with which status before the database is written, and how each database result is
 * reported. What the database does with the input is tested against real SQL in
 * `database.inventory-reads-and-status.pglite.node.test.ts`, `database.tenant-isolation*` and
 * `database.inventory-duplicate-guard.pglite.node.test.ts`.
 *
 * Express routes with no Worker route (`GET /:id`, `/product/:id`, `/location/:id`,
 * `POST /transaction`) were retired in the 2.1 route matrix; the second describe below pins that
 * they are not served, so a reviewer can see the retirement is the Worker's actual behaviour.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveMinimalApiRoute, type MinimalApiRoute } from './minimal-api-routes';
import * as minimalEntrypoint from './index-minimal';
import { authenticateClerkRequest } from './clerk/bootstrap-handler';
import { REFERENTIAL_ERRORS } from './tenant-references';
import { DuplicateInventoryItemError } from './db-errors';
import type { Database } from './database';
import type { Env } from './types/env';

vi.mock('./clerk/bootstrap-handler', () => ({
  authenticateClerkRequest: vi.fn(),
  getClerkAuthorizedParties: vi.fn(() => []),
  handleOrganizationBootstrap: vi.fn().mockResolvedValue(new Response('bootstrap')),
}));

const mockedAuthenticateClerkRequest = vi.mocked(authenticateClerkRequest);
const ENV = {} as Env;
const USER_ID = 7;
const ORG = 'org_123';

function routes(): MinimalApiRoute[] {
  return (minimalEntrypoint as typeof minimalEntrypoint & { MINIMAL_API_ROUTES: MinimalApiRoute[] })
    .MINIMAL_API_ROUTES;
}

/** A database with user 7 in `org_123`, on the free tier, plus the methods under test. */
function database(methods: Partial<Record<keyof Database, unknown>> = {}): Database {
  return {
    ...methods,
    sql: vi.fn((strings: TemplateStringsArray) =>
      strings.join('').includes('FROM subscription_tiers')
        ? Promise.resolve([{ tier_level: 'free', status: 'active' }])
        : Promise.resolve([{ id: USER_ID, organizationId: ORG, role: 'admin' }]),
    ),
  } as unknown as Database;
}

function dispatch(method: string, pathAndQuery: string, db: Database, body?: unknown) {
  const [pathname] = pathAndQuery.split('?');
  return resolveMinimalApiRoute(routes(), {
    request: new Request(`https://example.com${pathAndQuery}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    pathname,
    method,
    db,
    env: ENV,
  });
}

const item = { id: 11, productId: 3, expiryDate: '2099-06-01', locationId: 4, status: 'Normal' };
const validCreate = { productId: 3, expiryDate: '2099-06-01', locationId: 4 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  mockedAuthenticateClerkRequest.mockResolvedValue({
    clerkUserId: 'user_clerk_123',
    email: 'user@example.com',
    username: 'user',
    organizationId: ORG,
    organizationRole: 'org:admin',
  });
});

describe('GET /api/inventory-items', () => {
  it('lists the caller organization with the default page and the total', async () => {
    const findInventoryItems = vi.fn().mockResolvedValue([item]);
    const countInventoryItems = vi.fn().mockResolvedValue(41);

    const response = await dispatch(
      'GET',
      '/api/inventory-items',
      database({ findInventoryItems, countInventoryItems }),
    );

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual({
      items: [item],
      total: 41,
      limit: 100,
      offset: 0,
    });
    expect(findInventoryItems).toHaveBeenCalledWith(ORG, { limit: 100, offset: 0 });
    expect(countInventoryItems).toHaveBeenCalledWith(ORG);
  });

  it('passes the requested limit and offset through', async () => {
    const findInventoryItems = vi.fn().mockResolvedValue([]);

    await dispatch(
      'GET',
      '/api/inventory-items?limit=10&offset=30',
      database({ findInventoryItems, countInventoryItems: vi.fn().mockResolvedValue(0) }),
    );

    expect(findInventoryItems).toHaveBeenCalledWith(ORG, { limit: 10, offset: 30 });
  });
});

describe('GET /api/inventory-items/by-barcode/:barcode', () => {
  it('answers 404 when the barcode names no product, without reading inventory', async () => {
    const findInventoryItemsByProductId = vi.fn();

    const response = await dispatch(
      'GET',
      '/api/inventory-items/by-barcode/0000',
      database({
        findProductByBarcode: vi.fn().mockResolvedValue(null),
        findInventoryItemsByProductId,
      }),
    );

    expect(response?.status).toBe(404);
    expect(findInventoryItemsByProductId).not.toHaveBeenCalled();
  });

  it('looks the barcode up in the caller organization and lists that product items', async () => {
    const findProductByBarcode = vi.fn().mockResolvedValue({ id: 3 });
    const findInventoryItemsByProductId = vi.fn().mockResolvedValue([item]);

    const response = await dispatch(
      'GET',
      '/api/inventory-items/by-barcode/BAR%2F1',
      database({ findProductByBarcode, findInventoryItemsByProductId }),
    );

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual([item]);
    expect(findProductByBarcode).toHaveBeenCalledWith(ORG, 'BAR/1');
    expect(findInventoryItemsByProductId).toHaveBeenCalledWith(ORG, 3);
  });
});

describe('GET /api/inventory-items/recent/product/:productId', () => {
  const recent = (
    query: string,
    findRecentInventoryItemsByProductId = vi.fn().mockResolvedValue([]),
  ) => ({
    call: dispatch(
      'GET',
      `/api/inventory-items/recent/product/3${query}`,
      database({ findRecentInventoryItemsByProductId }),
    ),
    findRecentInventoryItemsByProductId,
  });

  it.each([
    ['no limit', '', 5],
    ['a zero limit', '?limit=0', 5],
    ['a negative limit', '?limit=-4', 5],
    ['a limit that is not a number', '?limit=abc', 5],
    ['a limit of 7', '?limit=7', 7],
    ['a limit above the ceiling', '?limit=500', 50],
  ])('uses the right page size for %s', async (_label, query, expected) => {
    const { call, findRecentInventoryItemsByProductId } = recent(query);

    const response = await call;

    expect(response?.status).toBe(200);
    expect(findRecentInventoryItemsByProductId).toHaveBeenCalledWith(ORG, 3, expected);
  });

  it('does not serve a product id that is not a number', async () => {
    const findRecentInventoryItemsByProductId = vi.fn();

    const response = await dispatch(
      'GET',
      '/api/inventory-items/recent/product/abc',
      database({ findRecentInventoryItemsByProductId }),
    );

    expect(response?.status ?? 404).toBe(404);
    expect(findRecentInventoryItemsByProductId).not.toHaveBeenCalled();
  });
});

describe('POST /api/inventory-items', () => {
  it.each([
    ['no productId', { expiryDate: '2099-06-01', locationId: 4 }],
    ['a productId of 0', { ...validCreate, productId: 0 }],
    ['a fractional productId', { ...validCreate, productId: 1.5 }],
    ['no expiryDate', { productId: 3, locationId: 4 }],
    ['an expiryDate that is not YYYY-MM-DD', { ...validCreate, expiryDate: '01/06/2099' }],
    ['no locationId', { productId: 3, expiryDate: '2099-06-01' }],
    ['a locationId of 0', { ...validCreate, locationId: 0 }],
  ])('answers 400 for %s and writes nothing', async (_label, body) => {
    const createInventoryItem = vi.fn();

    const response = await dispatch(
      'POST',
      '/api/inventory-items',
      database({ createInventoryItem }),
      body,
    );

    expect(response?.status).toBe(400);
    expect(createInventoryItem).not.toHaveBeenCalled();
  });

  it('creates the item for the caller organization and user, and answers 201', async () => {
    const createInventoryItem = vi.fn().mockResolvedValue(item);

    const response = await dispatch(
      'POST',
      '/api/inventory-items',
      database({ createInventoryItem }),
      {
        ...validCreate,
        organizationId: 'org_other',
      },
    );

    expect(response?.status).toBe(201);
    await expect(response?.json()).resolves.toEqual(item);
    expect(createInventoryItem).toHaveBeenCalledWith(
      ORG,
      USER_ID,
      { productId: 3, expiryDate: '2099-06-01', locationId: 4, status: undefined },
      expect.any(Number),
    );
  });

  it('still accepts the deprecated snake_case field names', async () => {
    const createInventoryItem = vi.fn().mockResolvedValue(item);

    const response = await dispatch(
      'POST',
      '/api/inventory-items',
      database({ createInventoryItem }),
      {
        product_id: 3,
        expiry_date: '2099-06-01',
        location_id: 4,
      },
    );

    expect(response?.status).toBe(201);
    expect(createInventoryItem.mock.calls[0][2]).toMatchObject({
      productId: 3,
      expiryDate: '2099-06-01',
      locationId: 4,
    });
  });

  it.each([
    ['a location outside the organization', REFERENTIAL_ERRORS.location],
    ['a product outside the organization', REFERENTIAL_ERRORS.product],
  ])('answers 400 for %s', async (_label, message) => {
    const createInventoryItem = vi.fn().mockRejectedValue(new Error(message));

    const response = await dispatch(
      'POST',
      '/api/inventory-items',
      database({ createInventoryItem }),
      validCreate,
    );

    expect(response?.status).toBe(400);
    await expect(response?.json()).resolves.toMatchObject({ error: message });
  });

  it('answers 409 for a duplicate active item', async () => {
    const createInventoryItem = vi.fn().mockRejectedValue(new DuplicateInventoryItemError());

    const response = await dispatch(
      'POST',
      '/api/inventory-items',
      database({ createInventoryItem }),
      validCreate,
    );

    expect(response?.status).toBe(409);
  });

  it('answers 500, with no error detail, for an unexpected failure', async () => {
    const createInventoryItem = vi.fn().mockRejectedValue(new Error('connection reset by peer'));

    const response = await dispatch(
      'POST',
      '/api/inventory-items',
      database({ createInventoryItem }),
      validCreate,
    );

    expect(response?.status).toBe(500);
    expect(JSON.stringify(await response?.json())).not.toContain('connection reset');
  });
});

describe('PUT /api/inventory-items/:id', () => {
  const put = (
    path: string,
    body: unknown,
    methods: Partial<Record<keyof Database, unknown>> = {},
  ) => dispatch('PUT', path, database(methods), body);

  it.each([
    ['a fractional productId', { productId: 1.5 }],
    ['a fractional locationId', { locationId: 2.5 }],
    ['an expiryDate that is not YYYY-MM-DD', { expiryDate: 'tomorrow' }],
  ])('answers 400 for %s and writes nothing', async (_label, body) => {
    const updateInventoryItem = vi.fn();

    const response = await put('/api/inventory-items/11', body, { updateInventoryItem });

    expect(response?.status).toBe(400);
    expect(updateInventoryItem).not.toHaveBeenCalled();
  });

  it('answers 400 for an id of 0', async () => {
    const updateInventoryItem = vi.fn();

    const response = await put(
      '/api/inventory-items/0',
      { status: 'Normal' },
      { updateInventoryItem },
    );

    expect(response?.status).toBe(400);
    expect(updateInventoryItem).not.toHaveBeenCalled();
  });

  it('does not serve an id that is not a number', async () => {
    const updateInventoryItem = vi.fn();

    const response = await put(
      '/api/inventory-items/abc',
      { status: 'Normal' },
      { updateInventoryItem },
    );

    expect(response?.status ?? 404).toBe(404);
    expect(updateInventoryItem).not.toHaveBeenCalled();
  });

  it('updates every mutable field for the caller organization and user', async () => {
    const updateInventoryItem = vi.fn().mockResolvedValue(item);

    const response = await put(
      '/api/inventory-items/11',
      { productId: 3, expiryDate: '2099-07-01', locationId: 5, status: 'Markdown 1' },
      { updateInventoryItem },
    );

    expect(response?.status).toBe(200);
    expect(updateInventoryItem).toHaveBeenCalledWith(ORG, USER_ID, 11, {
      productId: 3,
      expiryDate: '2099-07-01',
      locationId: 5,
      status: 'Markdown 1',
    });
  });

  it('passes only the fields a partial payload names', async () => {
    const updateInventoryItem = vi.fn().mockResolvedValue(item);

    await put('/api/inventory-items/11', { locationId: 5 }, { updateInventoryItem });

    expect(updateInventoryItem).toHaveBeenCalledWith(ORG, USER_ID, 11, {
      productId: undefined,
      expiryDate: undefined,
      locationId: 5,
      status: undefined,
    });
  });

  it('answers 404 when the item is missing or belongs to another organization', async () => {
    const response = await put(
      '/api/inventory-items/11',
      { status: 'Normal' },
      { updateInventoryItem: vi.fn().mockResolvedValue(null) },
    );

    expect(response?.status).toBe(404);
  });

  it.each([
    ['a location outside the organization', REFERENTIAL_ERRORS.location],
    ['a product outside the organization', REFERENTIAL_ERRORS.product],
  ])('answers 400 for %s', async (_label, message) => {
    const response = await put(
      '/api/inventory-items/11',
      { locationId: 99 },
      { updateInventoryItem: vi.fn().mockRejectedValue(new Error(message)) },
    );

    expect(response?.status).toBe(400);
  });

  it('answers 500, with no error detail, for an unexpected failure', async () => {
    const response = await put(
      '/api/inventory-items/11',
      { status: 'Normal' },
      { updateInventoryItem: vi.fn().mockRejectedValue(new Error('connection reset by peer')) },
    );

    expect(response?.status).toBe(500);
    expect(JSON.stringify(await response?.json())).not.toContain('connection reset');
  });
});

describe('DELETE /api/inventory-items/:id', () => {
  it('answers 400 for an id of 0 and deletes nothing', async () => {
    const deleteInventoryItem = vi.fn();

    const response = await dispatch(
      'DELETE',
      '/api/inventory-items/0',
      database({ deleteInventoryItem }),
    );

    expect(response?.status).toBe(400);
    expect(deleteInventoryItem).not.toHaveBeenCalled();
  });

  it('answers 404 when the item is missing or belongs to another organization', async () => {
    const response = await dispatch(
      'DELETE',
      '/api/inventory-items/11',
      database({ deleteInventoryItem: vi.fn().mockResolvedValue(false) }),
    );

    expect(response?.status).toBe(404);
  });

  it('deletes within the caller organization and answers 200', async () => {
    const deleteInventoryItem = vi.fn().mockResolvedValue(true);

    const response = await dispatch(
      'DELETE',
      '/api/inventory-items/11',
      database({ deleteInventoryItem }),
    );

    expect(response?.status).toBe(200);
    expect(deleteInventoryItem).toHaveBeenCalledWith(ORG, USER_ID, 11);
  });
});

describe('Express inventory routes retired in the 2.1 route matrix', () => {
  it.each([
    ['GET', '/api/inventory-items/11'],
    ['GET', '/api/inventory-items/product/3'],
    ['GET', '/api/inventory-items/location/4'],
    ['POST', '/api/inventory-items/transaction'],
  ])('does not serve %s %s', async (method, path) => {
    const response = await dispatch(method, path, database(), method === 'POST' ? {} : undefined);

    expect(response?.status ?? 404).toBe(404);
  });
});
