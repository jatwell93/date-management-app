/**
 * Real-SQL (pglite) coverage for `getDailyUsageReport` user names.
 *
 * The report joins `audit_log` to `users`; the join is scoped to the audit
 * row's organisation so a cross-tenant `user_id` can never leak another
 * organisation's username (docs/cross-tenant-isolation-assurance.md).
 *
 * Runs under `vitest.node.config.mts` (`npm run test:db`) because pglite is WASM.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NeonQueryFunction } from '@neondatabase/serverless';
import type { Env } from './types/env';
import {
  createPgliteHarness,
  createTaggedSql,
  seedOrganization,
  type PgliteHarness,
} from './__tests__/pglite-db';

const sqlHolder = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('@neondatabase/serverless', () => ({
  neon: vi.fn(() => sqlHolder.current),
}));

import { createWorkersDatabase } from './database';

const ORG_A = 'org-usage-a';
const ORG_B = 'org-usage-b';

describe('getDailyUsageReport user names (real SQL)', () => {
  let harness: PgliteHarness;
  let sql: NeonQueryFunction<false, false>;

  beforeAll(async () => {
    harness = await createPgliteHarness();
    sql = createTaggedSql(harness.pg);
    sqlHolder.current = sql;
    await seedOrganization(harness.pg, ORG_A, 'Org A');
    await seedOrganization(harness.pg, ORG_B, 'Org B');
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await sql`DELETE FROM audit_log`;
    await sql`DELETE FROM users`;
  });

  const makeDb = () => createWorkersDatabase({ NEON_CONNECTION_STRING: 'postgres://test' } as Env);

  const seedUser = async (org: string, username: string | null, email: string) => {
    const rows = await sql`
      INSERT INTO users (organization_id, username, email, role, updated_at)
      VALUES (${org}, ${username}, ${email}, 'team_member', NOW())
      RETURNING id`;
    return Number(rows[0].id);
  };

  const seedAudit = async (org: string, userId: number) => {
    await sql`
      INSERT INTO audit_log (organization_id, user_id, action, change_description)
      VALUES (${org}, ${userId}, 'UPDATE', 'item created')`;
  };

  it("names the organisation's own users and never another organisation's", async () => {
    const alice = await seedUser(ORG_A, 'alice', 'alice@a.test');
    const bob = await seedUser(ORG_B, 'bob', 'bob@b.test');
    await seedAudit(ORG_A, alice);
    await seedAudit(ORG_B, bob);

    const report = await makeDb().getDailyUsageReport(ORG_A);

    expect(report).toHaveLength(1);
    expect(report[0]).toMatchObject({ user_id: alice, user_name: 'alice' });
    expect(JSON.stringify(report)).not.toContain('bob');
  });

  it('gives a null name for an audit row whose user is in another organisation', async () => {
    const bob = await seedUser(ORG_B, 'bob', 'bob@b.test');
    // Mutation check: removing `AND u.organization_id = al.organization_id`
    // from the join makes user_name 'bob' here.
    await seedAudit(ORG_A, bob);

    const report = await makeDb().getDailyUsageReport(ORG_A);

    expect(report).toHaveLength(1);
    expect(report[0]).toMatchObject({ user_id: bob, user_name: null });
  });

  it('falls back to the email when the user has no username', async () => {
    const carol = await seedUser(ORG_A, null, 'carol@a.test');
    await seedAudit(ORG_A, carol);

    const report = await makeDb().getDailyUsageReport(ORG_A);

    expect(report[0]).toMatchObject({ user_name: 'carol@a.test' });
  });
});
