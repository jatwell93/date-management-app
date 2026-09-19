/**
 * Real-SQL (pglite) coverage for the **admin-driven** half of the organization
 * RBAC audit trail (migration 0013, task 3.1.g): both paths by which one user
 * grants a role to another — `POST /api/users` (create with a chosen role) and
 * `PUT /api/users/:id` (promote an existing user).
 *
 * `bootstrap-handler.node.test.ts` covers the other half — the automatic
 * self-assignment at account creation, which Express also recorded. This file
 * covers the event neither backend recorded before 0013: one admin deliberately
 * changing another user's role through `PUT /api/users/:id`. That is the entry
 * with the actual compliance argument, since unlike the bootstrap entry it is
 * not reconstructible from `users.role` and `users.created_at`.
 *
 * Because the audit row is written by a data-modifying CTE inside the same
 * statement as the `UPDATE`, the properties worth pinning are the ones a
 * follow-up INSERT would *not* have given: the recorded `old_role` is the value
 * the row genuinely held, and there is no interleaving in which the role changes
 * without a row appearing. Every assertion below is written so that removing the
 * clause it guards makes it fail — see the mutation notes on each block.
 *
 * Runs under `vitest.node.config.mts` (`*.node.test.ts`, `npm run test:db`)
 * because pglite is WASM and needs a Node runtime.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NeonQueryFunction } from '@neondatabase/serverless';
import type { Env } from './types/env';
import { createPgliteHarness, createTaggedSql, type PgliteHarness } from './__tests__/pglite-db';

// `createWorkersDatabase` builds its client with `neon(connectionString)`, which
// validates the URL shape and would reject the placeholder. Routing it to the
// pglite-backed tagged sql is what makes these tests exercise the real SQL.
const sqlHolder = vi.hoisted(() => ({ current: null as unknown }));
const clerkHolder = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('@neondatabase/serverless', () => ({
  neon: vi.fn(() => sqlHolder.current),
}));

// `POST /api/users` is reached through the route table, so its handler needs the
// Clerk half of `authenticateApiRequest` stubbed. Only token verification is
// mocked: `resolveAuthenticatedUser` still runs its real query against pglite,
// so the actor id the audit row records is resolved from the database, not
// supplied by the test.
vi.mock('./clerk/bootstrap-handler', () => ({
  authenticateClerkRequest: vi.fn(async () => clerkHolder.current),
  getClerkAuthorizedParties: vi.fn(() => []),
  handleOrganizationBootstrap: vi.fn(),
}));

import { createWorkersDatabase } from './database';
import { MINIMAL_API_ROUTES } from './index-minimal';
import {
  LIVE_ORG_AUDIT_EVENT_TYPES,
  ORG_AUDIT_EVENT_TYPES,
  ORG_AUDIT_TRIGGERS,
} from '../../shared/domain/org-audit';

const ORG = 'org-audit-a';
const OTHER_ORG = 'org-audit-b';

/** The admin performing the change — deliberately *not* the user being changed. */
const ACTOR = { userId: 4242, ipAddress: '198.51.100.9' };

interface OrgAuditRow {
  organization_id: string;
  event_type: string;
  actor_user_id: number | null;
  actor_organization_id: string | null;
  target_user_id: number | null;
  target_organization_id: string | null;
  old_role: string | null;
  new_role: string | null;
  invite_id: string | null;
  ip_address: string | null;
  metadata: string | null;
}

function makeDb() {
  return createWorkersDatabase({ NEON_CONNECTION_STRING: 'postgres://test' } as Env);
}

