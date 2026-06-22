/**
 * Real-data (pglite) coverage for the expiry report counts.
 *
 * The sibling `database.report.node.test.ts` mocks `sql` and only asserts the
 * query *string*, so it cannot catch the original bug where every summary
 * measure came back 0 (the old query filtered on a `status = 'Markdown N'`
 * column this app never populates). This test runs the *real* report SQL from
 * `createWorkersDatabase` against an in-process Postgres, seeding rows across
 * every expiry-date window, and asserts the derived counts are correct and
 * scoped to the organization.
 *
 * Runs under `vitest.node.config.mts` (`*.node.test.ts`, `npm run test:db`)
 * because pglite is WASM and needs a Node runtime.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NeonQueryFunction } from '@neondatabase/serverless';
import type { Env } from './types/env';
import { createPgliteHarness, createTaggedSql, type PgliteHarness } from './__tests__/pglite-db';

const sqlHolder = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('@neondatabase/serverless', () => ({
  neon: vi.fn(() => sqlHolder.current),
}));

import { createWorkersDatabase } from './database';

const ORG = 'org-a';
const OTHER_ORG = 'org-b';

// Offsets in days from today and the windows they land in.
//  -10 expired | 5,20 markdown3 (0-30) | 45 markdown2 (31-60)
//  75 markdown1 (61-90) | 100 next-month (91-120) | 150 beyond window
const ORG_OFFSETS = [-10, 5, 20, 45, 75, 100, 150];
// org-b rows that would inflate org-a counts if scoping regressed.
const OTHER_OFFSETS = [5, 100];

describe('Workers expiry report counts (real SQL)', () => {
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
    await sql`DELETE FROM inventory_items`;
    const seed = async (org: string, offset: number) =>
      sql`INSERT INTO inventory_items (organization_id, expiry_date)
          VALUES (${org}, (CURRENT_DATE + ${offset} * INTERVAL '1 day')::date)`;
    for (const offset of ORG_OFFSETS) await seed(ORG, offset);
    for (const offset of OTHER_OFFSETS) await seed(OTHER_ORG, offset);
  });

  it('derives non-zero overall summary measures from expiry-date windows', async () => {
    const db = createWorkersDatabase({ NEON_CONNECTION_STRING: 'postgres://test' } as Env);

    const report = await db.getOverallExpiryReport(ORG);

    expect(report).toMatchObject({
      total_expiring: 7,
      expired_count: 1,
      markdown1_count: 1, // 61-90 days
      markdown2_count: 1, // 31-60 days
      markdown3_count: 2, // 0-30 days
      total_markdown: 4, // 0-90 days
      expiry_risk_count: 2, // 0-30 days
      next_month_markdown_count: 1, // 91-120 days
      active_expiry_stock_count: 6, // >= 0 days (all but the expired row)
    });
  });

  it('scopes counts to the requested organization', async () => {
    const db = createWorkersDatabase({ NEON_CONNECTION_STRING: 'postgres://test' } as Env);

    const report = await db.getOverallExpiryReport(ORG);

    // org-b also has a 0-30 and a 91-120 row; counts must ignore them.
    expect(report.expiry_risk_count).toBe(2);
    expect(report.next_month_markdown_count).toBe(1);
    expect(report.active_expiry_stock_count).toBe(6);
  });

  it('returns monthly rows that sum to the org total', async () => {
    const db = createWorkersDatabase({ NEON_CONNECTION_STRING: 'postgres://test' } as Env);

    const rows = await db.getMonthlyExpiryReport(ORG);

    expect(rows.length).toBeGreaterThan(0);
    const totalExpiring = rows.reduce((sum, row) => sum + row.total_expiring, 0);
    expect(totalExpiring).toBe(ORG_OFFSETS.length);
  });
});
