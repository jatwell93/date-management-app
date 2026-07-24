/**
 * Real-data (pglite) coverage for the Clerk organization bootstrap handler.
 *
 * Exercises the reordered `handleOrganizationBootstrap` flow end-to-end against an
 * in-process Postgres so the response shape/status and DB side effects are verified
 * for the three paths a page-load bootstrap can take:
 *   1. returning user  -> single SELECT, 200, no new rows
 *   2. new user + existing org -> 201, links user, isFirstAdmin=false
 *   3. new user + new org -> 201, creates org + trial + first admin
 *
 * `@neondatabase/serverless` is mocked so the handler's `neon(getConnectionString(env))`
 * client resolves to the pglite-backed tagged sql; `@clerk/backend` is mocked so token
 * verification returns controlled claims (no network). Runs under
 * `vitest.node.config.mts` (`*.node.test.ts`, `npm run test:db`).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { neon } from '@neondatabase/serverless';
import type { NeonQueryFunction } from '@neondatabase/serverless';
import type { Env } from '../types/env';
import { createPgliteHarness, createTaggedSql, type PgliteHarness } from '../__tests__/pglite-db';

const sqlHolder = vi.hoisted(() => ({ current: null as unknown }));
const tokenHolder = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('@neondatabase/serverless', () => ({
  neon: vi.fn(() => sqlHolder.current),
}));

vi.mock('@clerk/backend', () => ({
  verifyToken: vi.fn(async () => tokenHolder.current),
  // Only reached when the token lacks email/username; our claims always supply both.
  createClerkClient: vi.fn(() => ({
    users: { getUser: vi.fn(async () => ({ primaryEmailAddress: null, username: null })) },
  })),
}));

import { handleOrganizationBootstrap } from './bootstrap-handler';

interface TokenClaims {
  sub: string;
  email?: string;
  username?: string;
  org_id?: string;
  org_role?: string;
}

interface BootstrapPayload {
  userId: number;
  organizationId: string;
  role: string;
  isNewOrg: boolean;
  isNewUser: boolean;
  isFirstAdmin: boolean;
  isPlatformAdmin: boolean;
}

const ENV = {
  NODE_ENV: 'test',
  NEON_CONNECTION_STRING: 'postgres://test',
  CLERK_SECRET_KEY: 'sk_test_dummy',
} as unknown as Env;

function bootstrapRequest(claims: TokenClaims, body: Record<string, unknown> = {}): Request {
  tokenHolder.current = claims;
  return new Request('https://api.test/api/organization/bootstrap', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-token',
      Origin: 'https://app.test',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

describe('handleOrganizationBootstrap (real SQL)', () => {
  let harness: PgliteHarness;
  let sql: NeonQueryFunction<false, false>;

  beforeAll(async () => {
    harness = await createPgliteHarness();
    sql = createTaggedSql(harness.pg);
    sqlHolder.current = sql;
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    vi.mocked(neon).mockClear();
    await sql`DELETE FROM subscription_tiers`;
    await sql`DELETE FROM users`;
    await sql`DELETE FROM organizations`;
  });

  const seedOrg = async (id: string, clerkOrgId: string, slug: string): Promise<void> => {
    await sql`
      INSERT INTO organizations (id, clerk_organization_id, name, slug, updated_at)
      VALUES (${id}, ${clerkOrgId}, ${'Org ' + slug}, ${slug}, NOW())`;
  };

  const seedUser = async (
    orgId: string,
    clerkUserId: string,
    role: string,
    email: string,
  ): Promise<number> => {
    const rows = await sql`
      INSERT INTO users (organization_id, clerk_user_id, email, username, role, updated_at)
      VALUES (${orgId}, ${clerkUserId}, ${email}, ${email.split('@')[0]}, ${role}, NOW())
      RETURNING id`;
    return Number(rows[0].id);
  };

  it('returns the existing user in a single lookup without creating rows', async () => {
    await seedOrg('org-1', 'clerk-org-1', 'acme');
    const userId = await seedUser('org-1', 'clerk-user-1', 'manager', 'jo@acme.test');

    // Token carries a *different* org than the stored one; the early return must still
    // report the DB-of-record org/role (ongoing sync is a webhook responsibility).
    const request = bootstrapRequest({
      sub: 'clerk-user-1',
      email: 'jo@acme.test',
      username: 'jo',
      org_id: 'clerk-org-999',
      org_role: 'org:admin',
    });

    const response = await handleOrganizationBootstrap(request, ENV);
    expect(response.status).toBe(200);
    const payload = (await response.json()) as BootstrapPayload;
    expect(payload).toMatchObject({
      userId,
      organizationId: 'org-1',
      role: 'manager',
      isNewOrg: false,
      isNewUser: false,
      isFirstAdmin: false,
      isPlatformAdmin: false,
    });

    const userCount = await sql`SELECT COUNT(*)::int AS n FROM users`;
    expect(userCount[0].n).toBe(1);
  });

  it('uses the direct Neon connection before Hyperdrive for bootstrap SQL', async () => {
    const envWithHyperdrive = {
      ...ENV,
      NEON_CONNECTION_STRING: 'postgres://direct-neon',
      HYPERDRIVE: { connectionString: 'postgres://hyperdrive' },
    } as unknown as Env;

    await seedOrg('org-connection', 'clerk-org-connection', 'connection');
    await seedUser(
      'org-connection',
      'clerk-connection-user',
      'admin',
      'connection@example.test',
    );

    const request = bootstrapRequest({
      sub: 'clerk-connection-user',
      email: 'connection@example.test',
      username: 'connection',
      org_id: 'clerk-org-connection',
      org_role: 'org:admin',
    });

    const response = await handleOrganizationBootstrap(request, envWithHyperdrive);
    expect(response.status).toBe(200);
    expect(neon).toHaveBeenCalledWith('postgres://direct-neon');
  });

  it('links a new user to an existing org as a non-first admin', async () => {
    await seedOrg('org-2', 'clerk-org-2', 'globex');
    await seedUser('org-2', 'clerk-admin', 'admin', 'boss@globex.test');

    const request = bootstrapRequest({
      sub: 'clerk-newbie',
      email: 'new@globex.test',
      username: 'newbie',
      org_id: 'clerk-org-2',
    });

    const response = await handleOrganizationBootstrap(request, ENV);
    expect(response.status).toBe(201);
    const payload = (await response.json()) as BootstrapPayload;
    expect(payload).toMatchObject({
      organizationId: 'org-2',
      role: 'team_member',
      isNewOrg: false,
      isNewUser: true,
      isFirstAdmin: false,
    });

    const linked = await sql`
      SELECT organization_id AS "organizationId", role
      FROM users WHERE clerk_user_id = ${'clerk-newbie'}`;
    expect(linked[0]).toMatchObject({ organizationId: 'org-2', role: 'team_member' });

    const trial = await sql`
      SELECT status FROM subscription_tiers WHERE organization_id = ${'org-2'}`;
    expect(trial[0]?.status).toBe('trialing');
  });

  it('creates a new org, trial subscription, and first admin for a brand-new user', async () => {
    const request = bootstrapRequest(
      { sub: 'clerk-founder', email: 'founder@startup.test', username: 'founder' },
      { clerkOrganizationId: 'clerk-org-new', organizationName: 'Startup Inc' },
    );

    const response = await handleOrganizationBootstrap(request, ENV);
    expect(response.status).toBe(201);
    const payload = (await response.json()) as BootstrapPayload;
    expect(payload).toMatchObject({
      role: 'admin',
      isNewOrg: true,
      isNewUser: true,
      isFirstAdmin: true,
    });

    const org = await sql`
      SELECT id, name FROM organizations WHERE clerk_organization_id = ${'clerk-org-new'}`;
    expect(org[0]?.name).toBe('Startup Inc');
    expect(payload.organizationId).toBe(String(org[0].id));

    const user = await sql`
      SELECT role FROM users WHERE clerk_user_id = ${'clerk-founder'}`;
    expect(user[0]?.role).toBe('admin');

    const trial = await sql`
      SELECT status FROM subscription_tiers WHERE organization_id = ${String(org[0].id)}`;
    expect(trial[0]?.status).toBe('trialing');
  });
});
