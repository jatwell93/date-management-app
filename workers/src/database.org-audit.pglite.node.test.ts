/**
 * Real-SQL (pglite) coverage for the **admin promotion** half of the
 * organization RBAC audit trail (migration 0013, task 3.1.g).
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

vi.mock('@neondatabase/serverless', () => ({
  neon: vi.fn(() => sqlHolder.current),
}));

import { createWorkersDatabase } from './database';
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
