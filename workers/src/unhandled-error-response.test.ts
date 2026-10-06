/**
 * The Worker's top-level catch (task 3.2, batch 5).
 *
 * Express tested "returns 500 when X fails" once per route, because each controller had its
 * own try/catch. The Worker's route handlers mostly have none: a thrown error reaches one
 * shared catch in `fetch`, which logs it and answers 500 with a fixed body. This drives the
 * real `fetch` with a database that throws, so the 500 rows can point at one test that sees the
 * whole path (authentication, routing, the catch) instead of one per route.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticateClerkRequest } from './clerk/bootstrap-handler';
import type { Env } from './types/env';

vi.mock('./clerk/bootstrap-handler', () => ({
  authenticateClerkRequest: vi.fn(),
  getClerkAuthorizedParties: vi.fn(() => []),
  handleOrganizationBootstrap: vi.fn().mockResolvedValue(new Response('bootstrap')),
}));

const database = vi.hoisted(() => ({
  findInventoryItems: vi.fn(),
  countInventoryItems: vi.fn(),
  sql: vi.fn(),
}));

vi.mock('./database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./database')>()),
  createWorkersDatabase: vi.fn(() => database),
}));

import worker from './index-minimal';

const mockedAuthenticateClerkRequest = vi.mocked(authenticateClerkRequest);

const ENV = {
  NODE_ENV: 'production',
  JWT_SECRET: 'test-secret',
  NEON_CONNECTION_STRING: 'postgres://test',
  CLERK_SECRET_KEY: 'sk_test_dummy',
} as unknown as Env;

const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;

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
  database.sql.mockImplementation((strings: TemplateStringsArray) =>
    strings.join('').includes('FROM subscription_tiers')
      ? Promise.resolve([{ tier_level: 'free', status: 'active' }])
      : Promise.resolve([{ id: 7, organizationId: 'org_123', role: 'admin' }]),
  );
});

describe('an error thrown inside a route handler', () => {
  it('answers 500 with a fixed message that carries no error detail', async () => {
    database.findInventoryItems.mockRejectedValue(new Error('relation "secret_table" is locked'));
    database.countInventoryItems.mockResolvedValue(0);

    const response = await worker.fetch(
      new Request('https://example.com/api/inventory-items', {
        headers: { Authorization: 'Bearer token' },
      }),
      ENV,
      ctx,
    );

    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).toContain('Internal Server Error');
    expect(text).not.toContain('secret_table');
  });

  it('answers 200 for the same route when the read succeeds, so the 500 is the catch and not the route', async () => {
    database.findInventoryItems.mockResolvedValue([]);
    database.countInventoryItems.mockResolvedValue(0);

    const response = await worker.fetch(
      new Request('https://example.com/api/inventory-items', {
        headers: { Authorization: 'Bearer token' },
      }),
      ENV,
      ctx,
    );

    expect(response.status).toBe(200);
  });
});
