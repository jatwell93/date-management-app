/**
 * One active admin per organization (migration 0020, #474), seen from the Clerk-driven
 * writers: the membership webhook, the user sync, and the race fallback.
 *
 * The race is simulated, not run: pglite serialises statements on one connection, so
 * two concurrent requests cannot interleave. What it *can* do is let the rival win in
 * the gap between the fast-path read and the write, which is exactly the state the
 * unique index exists to catch. The index itself is real, so the violation is real.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NeonQueryFunction } from '@neondatabase/serverless';
import { createPgliteHarness, createTaggedSql, type PgliteHarness } from '../__tests__/pglite-db';
import {
  processClerkWebhookEvent,
  upsertClerkUser,
  withAdminSlotFallback,
} from './clerk-persistence';

const ORG = 'org-1';
const CLERK_ORG = 'clerk-org-1';

describe('the admin slot (real SQL)', () => {
  let harness: PgliteHarness;
  let sql: NeonQueryFunction<false, false>;

  beforeAll(async () => {
    harness = await createPgliteHarness();
    sql = createTaggedSql(harness.pg);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await sql`DELETE FROM org_audit_log`;
    await sql`DELETE FROM subscription_tiers`;
    await sql`DELETE FROM users`;
    await sql`DELETE FROM organizations`;
    await sql`
      INSERT INTO organizations (id, clerk_organization_id, name, slug, updated_at)
      VALUES (${ORG}, ${CLERK_ORG}, 'Org 1', 'org-1', NOW())`;
  });

  const seedUser = async (clerkUserId: string, role: string, deleted = false): Promise<void> => {
    await sql`
      INSERT INTO users (organization_id, clerk_user_id, email, username, role, deleted_at, updated_at)
      VALUES (${ORG}, ${clerkUserId}, ${clerkUserId + '@a.test'}, ${clerkUserId}, ${role},
              ${deleted ? new Date() : null}, NOW())`;
  };

  const roleOf = async (clerkUserId: string): Promise<string | undefined> =>
    (await sql`SELECT role FROM users WHERE clerk_user_id = ${clerkUserId}`)[0]?.role as
      string | undefined;

  const membership = (clerkUserId: string, role: string) => ({
    type: 'organizationMembership.created',
    data: {
      role,
      organization: { id: CLERK_ORG, name: 'Org 1', slug: 'org-1' },
      public_user_data: { user_id: clerkUserId, identifier: `${clerkUserId}@a.test` },
    },
  });

  const readAudit = async () =>
    (await sql`
      SELECT target_user_id, old_role, new_role, metadata
      FROM org_audit_log ORDER BY id`) as unknown as {
      target_user_id: number;
      old_role: string | null;
      new_role: string;
      metadata: unknown;
    }[];

  describe('the membership webhook', () => {
    it('stores a second org:admin as manager and records what Clerk asked for', async () => {
      await seedUser('clerk-boss', 'admin');

      await processClerkWebhookEvent(sql, membership('clerk-second', 'org:admin'));

      expect(await roleOf('clerk-second')).toBe('manager');
      expect(await roleOf('clerk-boss')).toBe('admin');
      const rows = await readAudit();
      expect(rows).toHaveLength(1);
      expect(rows[0].new_role).toBe('manager');
      const metadata =
        typeof rows[0].metadata === 'string' ? JSON.parse(rows[0].metadata) : rows[0].metadata;
      expect(metadata).toMatchObject({
        trigger: 'clerk-webhook',
        clerkOrganizationRole: 'org:admin',
        adminSlotTaken: true,
        requestedRole: 'admin',
      });
    });

    it('stores the first org:admin as admin, with no downgrade flag', async () => {
      await processClerkWebhookEvent(sql, membership('clerk-boss', 'org:admin'));

      expect(await roleOf('clerk-boss')).toBe('admin');
      const rows = await readAudit();
      const metadata =
        typeof rows[0].metadata === 'string' ? JSON.parse(rows[0].metadata) : rows[0].metadata;
      expect(metadata).not.toHaveProperty('adminSlotTaken');
    });

    it('keeps the current admin an admin when Clerk redelivers their own grant', async () => {
      await processClerkWebhookEvent(sql, membership('clerk-boss', 'org:admin'));
      await processClerkWebhookEvent(sql, membership('clerk-boss', 'org:admin'));

      expect(await roleOf('clerk-boss')).toBe('admin');
      expect(await readAudit()).toHaveLength(1);
    });

    it('does not let a soft-deleted admin hold the slot', async () => {
      await seedUser('clerk-gone', 'admin', true);

      await processClerkWebhookEvent(sql, membership('clerk-new', 'org:admin'));

      expect(await roleOf('clerk-new')).toBe('admin');
    });

    it('stores a returning soft-deleted admin as manager when the slot has moved on', async () => {
      await seedUser('clerk-gone', 'admin', true);
      await seedUser('clerk-successor', 'admin');

      await processClerkWebhookEvent(sql, membership('clerk-gone', 'org:admin'));

      expect(await roleOf('clerk-gone')).toBe('manager');
      expect(await roleOf('clerk-successor')).toBe('admin');
    });
  });

  describe('upsertClerkUser', () => {
    it('reports whether it had to give up the admin slot', async () => {
      await seedUser('clerk-boss', 'admin');

      const result = await upsertClerkUser(sql, {
        clerkUserId: 'clerk-late',
        organizationId: ORG,
        role: 'admin',
        email: 'late@a.test',
        username: 'late',
      });

      expect(result).toEqual({ role: 'manager', adminSlotTaken: true });
      expect(await roleOf('clerk-late')).toBe('manager');
    });
  });

  describe('a rival that wins between the read and the write', () => {
    const insertWithRole = async (clerkUserId: string, role: string): Promise<void> => {
      await sql`
        INSERT INTO users (organization_id, clerk_user_id, email, username, role, updated_at)
        VALUES (${ORG}, ${clerkUserId}, ${clerkUserId + '@a.test'}, ${clerkUserId}, ${role}, NOW())`;
    };

    it('is absorbed: the loser is rerun as manager rather than failing', async () => {
      let attempts = 0;

      const outcome = await withAdminSlotFallback(
        sql,
        { organizationId: ORG, clerkUserId: 'clerk-loser', role: 'admin' },
        async (role) => {
          attempts += 1;
          if (attempts === 1) {
            // The rival lands after the fast-path read said the slot was free.
            await seedUser('clerk-rival', 'admin');
          }
          await insertWithRole('clerk-loser', role);
        },
      );

      expect(attempts).toBe(2);
      expect(outcome).toMatchObject({ role: 'manager', adminSlotTaken: true });
      expect(await roleOf('clerk-rival')).toBe('admin');
      expect(await roleOf('clerk-loser')).toBe('manager');
    });

    it('does not swallow an unrelated unique violation', async () => {
      await seedUser('clerk-dup', 'team_member');

      await expect(
        withAdminSlotFallback(
          sql,
          { organizationId: ORG, clerkUserId: 'clerk-x', role: 'admin' },
          async () => {
            await insertWithRole('clerk-dup', 'team_member');
          },
        ),
      ).rejects.toMatchObject({ code: '23505' });
    });
  });
});
