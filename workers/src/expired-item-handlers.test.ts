/**
 * `POST /api/expired-items/process` (task 3.2, batch 6).
 *
 * Express tested the request rules and the status mapping through `expired-item.routes.test.ts`
 * with a stubbed service. The Worker validates the body in the handler and maps the database
 * layer's thrown messages to a status, so these tests drive the real route with a stubbed
 * database. The database layer itself (tenant scoping, the ledger, the uncapped write-off of
 * issue #268) is covered with real SQL in `database.disposition.pglite.node.test.ts`.
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

function routes(): MinimalApiRoute[] {
  return (minimalEntrypoint as typeof minimalEntrypoint & { MINIMAL_API_ROUTES: MinimalApiRoute[] })
    .MINIMAL_API_ROUTES;
}

/** User 7 in `org_123`, plus the methods under test. */
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

function processItem(body: unknown, db: Database) {
  return resolveMinimalApiRoute(routes(), {
    request: new Request('https://example.com/api/expired-items/process', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    pathname: '/api/expired-items/process',
    method: 'POST',
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

describe('POST /api/expired-items/process: requests refused before any write', () => {
  it.each([
    ['no inventoryItemId', { action: 'sold_through' }],
    ['an inventoryItemId of 0', { inventoryItemId: 0, action: 'sold_through' }],
    ['a string inventoryItemId', { inventoryItemId: '5', action: 'sold_through' }],
    ['an action outside the vocabulary', { inventoryItemId: 5, action: 'binned' }],
    ['no action', { inventoryItemId: 5 }],
    ['an expired action with no unitsDiscarded', { inventoryItemId: 5, action: 'expired' }],
    [
      'an expired action with 0 units',
      { inventoryItemId: 5, action: 'expired', unitsDiscarded: 0 },
    ],
    [
      'an expired action with negative units',
      { inventoryItemId: 5, action: 'expired', unitsDiscarded: -2 },
    ],
    [
      'an expired action with a fractional unit count',
      { inventoryItemId: 5, action: 'expired', unitsDiscarded: 1.5 },
    ],
  ])('answers 400 for %s', async (_label, body) => {
    const processExpiredItem = vi.fn();

    const response = await processItem(body, database({ processExpiredItem }));

    expect(response?.status).toBe(400);
    expect(processExpiredItem).not.toHaveBeenCalled();
  });
});

describe('POST /api/expired-items/process: the write', () => {
  it('writes off expired units for the caller organization and user, and answers 201', async () => {
    const ledgerRow = { id: 1, inventoryItemId: 5, action: 'expired', unitsDiscarded: 3 };
    const processExpiredItem = vi.fn().mockResolvedValue(ledgerRow);

    const response = await processItem(
      { inventoryItemId: 5, action: 'expired', unitsDiscarded: 3 },
      database({ processExpiredItem }),
    );

    expect(response?.status).toBe(201);
    expect(await response?.json()).toEqual(ledgerRow);
    expect(processExpiredItem).toHaveBeenCalledWith(5, 7, 'org_123', 'expired', 3);
  });

  it('records a sale without a unit count, ignoring one the caller sends', async () => {
    const processExpiredItem = vi.fn().mockResolvedValue({ id: 2 });

    const response = await processItem(
      { inventoryItemId: 5, action: 'sold_through', unitsDiscarded: 9 },
      database({ processExpiredItem }),
    );

    expect(response?.status).toBe(201);
    expect(processExpiredItem).toHaveBeenCalledWith(5, 7, 'org_123', 'sold_through', undefined);
  });

  it('answers 404 when the inventory item is not found', async () => {
    const processExpiredItem = vi.fn().mockRejectedValue(new Error('Inventory item 5 not found'));

    const response = await processItem(
      { inventoryItemId: 5, action: 'sold_through' },
      database({ processExpiredItem }),
    );

    expect(response?.status).toBe(404);
  });

  it('answers 400, with the reason, when the database layer refuses the quantity', async () => {
    const processExpiredItem = vi
      .fn()
      .mockRejectedValue(new Error('Cannot discard 9 units; only 2 expired units are available'));

    const response = await processItem(
      { inventoryItemId: 5, action: 'expired', unitsDiscarded: 9 },
      database({ processExpiredItem }),
    );

    expect(response?.status).toBe(400);
    expect(await response?.json()).toMatchObject({
      error: expect.stringContaining('Cannot discard'),
    });
  });

  it('answers 500 with a fixed body for an unexpected failure, without leaking the cause', async () => {
    const processExpiredItem = vi
      .fn()
      .mockRejectedValue(new Error('connection reset: secret-host'));

    const response = await processItem(
      { inventoryItemId: 5, action: 'sold_through' },
      database({ processExpiredItem }),
    );

    expect(response?.status).toBe(500);
    expect(JSON.stringify(await response?.json())).not.toContain('secret-host');
  });
});
