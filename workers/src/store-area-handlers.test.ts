/**
 * Store area write handlers and the store-walk request rules (task 3.2, batch 6).
 *
 * Express tested these through `store-area.routes.test.ts` (schema checks and error mapping)
 * with a stubbed service. The Worker validates in the handler and maps the database layer's
 * thrown errors to a status, so these tests drive the real routes with a stubbed database.
 * The SQL itself (tenant scoping, duplicates, the walk lifecycle) is covered with real SQL in
 * `database.tenant-isolation-writes.pglite.node.test.ts` and `database.store-walk.pglite.node.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveMinimalApiRoute, type MinimalApiRoute } from './minimal-api-routes';
import * as minimalEntrypoint from './index-minimal';
import { authenticateClerkRequest } from './clerk/bootstrap-handler';
import { DuplicateStoreAreaError } from './db-errors';
import type { Database } from './database';
import type { Env } from './types/env';

vi.mock('./clerk/bootstrap-handler', () => ({
  authenticateClerkRequest: vi.fn(),
  getClerkAuthorizedParties: vi.fn(() => []),
  handleOrganizationBootstrap: vi.fn().mockResolvedValue(new Response('bootstrap')),
}));

const mockedAuthenticateClerkRequest = vi.mocked(authenticateClerkRequest);
const ENV = {} as Env;

function routes(): MinimalApiRoute[] {
  return (minimalEntrypoint as typeof minimalEntrypoint & { MINIMAL_API_ROUTES: MinimalApiRoute[] })
    .MINIMAL_API_ROUTES;
}

/** User 7, an admin of `org_123`, plus the methods under test. */
function database(methods: Partial<Record<keyof Database, unknown>> = {}): Database {
  return {
    ...methods,
    sql: vi.fn((strings: TemplateStringsArray) =>
      strings.join('').includes('FROM users')
        ? Promise.resolve([{ id: 7, organizationId: 'org_123', role: 'admin' }])
        : Promise.resolve([]),
    ),
  } as unknown as Database;
}

function send(method: string, pathname: string, db: Database, body?: unknown) {
  return resolveMinimalApiRoute(routes(), {
    request: new Request(`https://example.com${pathname}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    pathname,
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

describe('POST /api/store-areas', () => {
  it('creates the area in the caller organization, trimming the name, and answers 201', async () => {
    const area = { id: 3, name: 'Aisle 1', subDepartment: 'Dairy', parentId: null };
    const createStoreArea = vi.fn().mockResolvedValue(area);

    const response = await send('POST', '/api/store-areas', database({ createStoreArea }), {
      name: '  Aisle 1  ',
      sub_department: 'Dairy',
    });

    expect(response?.status).toBe(201);
    expect(await response?.json()).toEqual(area);
    expect(createStoreArea).toHaveBeenCalledWith('org_123', {
      name: 'Aisle 1',
      subDepartment: 'Dairy',
      parentId: null,
    });
  });

  it.each([{}, { name: '' }, { name: '   ' }, { name: 5 }])(
    'answers 400 for the body %j, before any write',
    async (body) => {
      const createStoreArea = vi.fn();

      const response = await send('POST', '/api/store-areas', database({ createStoreArea }), body);

      expect(response?.status).toBe(400);
      expect(createStoreArea).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['a duplicate name and sub-department', new DuplicateStoreAreaError()],
    [
      'a unique violation from a concurrent create',
      Object.assign(new Error('dup'), { code: '23505' }),
    ],
  ])('answers 409 for %s', async (_label, error) => {
    const createStoreArea = vi.fn().mockRejectedValue(error);

    const response = await send('POST', '/api/store-areas', database({ createStoreArea }), {
      name: 'Aisle 1',
    });

    expect(response?.status).toBe(409);
  });
});

describe('PUT /api/store-areas/:id', () => {
  it('answers 409, not 500, when the rename collides with another area', async () => {
    const updateStoreArea = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('dup'), { code: '23505' }));

    const response = await send('PUT', '/api/store-areas/3', database({ updateStoreArea }), {
      name: 'Aisle 1',
    });

    expect(response?.status).toBe(409);
  });

  it('answers 404 when the area is missing or belongs to another organization', async () => {
    const updateStoreArea = vi.fn().mockResolvedValue(null);

    const response = await send('PUT', '/api/store-areas/3', database({ updateStoreArea }), {
      name: 'Aisle 1',
    });

    expect(response?.status).toBe(404);
    expect(updateStoreArea).toHaveBeenCalledWith('org_123', 3, { name: 'Aisle 1' });
  });
});

describe('POST /api/store-areas/check-cycles', () => {
  it.each([{}, { name: '' }, { name: '  ' }])(
    'answers 400 for the body %j, before any write',
    async (body) => {
      const createCheckCycle = vi.fn();

      const response = await send(
        'POST',
        '/api/store-areas/check-cycles',
        database({ createCheckCycle }),
        body,
      );

      expect(response?.status).toBe(400);
      expect(createCheckCycle).not.toHaveBeenCalled();
    },
  );

  it('answers 409 when a walk is already active', async () => {
    const createCheckCycle = vi
      .fn()
      .mockRejectedValue(new Error('Active check cycle already exists'));

    const response = await send(
      'POST',
      '/api/store-areas/check-cycles',
      database({ createCheckCycle }),
      { name: 'Monday walk' },
    );

    expect(response?.status).toBe(409);
  });
});

describe('POST /api/store-areas/bay-checks', () => {
  const post = (body: unknown, db: Database) =>
    send('POST', '/api/store-areas/bay-checks', db, body);

  it.each([
    {},
    { storeAreaId: 0 },
    { storeAreaId: -4 },
    { storeAreaId: 1.5 },
    { storeAreaId: '3' },
  ])('answers 400 for the body %j, before any write', async (body) => {
    const recordBayCheck = vi.fn();

    const response = await post(body, database({ recordBayCheck }));

    expect(response?.status).toBe(400);
    expect(recordBayCheck).not.toHaveBeenCalled();
  });

  it('records the check for the caller organization and user, accepting snake_case', async () => {
    const recordBayCheck = vi.fn().mockResolvedValue({ id: 5 });

    const response = await post(
      { store_area_id: 3, items_added_count: 2 },
      database({ recordBayCheck }),
    );

    expect(response?.status).toBe(201);
    expect(recordBayCheck).toHaveBeenCalledWith(
      'org_123',
      7,
      expect.objectContaining({ storeAreaId: 3, itemsAddedCount: 2 }),
    );
  });

  it.each([
    ['there is no active walk', 'Active check cycle is required', 409],
    ['the target is not a leaf bay', 'Bay check must target a leaf bay', 400],
  ])('answers %s with %d', async (_label, message, status) => {
    const recordBayCheck = vi.fn().mockRejectedValue(new Error(message));

    const response = await post({ storeAreaId: 3 }, database({ recordBayCheck }));

    expect(response?.status).toBe(status);
  });
});
