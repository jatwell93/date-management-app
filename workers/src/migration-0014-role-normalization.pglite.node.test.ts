/**
 * Real-SQL coverage for migration 0014 (issue #517).
 *
 * The migration file itself is executed here — read from
 * `database/migrations/` rather than restated — so the thing under test is the
 * SQL that will run against production, not a paraphrase of it. The
 * `test:migrations:e2e` suite proves 0014 *applies* and is replayable; it does
 * not look at what the rows become, and the row-level decision is the part of
 * this change that is easy to get quietly wrong.
 *
 * The decision worth pinning: `'Manager'` splits on `clerk_user_id`. The Clerk
 * webhook produced that spelling **only** for Clerk's `admin` / `org:admin`, so
 * a Clerk-originated row holding it belongs to an administrator and mapping it
 * to `'manager'` would leave issue #517 unfixed — the three supplier-policy
 * gates normalize before comparing and would still refuse them. A row with no
 * `clerk_user_id` predates Clerk, where the spelling meant an actual manager,
 * so it takes the least-privilege reading instead.
 *
 * Runs under `vitest.node.config.mts` (`*.node.test.ts`, `npm run test:db`)
 * because pglite is WASM and needs a Node runtime.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPgliteHarness, type PgliteHarness } from './__tests__/pglite-db';

const MIGRATION = path.join(
  __dirname,
  '..',
  '..',
  'database',
  'migrations',
  '0014_normalize_user_roles.up.sql',
);

const ORG = 'org-roles';

describe('migration 0014 — normalize non-canonical user roles (real SQL)', () => {
  let harness: PgliteHarness;
  let sql: string;

  beforeAll(async () => {
    harness = await createPgliteHarness();
    sql = await readFile(MIGRATION, 'utf8');
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.pg.exec('DELETE FROM users');
  });

  const seed = async (username: string, role: string, clerkUserId: string | null) => {
    await harness.pg.query(
      `INSERT INTO users (organization_id, clerk_user_id, username, email, role, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW() - INTERVAL '1 day')`,
      [ORG, clerkUserId, username, `${username}@a.test`, role],
    );
  };

  const roleOf = async (username: string): Promise<string> => {
    const result = await harness.pg.query<{ role: string }>(
      'SELECT role FROM users WHERE username = $1',
      [username],
    );
    return result.rows[0].role;
  };

  const apply = async () => {
    await harness.pg.exec(sql);
  };

  it('promotes a Clerk-originated Manager to admin', async () => {
    await seed('clerk-manager', 'Manager', 'clerk_1');
    await apply();
    // Mutation check: dropping the `AND clerk_user_id IS NOT NULL` statement,
    // or reordering so the NULL branch runs first, leaves this at 'manager' —
    // which is the outcome that would leave #517 unfixed for the users who
    // actually reported it.
    expect(await roleOf('clerk-manager')).toBe('admin');
  });

  it('leaves a pre-Clerk Manager at manager', async () => {
    await seed('legacy-manager', 'Manager', null);
    await apply();
    // The least-privilege reading, and the reason the split exists: without it
    // this row would be promoted to admin on the strength of a spelling Express
    // used to mean something else.
    expect(await roleOf('legacy-manager')).toBe('manager');
  });

  it('normalizes Team Member regardless of origin', async () => {
    await seed('clerk-member', 'Team Member', 'clerk_2');
    await seed('legacy-member', 'Team Member', null);
    await apply();
    expect(await roleOf('clerk-member')).toBe('team_member');
    expect(await roleOf('legacy-member')).toBe('team_member');
  });

  it('leaves already-canonical rows untouched', async () => {
    await seed('canon-admin', 'admin', 'clerk_3');
    await seed('canon-member', 'team_member', 'clerk_4');
    const stamps = async () =>
      (
        await harness.pg.query<{ username: string; updated_at: Date }>(
          'SELECT username, updated_at FROM users ORDER BY username',
        )
      ).rows;
    const before = await stamps();

    await apply();

    expect(await roleOf('canon-admin')).toBe('admin');
    expect(await roleOf('canon-member')).toBe('team_member');
    // Not merely the same values — the same rows, every one of them. A
    // migration widened to rewrite each row to itself would pass the two
    // assertions above while touching `updated_at` on every user in the system.
    // That looks harmless right up until `updated_at` is the signal someone
    // sorts or alerts on. Both canonical roles are checked because a widened
    // predicate typically still excludes one of them.
    expect(await stamps()).toEqual(before);
  });

  it('is idempotent — a replay changes nothing', async () => {
    await seed('clerk-manager', 'Manager', 'clerk_1');
    await seed('legacy-manager', 'Manager', null);
    await seed('a-member', 'Team Member', 'clerk_2');

    await apply();
    const first = await harness.pg.query<{ username: string; role: string; updated_at: Date }>(
      'SELECT username, role, updated_at FROM users ORDER BY username',
    );

    // The forward-fix recovery path unstamps every migration above the one
    // being fixed and replays them against the existing schema, so this is the
    // property that recovery depends on, not a nicety.
    await apply();
    const second = await harness.pg.query<{ username: string; role: string; updated_at: Date }>(
      'SELECT username, role, updated_at FROM users ORDER BY username',
    );

    expect(second.rows).toEqual(first.rows);
  });

  it('does not touch rows in the state the application now writes', async () => {
    await seed('admin-user', 'admin', 'clerk_5');
    await seed('manager-user', 'manager', 'clerk_6');
    await seed('member-user', 'team_member', 'clerk_7');

    await apply();

    const result = await harness.pg.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM users
       WHERE role NOT IN ('admin', 'manager', 'team_member')`,
    );
    expect(result.rows[0].count).toBe(0);
  });
});
