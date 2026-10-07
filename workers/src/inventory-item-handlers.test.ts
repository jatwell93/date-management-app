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

// Inside the five-year horizon the routes enforce, and moving with the clock.
const daysAhead = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const FUTURE_DATE = daysAhead(365);
const LATER_DATE = daysAhead(395);
const item = { id: 11, productId: 3, expiryDate: FUTURE_DATE, locationId: 4, status: 'Normal' };
const validCreate = { productId: 3, expiryDate: FUTURE_DATE, locationId: 4 };

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
});

describe('requests refused before any write', () => {
  const putBody = { status: 'Normal' };
  it.each([
    [
      'POST with no productId',
      'POST',
      '/api/inventory-items',
      { expiryDate: FUTURE_DATE, locationId: 4 },
      'createInventoryItem',
      400,
    ],
    [
      'POST with a productId of 0',
      'POST',
      '/api/inventory-items',
      { ...validCreate, productId: 0 },
      'createInventoryItem',
      400,
    ],
    [
      'POST with a fractional productId',
      'POST',
      '/api/inventory-items',
      { ...validCreate, productId: 1.5 },
      'createInventoryItem',
      400,
    ],
    [
      'POST with no expiryDate',
      'POST',
      '/api/inventory-items',
      { productId: 3, locationId: 4 },
      'createInventoryItem',
      400,
    ],
    [
      'POST with an expiryDate that is not YYYY-MM-DD',
      'POST',
      '/api/inventory-items',
      { ...validCreate, expiryDate: '01/06/2099' },
      'createInventoryItem',
      400,
    ],
    [
      'POST with no locationId',
      'POST',
      '/api/inventory-items',
      { productId: 3, expiryDate: FUTURE_DATE },
      'createInventoryItem',
      400,
    ],
    [
      'POST with a locationId of 0',
      'POST',
      '/api/inventory-items',
      { ...validCreate, locationId: 0 },
      'createInventoryItem',
      400,
    ],
    [
      'PUT with a fractional productId',
      'PUT',
      '/api/inventory-items/11',
      { productId: 1.5 },
      'updateInventoryItem',
      400,
    ],
    [
      'PUT with a fractional locationId',
      'PUT',
      '/api/inventory-items/11',
      { locationId: 2.5 },
      'updateInventoryItem',
      400,
    ],
    [
      'PUT with an expiryDate that is not YYYY-MM-DD',
      'PUT',
      '/api/inventory-items/11',
      { expiryDate: 'tomorrow' },
      'updateInventoryItem',
      400,
    ],
    ['PUT with an id of 0', 'PUT', '/api/inventory-items/0', putBody, 'updateInventoryItem', 400],
    [
      'PUT with an id that is not a number (not served)',
      'PUT',
      '/api/inventory-items/abc',
      putBody,
      'updateInventoryItem',
      404,
    ],
    [
      'DELETE with an id of 0',
      'DELETE',
      '/api/inventory-items/0',
      undefined,
      'deleteInventoryItem',
      400,
    ],
    [
      'GET recent with a product id that is not a number (not served)',
      'GET',
      '/api/inventory-items/recent/product/abc',
      undefined,
      'findRecentInventoryItemsByProductId',
      404,
    ],
  ])('refuses before any write: %s', async (_label, method, path, body, writeMethod, status) => {
    const write = vi.fn();

    const response = await dispatch(method, path, database({ [writeMethod]: write }), body);

    expect(response?.status ?? 404).toBe(status);
    expect(write).not.toHaveBeenCalled();
  });
});

describe('POST /api/inventory-items', () => {
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
      { productId: 3, expiryDate: FUTURE_DATE, locationId: 4, status: undefined },
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
        expiry_date: FUTURE_DATE,
        location_id: 4,
      },
    );

    expect(response?.status).toBe(201);
    expect(createInventoryItem.mock.calls[0][2]).toMatchObject({
      productId: 3,
      expiryDate: FUTURE_DATE,
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

  it('answers 400 for an expiry date more than five years out, before any write', async () => {
    // Task 3.2 batch 6. Express: "rejects expiry date more than 5 years out".
    const createInventoryItem = vi.fn();

    const response = await dispatch(
      'POST',
      '/api/inventory-items',
      database({ createInventoryItem }),
      { ...validCreate, expiryDate: daysAhead(365 * 5 + 10) },
    );

    expect(response?.status).toBe(400);
    await expect(response?.json()).resolves.toMatchObject({
      error: 'Expiry date cannot be more than 5 years in the future',
    });
    expect(createInventoryItem).not.toHaveBeenCalled();
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

  it('updates every mutable field for the caller organization and user', async () => {
    const updateInventoryItem = vi.fn().mockResolvedValue(item);

    const response = await put(
      '/api/inventory-items/11',
      { productId: 3, expiryDate: LATER_DATE, locationId: 5, status: 'Markdown 1' },
      { updateInventoryItem },
    );

    expect(response?.status).toBe(200);
    expect(updateInventoryItem).toHaveBeenCalledWith(ORG, USER_ID, 11, {
      productId: 3,
      expiryDate: LATER_DATE,
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

  it('answers 400 for an edited expiry date more than five years out, before any write', async () => {
    const updateInventoryItem = vi.fn();

    const response = await put(
      '/api/inventory-items/11',
      { expiryDate: daysAhead(365 * 5 + 10) },
      { updateInventoryItem },
    );

    expect(response?.status).toBe(400);
    expect(updateInventoryItem).not.toHaveBeenCalled();
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
