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
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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

import { isAdminSlotViolation } from './db-errors';
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

  it('refuses to promote a second user to admin and leaves the role and trail untouched', async () => {
    const db = makeDb();
    await db.updateUserRole(ORG, targetUserId, 'admin', ACTOR);
    const other = await sql`
      INSERT INTO users (organization_id, username, email, role, updated_at)
      VALUES (${ORG}, 'other', 'other@a.test', 'manager', NOW())
      RETURNING id`;
    const otherId = Number(other[0].id);

    const attempt = db.updateUserRole(ORG, otherId, 'admin', ACTOR);

    await expect(attempt).rejects.toSatisfy(isAdminSlotViolation);
    expect((await sql`SELECT role FROM users WHERE id = ${otherId}`)[0].role).toBe('manager');
    expect(await readAudit()).toHaveLength(1);
  });

  it('lets the admin slot move once the current admin is demoted', async () => {
    const db = makeDb();
    const other = await sql`
      INSERT INTO users (organization_id, username, email, role, updated_at)
      VALUES (${ORG}, 'other', 'other@a.test', 'manager', NOW())
      RETURNING id`;
    const otherId = Number(other[0].id);
    await db.updateUserRole(ORG, targetUserId, 'admin', ACTOR);

    await db.updateUserRole(ORG, targetUserId, 'manager', ACTOR);
    await db.updateUserRole(ORG, otherId, 'admin', ACTOR);

    const admins =
      await sql`SELECT id FROM users WHERE organization_id = ${ORG} AND role = 'admin'`;
    expect(admins.map((row) => Number(row.id))).toEqual([otherId]);
  });

  it('does not let a soft-deleted admin hold the slot', async () => {
    const db = makeDb();
    await db.updateUserRole(ORG, targetUserId, 'admin', ACTOR);
    await sql`UPDATE users SET deleted_at = NOW() WHERE id = ${targetUserId}`;
    const other = await sql`
      INSERT INTO users (organization_id, username, email, role, updated_at)
      VALUES (${ORG}, 'other', 'other@a.test', 'manager', NOW())
      RETURNING id`;

    const result = await db.updateUserRole(ORG, Number(other[0].id), 'admin', ACTOR);

    expect(result).toMatchObject({ role: 'admin' });
  });

  it('keeps one admin per organization, not one admin in total', async () => {
    const db = makeDb();
    await db.updateUserRole(ORG, targetUserId, 'admin', ACTOR);
    const foreign = await sql`
      INSERT INTO users (organization_id, username, email, role, updated_at)
      VALUES (${OTHER_ORG}, 'foreign', 'foreign@b.test', 'team_member', NOW())
      RETURNING id`;

    const result = await db.updateUserRole(OTHER_ORG, Number(foreign[0].id), 'admin', ACTOR);

    expect(result).toMatchObject({ role: 'admin' });
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

    const postUser = async (
      role: string,
      actorClerkId: string,
      env: Env = ENV,
    ): Promise<Response> => {
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
      return handler(request, makeDb(), env);
    };

    /**
     * An admin who can actually be resolved by `resolveAuthenticatedUser`.
     *
     * The tier is `professional` — what `ensureTrialSubscription` actually
     * writes (`clerk/clerk-persistence.ts:113`) — rather than the `pro` this
     * seeded before task 3.1.j(a). `pro` is not a value `normalizeLaunchTier`
     * recognises, so it fell through to `free`, and these tests were silently
     * running a ten-seat trial at the one-seat cap. That mattered for nothing
     * while no seat cap existed; it would have quietly changed what the cases
     * below exercise now that one does.
     */
    const seedActingAdmin = async (tierLevel = 'professional'): Promise<number> => {
      const rows = await sql`
        INSERT INTO users (organization_id, clerk_user_id, username, email, role, updated_at)
        VALUES (${ORG}, 'clerk-acting-admin', 'boss', 'boss@a.test', 'admin', NOW())
        RETURNING id`;
      await sql`
        INSERT INTO subscription_tiers (organization_id, tier_level, status, updated_at)
        VALUES (${ORG}, ${tierLevel}, 'active', NOW())`;
      return Number(rows[0].id);
    };

    it('refuses a second admin with 409 and writes neither the user nor an audit row', async () => {
      await seedActingAdmin();

      const response = await postUser('admin', 'clerk-acting-admin');

      // One active admin per organization (migration 0020, #474). The acting admin
      // already holds the slot, so creating an admin is always refused.
      expect(response.status).toBe(409);
      expect(await response.text()).toContain('already has an admin');
      expect(await sql`SELECT id FROM users WHERE username = 'new-admin'`).toHaveLength(0);
      expect(await readAudit()).toHaveLength(0);
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

    it('creates no user when the audit table is missing, and says why', async () => {
      await seedActingAdmin();
      await sql`ALTER TABLE org_audit_log RENAME TO org_audit_log_hidden`;
      let response: Response;
      try {
        response = await postUser('team_member', 'clerk-acting-admin');
      } finally {
        await sql`ALTER TABLE org_audit_log_hidden RENAME TO org_audit_log`;
      }

      // Fails closed, and says which migration is missing rather than leaking a
      // raw driver error as a 500. Review proposed swallowing this and creating
      // the user unaudited; that would reintroduce the orphan admin the atomic
      // statement exists to prevent, so the failure is deliberate.
      expect(response.status).toBe(503);
      expect(await response.text()).toContain('0013_org_audit_log');

      // Mutation check: moving the audit INSERT out of the CTE leaves a created
      // admin behind with no record of who created them.
      const created = await sql`SELECT id FROM users WHERE username = 'new-team_member'`;
      expect(created).toHaveLength(0);
    });

    /**
     * An admin whose stored role is still the pre-#517 spelling.
     *
     * `canManageUsers` used to compare the raw column, so `'Manager'` — which
     * the Clerk webhook wrote for `org:admin` — matched nothing and the user
     * got "Only admins can create users". Migration 0014 rewrites these rows,
     * but the gate normalizes too, so a database that has not run it yet (or a
     * replica mid-rollout) still admits the person the row plainly describes.
     *
     * Since migration 0018 a migrated database refuses the spelling outright
     * (`users_role_canonical`), so this case simulates one that has not run
     * 0018 yet: the constraint is dropped for the test and restored after it.
     *
     * Mutation check: restoring the raw `role === 'admin'` comparison turns
     * this into a 403.
     */
    it('admits an admin whose row still holds the pre-migration spelling', async () => {
      await sql`ALTER TABLE users DROP CONSTRAINT users_role_canonical`;
      try {
        await sql`
          INSERT INTO users (organization_id, clerk_user_id, username, email, role, updated_at)
          VALUES (${ORG}, 'clerk-legacy-admin', 'legacy', 'legacy@a.test', 'Manager', NOW())`;
        await sql`
          INSERT INTO subscription_tiers (organization_id, tier_level, status, updated_at)
          VALUES (${ORG}, 'professional', 'active', NOW())`;

        const response = await postUser('team_member', 'clerk-legacy-admin');

        expect(response.status).toBe(201);
        expect(await readAudit()).toHaveLength(1);
      } finally {
        // The legacy row must go before the constraint can be validated again.
        await sql`DELETE FROM users WHERE role NOT IN ('admin', 'manager', 'team_member')`;
        await sql`
          ALTER TABLE users ADD CONSTRAINT users_role_canonical
          CHECK (role IN ('admin', 'manager', 'team_member'))`;
      }
    });

    /**
     * Seat cap (task 3.1.j(a)).
     *
     * These live beside the audit cases rather than in
     * `database.usage-limits.pglite.node.test.ts` because the property that
     * needs real SQL is the *interaction*: the cap is a `WHERE` on the `created`
     * CTE, and the audit INSERT selects `FROM created`, so a refused seat must
     * also record no role grant. A mocked client cannot show that — it would
     * return whatever the test told it to for both statements, which are in
     * fact one statement. A seat refusal that still wrote `role_assigned` would
     * read, in the compliance trail, as an admin who was created.
     *
     * `ORG` holds two users before every case here: `target` from the outer
     * `beforeEach`, and the acting admin.
     */
    describe('seat cap', () => {
      const ENFORCING = { USAGE_LIMITS_ENFORCE: 'true' } as Env;

      const countUsers = async (organizationId: string): Promise<number> => {
        const rows = await sql`
          SELECT COUNT(*)::int AS count FROM users WHERE organization_id = ${organizationId}`;
        return Number(rows[0].count);
      };

      let warn: ReturnType<typeof vi.spyOn>;
      beforeEach(() => {
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      });
      afterEach(() => {
        warn.mockRestore();
      });

      const limitEvents = (): Array<Record<string, unknown>> =>
        (warn.mock.calls as unknown[][])
          .map((call): Record<string, unknown> => {
            try {
              return JSON.parse(String(call[0])) as Record<string, unknown>;
            } catch {
              return {};
            }
          })
          // Selected by name, not by position: the entitlement gate (#489) also
          // writes a JSON warning on this path, so an index would pin call
          // ordering rather than the usage-limit record.
          .filter((event) => event.event === 'usage_limit_reached');

      it('refuses the seat and records no role grant when the cap is reached', async () => {
        await seedActingAdmin('free');
        expect(await countUsers(ORG)).toBe(2);

        const response = await postUser('team_member', 'clerk-acting-admin', ENFORCING);

        expect(response.status).toBe(402);
        await expect(response.json()).resolves.toMatchObject({
          error: 'User limit reached for your subscription tier (max 1)',
          limit: 1,
          retryable: false,
        });

        // Mutation check: defeating the `WHERE (SELECT COUNT(*) ...) < cap`
        // clause (replaced with `WHERE 1 = 1`) fails both of these.
        //
        // The audit assertion is not redundant with the user count. It is the
        // one that fails if the audit INSERT is ever lifted out of the CTE into
        // a follow-up statement: the cap would still stop the user row, and a
        // `role_assigned` entry would appear for a user who was never created.
        // Neither assertion distinguishes this implementation from a
        // read-then-insert pre-check, which is a race, not an observable — see
        // the soft-cap note on `createProduct` in `database.ts`.
        expect(await countUsers(ORG)).toBe(2);
        expect(await readAudit()).toHaveLength(0);

        expect(limitEvents()).toEqual([
          {
            event: 'usage_limit_reached',
            resource: 'User',
            organizationId: ORG,
            tier: 'free',
            limit: 1,
            enforced: true,
          },
        ]);
      });

      it('creates the user once, with one audit row, when enforcement is off', async () => {
        await seedActingAdmin('free');

        const response = await postUser('team_member', 'clerk-acting-admin');
        expect(response.status).toBe(201);

        // The capped attempt inserted nothing and the uncapped retry inserted
        // once. Two audit rows here would mean the first attempt's `audited`
        // CTE ran anyway — the failure mode that makes the retry a second write
        // rather than the only one.
        expect(await countUsers(ORG)).toBe(3);
        expect(await readAudit()).toHaveLength(1);

        expect(limitEvents()).toEqual([
          {
            event: 'usage_limit_reached',
            resource: 'User',
            organizationId: ORG,
            tier: 'free',
            limit: 1,
            enforced: false,
          },
        ]);
      });

      it('admits the seat when the tier allows it, with enforcement on', async () => {
        await seedActingAdmin('professional');

        const response = await postUser('team_member', 'clerk-acting-admin', ENFORCING);

        expect(response.status).toBe(201);
        expect(await countUsers(ORG)).toBe(3);
        expect(await readAudit()).toHaveLength(1);
        expect(limitEvents()).toEqual([]);
      });

      it('counts only the acting organization towards the cap', async () => {
        await seedActingAdmin('starter');
        for (let i = 0; i < 50; i += 1) {
          await sql`
            INSERT INTO users (organization_id, username, email, role, updated_at)
            VALUES (${OTHER_ORG}, ${'other-' + i}, ${'other-' + i + '@b.test'}, 'team_member', NOW())`;
        }

        // Mutation check: dropping `WHERE organization_id = ...` from the
        // counting sub-select makes this a 402 — one tenant's headcount would
        // consume another's seats.
        const response = await postUser('team_member', 'clerk-acting-admin', ENFORCING);

        expect(response.status).toBe(201);
        expect(await countUsers(ORG)).toBe(3);
      });
    });
  });

  describe('reading the trail (GET /api/organization/audit-log)', () => {
    const ENV = {} as Env;

    const getLog = async (query = '', actorClerkId = 'clerk-reader'): Promise<Response> => {
      const route = MINIMAL_API_ROUTES.find(
        ([method, pattern]) => method === 'GET' && pattern === '/api/organization/audit-log',
      );
      if (!route) throw new Error('GET /api/organization/audit-log is not registered');
      const handler = route[2] as (
        request: Request,
        db: ReturnType<typeof makeDb>,
        env: Env,
      ) => Promise<Response>;
      clerkHolder.current = { clerkUserId: actorClerkId };
      return handler(
        new Request(`https://api.test/api/organization/audit-log${query}`),
        makeDb(),
        ENV,
      );
    };

    const seedReader = async (role = 'admin'): Promise<number> => {
      const rows = await sql`
        INSERT INTO users (organization_id, clerk_user_id, username, email, role, updated_at)
        VALUES (${ORG}, 'clerk-reader', 'reader', 'reader@a.test', ${role}, NOW())
        RETURNING id`;
      await sql`
        INSERT INTO subscription_tiers (organization_id, tier_level, status, updated_at)
        VALUES (${ORG}, 'professional', 'active', NOW())`;
      return Number(rows[0].id);
    };

    const seedEntry = async (
      organizationId: string,
      fields: {
        actor?: number | null;
        target?: number | null;
        oldRole?: string | null;
        newRole?: string;
        eventType?: string;
        metadata?: string | null;
        createdAt?: string;
      } = {},
    ): Promise<number> => {
      const rows = await sql`
        INSERT INTO org_audit_log (organization_id, event_type, actor_user_id, target_user_id,
                                   old_role, new_role, ip_address, metadata, created_at)
        VALUES (${organizationId}, ${fields.eventType ?? 'role_assigned'}, ${fields.actor ?? null},
                ${fields.target ?? null}, ${fields.oldRole ?? null}, ${fields.newRole ?? 'manager'},
                '203.0.113.7', ${fields.metadata ?? '{"trigger":"admin-update"}'},
                ${fields.createdAt ?? new Date().toISOString()})
        RETURNING id`;
      return Number(rows[0].id);
    };

    type LogBody = {
      entries: {
        id: number;
        actorUsername: string | null;
        targetUsername: string | null;
        newRole: string | null;
        metadata: Record<string, unknown> | null;
      }[];
      total: number;
      limit: number;
      offset: number;
    };

    it("returns the organization's entries newest first, with names and parsed metadata", async () => {
      const readerId = await seedReader();
      const older = await seedEntry(ORG, {
        actor: readerId,
        target: targetUserId,
        oldRole: 'team_member',
        newRole: 'manager',
        createdAt: '2026-01-01T00:00:00.000Z',
      });
      const newer = await seedEntry(ORG, {
        actor: readerId,
        target: targetUserId,
        oldRole: 'manager',
        newRole: 'admin',
        createdAt: '2026-02-01T00:00:00.000Z',
      });

      const response = await getLog();

      expect(response.status).toBe(200);
      const body = (await response.json()) as LogBody;
      expect(body.entries.map((e) => e.id)).toEqual([newer, older]);
      expect(body).toMatchObject({ total: 2, limit: 50, offset: 0 });
      expect(body.entries[0]).toMatchObject({
        actorUsername: 'reader',
        targetUsername: 'target',
        newRole: 'admin',
        metadata: { trigger: 'admin-update' },
        // ISO 8601 with T and Z: parseable by Safari and unambiguous about the zone.
        createdAt: '2026-02-01T00:00:00.000Z',
      });
    });

    it('applies from/to as UTC bounds whatever the session timezone', async () => {
      await seedReader();
      await seedEntry(ORG, { createdAt: '2026-02-01T10:00:00.000Z' });
      await sql`SET TIME ZONE 'Australia/Sydney'`;
      try {
        // 10:00Z is 21:00 in Sydney: a naive ::timestamp cast of the bound would
        // still agree here, but a timestamptz->local shift would not.
        const hit = (await (
          await getLog('?from=2026-02-01T10:00:00.000Z&to=2026-02-01T10:00:00.001Z')
        ).json()) as LogBody;
        const miss = (await (await getLog('?to=2026-02-01T10:00:00.000Z')).json()) as LogBody;
        expect(hit.total).toBe(1);
        expect(miss.total).toBe(0);
      } finally {
        await sql`SET TIME ZONE 'UTC'`;
      }
    });

    it("never returns another organization's rows, nor resolves a name across tenants", async () => {
      const readerId = await seedReader();
      const foreign = await sql`
        INSERT INTO users (organization_id, username, email, role, updated_at)
        VALUES (${OTHER_ORG}, 'foreign-person', 'f@b.test', 'admin', NOW())
        RETURNING id`;
      const foreignUserId = Number(foreign[0].id);
      await seedEntry(OTHER_ORG, { actor: foreignUserId, target: foreignUserId, newRole: 'admin' });
      // Same-org row whose ids happen to point at a user in the other tenant: the
      // row is ours to show, the name is not.
      const own = await seedEntry(ORG, { actor: foreignUserId, target: readerId });

      const body = (await (await getLog()).json()) as LogBody;

      // Mutation check: dropping `l.organization_id = ...` from the WHERE returns
      // the foreign row; dropping the join's organization predicate leaks
      // 'foreign-person' into actorUsername.
      expect(body.entries.map((e) => e.id)).toEqual([own]);
      expect(body.total).toBe(1);
      expect(body.entries[0].actorUsername).toBeNull();
      expect(body.entries[0].targetUsername).toBe('reader');
    });

    it('still names a soft-deleted user', async () => {
      const readerId = await seedReader();
      await seedEntry(ORG, { actor: readerId, target: targetUserId });
      await sql`UPDATE users SET deleted_at = NOW() WHERE id = ${targetUserId}`;

      const body = (await (await getLog()).json()) as LogBody;

      expect(body.entries[0].targetUsername).toBe('target');
    });

    it.each(['manager', 'team_member'])('refuses a %s with 403', async (role) => {
      await seedReader(role);
      await seedEntry(ORG);

      const response = await getLog();

      expect(response.status).toBe(403);
      expect(await response.text()).not.toContain('role_assigned');
    });

    it('filters by event type and by date range, and counts the filtered set', async () => {
      await seedReader();
      await seedEntry(ORG, { createdAt: '2026-01-10T00:00:00.000Z' });
      const mid = await seedEntry(ORG, { createdAt: '2026-02-10T00:00:00.000Z' });
      await seedEntry(ORG, { createdAt: '2026-03-10T00:00:00.000Z' });
      await seedEntry(ORG, { eventType: 'role_removed', createdAt: '2026-02-11T00:00:00.000Z' });

      const ranged = (await (
        await getLog('?from=2026-02-01&to=2026-03-01&eventType=role_assigned')
      ).json()) as LogBody;
      expect(ranged.entries.map((e) => e.id)).toEqual([mid]);
      expect(ranged.total).toBe(1);

      const removed = (await (await getLog('?eventType=role_removed')).json()) as LogBody;
      expect(removed.total).toBe(1);
    });

    it('pages with limit and offset while total stays the full count', async () => {
      await seedReader();
      for (let i = 0; i < 5; i++) {
        await seedEntry(ORG, { createdAt: `2026-01-0${i + 1}T00:00:00.000Z` });
      }

      const page = (await (await getLog('?limit=2&offset=2')).json()) as LogBody;

      expect(page.entries).toHaveLength(2);
      expect(page).toMatchObject({ total: 5, limit: 2, offset: 2 });
    });

    it.each([
      ['an unknown eventType', '?eventType=nope'],
      ['an unparseable from', '?from=yesterday-ish'],
      ['an unparseable to', '?to=garbage'],
      ['a zero limit', '?limit=0'],
      ['an over-large limit', '?limit=201'],
      ['a negative offset', '?offset=-1'],
      ['a fractional offset', '?offset=1.5'],
    ])('answers 400 for %s rather than an empty page', async (_label, query) => {
      await seedReader();
      await seedEntry(ORG);

      expect((await getLog(query)).status).toBe(400);
    });

    it('returns null metadata for a row that does not parse, not a 500', async () => {
      await seedReader();
      await seedEntry(ORG, { metadata: '{not json' });

      const response = await getLog();

      expect(response.status).toBe(200);
      expect(((await response.json()) as LogBody).entries[0].metadata).toBeNull();
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