describe('organization RBAC audit trail — admin promotion (real SQL)', () => {
  let harness: PgliteHarness;
  let sql: NeonQueryFunction<false, false>;
  let targetUserId: number;

  beforeAll(async () => {
    harness = await createPgliteHarness();
    sql = createTaggedSql(harness.pg);
    sqlHolder.current = sql;
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await sql`DELETE FROM org_audit_log`;
    await sql`DELETE FROM subscription_tiers`;
    await sql`DELETE FROM users`;
    await sql`DELETE FROM organizations`;

    for (const id of [ORG, OTHER_ORG]) {
      await sql`
        INSERT INTO organizations (id, name, slug, updated_at)
        VALUES (${id}, ${'Org ' + id}, ${id}, NOW())`;
    }

    const rows = await sql`
      INSERT INTO users (organization_id, username, email, role, updated_at)
      VALUES (${ORG}, 'target', 'target@a.test', 'team_member', NOW())
      RETURNING id`;
    targetUserId = Number(rows[0].id);
  });

  const readAudit = async (): Promise<OrgAuditRow[]> =>
    (await sql`
      SELECT organization_id, event_type, actor_user_id, actor_organization_id,
             target_user_id, target_organization_id, old_role, new_role,
             invite_id, ip_address, metadata
      FROM org_audit_log
      ORDER BY id`) as unknown as OrgAuditRow[];

  it('records who promoted whom, from which role to which', async () => {
    const result = await makeDb().updateUserRole(ORG, targetUserId, 'admin', ACTOR);

    expect(result).toMatchObject({ id: targetUserId, role: 'admin', previousRole: 'team_member' });

    const rows = await readAudit();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organization_id: ORG,
      event_type: ORG_AUDIT_EVENT_TYPES.ROLE_ASSIGNED,
      // The distinguishing property of this event: actor and target differ.
      // A promotion recorded with actor === target would be indistinguishable
      // from the bootstrap self-assignment, which is exactly the confusion the
      // Express trail left behind.
      actor_user_id: ACTOR.userId,
      target_user_id: targetUserId,
      actor_organization_id: ORG,
      target_organization_id: ORG,
      old_role: 'team_member',
      new_role: 'admin',
      invite_id: null,
      ip_address: ACTOR.ipAddress,
    });
    expect(JSON.parse(String(rows[0].metadata))).toEqual({
      trigger: ORG_AUDIT_TRIGGERS.ADMIN_UPDATE,
    });
  });

  it('records the pre-update role even when a later change overwrites it', async () => {
    const db = makeDb();

    await db.updateUserRole(ORG, targetUserId, 'manager', ACTOR);
    await db.updateUserRole(ORG, targetUserId, 'admin', ACTOR);

    // Mutation check: replacing the `prev` CTE with a post-update read (or
    // reading `users.role` in the audit SELECT instead of `prev.role`) collapses
    // both rows' old_role onto the *new* value and fails here. A chain of
    // promotions is precisely what an auditor reads this table for.
    const rows = await readAudit();
    expect(rows.map((row) => [row.old_role, row.new_role])).toEqual([
      ['team_member', 'manager'],
      ['manager', 'admin'],
    ]);
  });

  it('writes no row when the role is re-asserted unchanged', async () => {
    const result = await makeDb().updateUserRole(ORG, targetUserId, 'team_member', ACTOR);

    // The update still succeeds and still reports the user — only the audit
    // row is suppressed. Mutation check: deleting the
    // `WHERE previous_role IS DISTINCT FROM role` clause makes this fail.
    expect(result).toMatchObject({ role: 'team_member', previousRole: 'team_member' });
    expect(await readAudit()).toHaveLength(0);
  });

  it('writes no row and makes no change for a user in another organization', async () => {
    const foreign = await sql`
      INSERT INTO users (organization_id, username, email, role, updated_at)
      VALUES (${OTHER_ORG}, 'foreign', 'foreign@b.test', 'team_member', NOW())
      RETURNING id`;
    const foreignUserId = Number(foreign[0].id);

    const result = await makeDb().updateUserRole(ORG, foreignUserId, 'admin', ACTOR);

    expect(result).toBeNull();
    const rows = await sql`SELECT role FROM users WHERE id = ${foreignUserId}`;
    expect(rows[0].role).toBe('team_member');
    expect(await readAudit()).toHaveLength(0);
  });

  it('leaves the role unchanged if the audit row cannot be written', async () => {
    // The promotion path's reason for existing: role change and audit row are
    // one statement, so they succeed or fail together. Renaming the table away
    // makes the CTE's INSERT fail for real rather than by mocking it out.
    const db = makeDb();
    await sql`ALTER TABLE org_audit_log RENAME TO org_audit_log_hidden`;
    try {
      await expect(db.updateUserRole(ORG, targetUserId, 'admin', ACTOR)).rejects.toThrow();
    } finally {
      await sql`ALTER TABLE org_audit_log_hidden RENAME TO org_audit_log`;
    }

    // Mutation check: splitting the CTE into a separate INSERT after the UPDATE
    // makes this assertion fail — the role would have changed with no record of
    // it, which is the failure mode the single statement exists to rule out.
    const rows = await sql`SELECT role FROM users WHERE id = ${targetUserId}`;
    expect(rows[0].role).toBe('team_member');
  });

  /**
   * `POST /api/users` (`handleCreateLegacyUser`). Added after review pointed out
   * that the trail's doc comment enumerated two emitters as if exhaustive, while
   * a third live path granted a role unrecorded: `isValidRole` admits 'admin',
   * so this endpoint mints a brand-new admin as readily as PUT promotes an
   * existing one, and nothing recorded who did it.
   */
  describe('admin creating a user with a chosen role', () => {
    const ENV = {} as Env;

    const postUser = async (role: string, actorClerkId: string): Promise<Response> => {
      const route = MINIMAL_API_ROUTES.find(
        ([method, pattern]) => method === 'POST' && pattern === '/api/users',
      );
      if (!route) throw new Error('POST /api/users is not registered');
      const handler = route[2] as (
        request: Request,
        db: ReturnType<typeof makeDb>,
        env: Env,
      ) => Promise<Response>;

      clerkHolder.current = { clerkUserId: actorClerkId };
      const request = new Request('https://api.test/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.44' },
        body: JSON.stringify({ username: `new-${role}`, role }),
      });
      return handler(request, makeDb(), ENV);
    };

    /** An admin who can actually be resolved by `resolveAuthenticatedUser`. */
    const seedActingAdmin = async (): Promise<number> => {
      const rows = await sql`
        INSERT INTO users (organization_id, clerk_user_id, username, email, role, updated_at)
        VALUES (${ORG}, 'clerk-acting-admin', 'boss', 'boss@a.test', 'admin', NOW())
        RETURNING id`;
      await sql`
        INSERT INTO subscription_tiers (organization_id, tier_level, status, updated_at)
        VALUES (${ORG}, 'pro', 'active', NOW())`;
      return Number(rows[0].id);
    };

    it('records who created a brand-new admin', async () => {
      const actorId = await seedActingAdmin();

      const response = await postUser('admin', 'clerk-acting-admin');
      expect(response.status).toBe(201);
      const created = (await response.json()) as { id: number; role: string };
      expect(created.role).toBe('admin');

      const rows = await readAudit();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        organization_id: ORG,
        event_type: ORG_AUDIT_EVENT_TYPES.ROLE_ASSIGNED,
        actor_user_id: actorId,
        target_user_id: created.id,
        // No prior role exists — this user did not hold anything before. NULL
        // here is what distinguishes a grant-on-create from a promotion.
        old_role: null,
        new_role: 'admin',
        ip_address: '203.0.113.44',
      });
      expect(JSON.parse(String(rows[0].metadata))).toEqual({
        trigger: ORG_AUDIT_TRIGGERS.ADMIN_CREATE,
      });
    });

    it('records a non-admin creation too, distinguishably', async () => {
      await seedActingAdmin();

      expect((await postUser('team_member', 'clerk-acting-admin')).status).toBe(201);

      const rows = await readAudit();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ new_role: 'team_member', old_role: null });
      expect(JSON.parse(String(rows[0].metadata))).toEqual({
        trigger: ORG_AUDIT_TRIGGERS.ADMIN_CREATE,
      });
    });

    it('creates no user when the audit row cannot be written', async () => {
      await seedActingAdmin();
      await sql`ALTER TABLE org_audit_log RENAME TO org_audit_log_hidden`;
      let status: number;
      try {
        status = (await postUser('admin', 'clerk-acting-admin')).status;
      } finally {
        await sql`ALTER TABLE org_audit_log_hidden RENAME TO org_audit_log`;
      }

      // Mutation check: moving the audit INSERT out of the CTE leaves a created
      // admin behind with no record of who created them — the exact failure the
      // single statement rules out. The handler's catch turns it into a 500.
      expect(status).toBe(500);
      const created = await sql`SELECT id FROM users WHERE username = 'new-admin'`;
      expect(created).toHaveLength(0);
    });
  });

  it('pins the event types that actually have a writer', async () => {
    await makeDb().updateUserRole(ORG, targetUserId, 'admin', ACTOR);
    const emitted = new Set((await readAudit()).map((row) => row.event_type));

    // The full vocabulary is Express's and most of it is reserved: `role_removed`
    // never had an emitter, and the invite events sit behind
    // ENABLE_CUSTOM_ORG_INVITES, which is off. Stating the live subset as data
    // means adding a writer without updating it surfaces as a failure instead of
    // leaving the constant a quiet lie about the table's contents.
    for (const type of emitted) {
      expect(LIVE_ORG_AUDIT_EVENT_TYPES).toContain(type);
    }
    expect(LIVE_ORG_AUDIT_EVENT_TYPES).toEqual([ORG_AUDIT_EVENT_TYPES.ROLE_ASSIGNED]);
  });
});
