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

function bootstrapRequest(
  claims: TokenClaims,
  body: Record<string, unknown> = {},
  extraHeaders: Record<string, string> = {},
): Request {
  tokenHolder.current = claims;
  return new Request('https://api.test/api/organization/bootstrap', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-token',
      Origin: 'https://app.test',
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

interface OrgAuditRow {
  organization_id: string;
  event_type: string;
  actor_user_id: number | null;
  actor_organization_id: string | null;
  target_user_id: number | null;
  target_organization_id: string | null;
  old_role: string | null;
  new_role: string | null;
  ip_address: string | null;
  metadata: string | null;
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
    await sql`DELETE FROM org_audit_log`;
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

  /**
   * Organization RBAC audit trail (migration 0013, task 3.1.g).
   *
   * The Express test this replaces (`backend/src/tests/services/org-bootstrap.service.test.ts:70-91`)
   * wrapped its only assertion in `if (auditLog)` with an `else` that merely
   * `console.warn`ed, because SQLite's interactive transaction lock swallowed the
   * write — so it passed whether or not the row existed and proved nothing. These
   * run against real Postgres and assert the row's *identity*, not its count.
   */
  describe('organization RBAC audit trail', () => {
    const readAudit = async (): Promise<OrgAuditRow[]> =>
      (await sql`
        SELECT organization_id, event_type, actor_user_id, actor_organization_id,
               target_user_id, target_organization_id, old_role, new_role,
               ip_address, metadata
        FROM org_audit_log
        ORDER BY id`) as unknown as OrgAuditRow[];

    it('records the first admin a brand-new organization mints', async () => {
      const request = bootstrapRequest(
        { sub: 'clerk-founder', email: 'founder@startup.test', username: 'founder' },
        { clerkOrganizationId: 'clerk-org-new', organizationName: 'Startup Inc' },
        { 'CF-Connecting-IP': '198.51.100.22' },
      );

      const response = await handleOrganizationBootstrap(request, ENV);
      expect(response.status).toBe(201);
      const payload = (await response.json()) as BootstrapPayload;

      const rows = await readAudit();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        organization_id: payload.organizationId,
        event_type: 'role_assigned',
        // Bootstrap is a *self*-assignment: actor and target are the same user.
        // That is the property distinguishing it from an admin promotion, so it
        // is asserted rather than left implied.
        actor_user_id: payload.userId,
        target_user_id: payload.userId,
        actor_organization_id: payload.organizationId,
        target_organization_id: payload.organizationId,
        old_role: null,
        new_role: 'admin',
        ip_address: '198.51.100.22',
      });
      expect(JSON.parse(String(rows[0].metadata))).toMatchObject({
        trigger: 'bootstrap',
        isFirstAdmin: true,
        isNewOrg: true,
      });
    });

    it('records a non-first member joining an existing organization', async () => {
      await seedOrg('org-2', 'clerk-org-2', 'globex');
      await seedUser('org-2', 'clerk-admin', 'admin', 'boss@globex.test');

      const request = bootstrapRequest({
        sub: 'clerk-newbie',
        email: 'new@globex.test',
        username: 'newbie',
        org_id: 'clerk-org-2',
      });
      expect((await handleOrganizationBootstrap(request, ENV)).status).toBe(201);

      const rows = await readAudit();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        organization_id: 'org-2',
        new_role: 'team_member',
        // No CF-Connecting-IP and no X-Forwarded-For on this request, so the
        // shared helper's documented fallback is what lands in the column.
        ip_address: 'unknown',
      });
      expect(JSON.parse(String(rows[0].metadata))).toMatchObject({
        trigger: 'bootstrap',
        isFirstAdmin: false,
        isNewOrg: false,
      });
    });

    it('writes nothing when a returning user signs in again', async () => {
      await seedOrg('org-1', 'clerk-org-1', 'acme');
      await seedUser('org-1', 'clerk-user-1', 'manager', 'jo@acme.test');

      const request = bootstrapRequest({
        sub: 'clerk-user-1',
        email: 'jo@acme.test',
        username: 'jo',
        org_id: 'clerk-org-1',
      });
      expect((await handleOrganizationBootstrap(request, ENV)).status).toBe(200);

      // A page load is not an authorization event. Without this, every reload
      // would append a row and the trail would be unreadable within a day.
      expect(await readAudit()).toHaveLength(0);
    });

    it('still completes the bootstrap when the audit write fails', async () => {
      // The deliberate asymmetry with the promotion path: a failed audit write
      // must never lock a user out of their first sign-in, because this entry is
      // reconstructible from users.role + users.created_at. Dropping the table
      // is the bluntest way to make the INSERT fail for real rather than by
      // mocking the call away.
      const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
      await sql`ALTER TABLE org_audit_log RENAME TO org_audit_log_hidden`;
      try {
        const request = bootstrapRequest(
          { sub: 'clerk-resilient', email: 'resilient@startup.test', username: 'resilient' },
          { clerkOrganizationId: 'clerk-org-resilient', organizationName: 'Resilient Inc' },
        );

        const response = await handleOrganizationBootstrap(request, ENV);
        expect(response.status).toBe(201);
        const user = await sql`
          SELECT role FROM users WHERE clerk_user_id = ${'clerk-resilient'}`;
        expect(user[0]?.role).toBe('admin');
        expect(warn).toHaveBeenCalled();
      } finally {
        await sql`ALTER TABLE org_audit_log_hidden RENAME TO org_audit_log`;
        warn.mockRestore();
      }
    });
  });
});
