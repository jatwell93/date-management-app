/**
 * Real-SQL coverage for migration 0018 (issue #560).
 *
 * The migration file is executed as written, inside a transaction the way the
 * runner applies a `transaction: required` entry, against a database migrated
 * through 0017. `test:migrations:e2e` proves 0018 applies and replays; this
 * pins what it does to rows:
 *
 *   - it deletes exactly the shape the removed register route produced —
 *     `default-org`, role `'user'`, no Clerk id — and nothing else;
 *   - after it, the column refuses a non-canonical role;
 *   - if any other non-canonical role exists, the constraint fails and the
 *     delete is rolled back with it, rather than half-applying.
 *
 * Runs under `vitest.node.config.mts` (`*.node.test.ts`, `npm run test:db`)
 * because pglite is WASM and needs a Node runtime.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPgliteHarness, seedOrganization, type PgliteHarness } from './__tests__/pglite-db';

const MIGRATION = path.join(
  __dirname,
  '..',
  '..',
  'database',
  'migrations',
  '0018_users_role_canonical.up.sql',
);

describe('migration 0018 — remove legacy role=user accounts, constrain users.role (real SQL)', () => {
  let harness: PgliteHarness;
  let sql: string;

  beforeAll(async () => {
    sql = await readFile(MIGRATION, 'utf8');
  });

  beforeEach(async () => {
    // A fresh clone per test: once a case applies 0018, the constraint would
    // otherwise stop the next case from seeding the rows it needs.
    harness = await createPgliteHarness({ through: '0017' });
    await seedOrganization(harness.pg, 'default-org', 'Default Organization');
    await seedOrganization(harness.pg, 'org-real', 'Real Org');
  }, 120_000);

  afterEach(async () => {
    await harness.close();
  });

  const seed = async (
    username: string,
    organizationId: string,
    role: string,
    clerkUserId: string | null,
  ) => {
    await harness.pg.query(
      `INSERT INTO users (organization_id, clerk_user_id, username, email, role, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [organizationId, clerkUserId, username, `${username}@example.com`, role],
    );
  };

  const usernames = async (): Promise<string[]> => {
    const result = await harness.pg.query<{ username: string }>(
      'SELECT username FROM users ORDER BY username',
    );
    return result.rows.map((row) => row.username);
  };

  /** Applies 0018 as the runner does: one transaction, rolled back on failure. */
  const apply = async () => {
    await harness.pg.exec('BEGIN');
    try {
      await harness.pg.exec(sql);
      await harness.pg.exec('COMMIT');
    } catch (error) {
      await harness.pg.exec('ROLLBACK');
      throw error;
    }
  };

  it('deletes only legacy register-route accounts and keeps every canonical user', async () => {
    await seed('legacy-1', 'default-org', 'user', null);
    await seed('legacy-2', 'default-org', 'user', null);
    await seed('default-admin', 'default-org', 'admin', null);
    await seed('default-member', 'default-org', 'team_member', 'clerk_d');
    await seed('real-admin', 'org-real', 'admin', 'clerk_r');
    await seed('real-manager', 'org-real', 'manager', null);

    await apply();

    expect(await usernames()).toEqual([
      'default-admin',
      'default-member',
      'real-admin',
      'real-manager',
    ]);
  });

  it('refuses a non-canonical role once applied', async () => {
    await apply();

    await expect(seed('late', 'org-real', 'user', 'clerk_late')).rejects.toMatchObject({
      code: '23514',
      constraint: 'users_role_canonical',
    });
    await expect(seed('cased', 'org-real', 'Manager', 'clerk_cased')).rejects.toMatchObject({
      code: '23514',
    });
    // The control: every canonical value is still accepted.
    for (const role of ['admin', 'manager', 'team_member']) {
      await seed(`ok-${role}`, 'org-real', role, null);
    }
    expect(await usernames()).toEqual(['ok-admin', 'ok-manager', 'ok-team_member']);
  });

  it.each([
    ['a role=user account with a Clerk id', 'default-org', 'user', 'clerk_x'],
    ['a role=user account in another organization', 'org-real', 'user', null],
    ['any other non-canonical spelling', 'org-real', 'Manager', 'clerk_m'],
  ])(
    'fails and rolls the delete back when %s remains',
    async (_label, organizationId, role, clerkUserId) => {
      await seed('legacy', 'default-org', 'user', null);
      await seed('leftover', organizationId, role, clerkUserId);

      await expect(apply()).rejects.toMatchObject({ code: '23514' });

      // Nothing half-applied: the matching legacy row is still there, and so
      // is the row that needs a human decision.
      expect(await usernames()).toEqual(['leftover', 'legacy']);
      const constraint = await harness.pg.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'users_role_canonical'`,
      );
      expect(constraint.rows).toEqual([]);
    },
  );

  it('is idempotent when replayed over its own result', async () => {
    await seed('legacy', 'default-org', 'user', null);
    await seed('keep', 'org-real', 'admin', null);

    await apply();
    await apply();

    expect(await usernames()).toEqual(['keep']);
    const constraints = await harness.pg.query(
      `SELECT conname FROM pg_constraint WHERE conname = 'users_role_canonical'`,
    );
    expect(constraints.rows).toHaveLength(1);
  });
});
