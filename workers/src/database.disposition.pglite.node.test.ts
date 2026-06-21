/**
 * Real-data (pglite) coverage for disposition markdown-level capture.
 *
 * Verifies the real `processExpiredItem` from `createWorkersDatabase` snapshots the
 * markdown level (aligned with the expiry report windows) onto the
 * `expired_item_transactions` ledger, so sell-through reporting can tell at which
 * reduction depth stock actually moved.
 *
 * Runs under `vitest.node.config.mts` (`*.node.test.ts`, `npm run test:db`).
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
const USER_ID = 1;

describe('Workers disposition markdown capture (real SQL)', () => {
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
    await sql`DELETE FROM expired_item_transactions`;
    await sql`DELETE FROM inventory_items`;
    await sql`DELETE FROM products`;
  });

  // Seeds a product + inventory item N days from expiry and returns the item id.
  const seedItem = async (offsetDays: number, sku: string): Promise<number> => {
    const productRows = await sql`
      INSERT INTO products (organization_id, barcode, sku, name, cost_price)
      VALUES (${ORG}, ${sku}, ${sku}, ${'Item ' + sku}, 10)
      RETURNING id`;
    const productId = Number(productRows[0].id);
    const itemRows = await sql`
      INSERT INTO inventory_items (organization_id, product_id, expiry_date)
      VALUES (${ORG}, ${productId}, (CURRENT_DATE + ${offsetDays} * INTERVAL '1 day')::date)
      RETURNING id`;
    return Number(itemRows[0].id);
  };

  it.each([
    [10, 3],
    [45, 2],
    [75, 1],
    [150, null],
  ])('snapshots markdown level %i days out as %s on sold-through', async (offset, expected) => {
    const db = createWorkersDatabase({ NEON_CONNECTION_STRING: 'postgres://test' } as Env);
    const itemId = await seedItem(offset, `SKU-${offset}`);

    const txn = await db.processExpiredItem(itemId, USER_ID, ORG, 'sold_through');

    expect(txn.markdownLevel).toBe(expected);
    const stored = await sql`SELECT markdown_level FROM expired_item_transactions WHERE id = ${txn.id}`;
    expect(stored[0].markdown_level).toBe(expected);
  });

  it('records no markdown level when writing off expired stock', async () => {
    const db = createWorkersDatabase({ NEON_CONNECTION_STRING: 'postgres://test' } as Env);
    const itemId = await seedItem(-5, 'SKU-EXPIRED');

    const txn = await db.processExpiredItem(itemId, USER_ID, ORG, 'expired', 2);

    expect(txn.markdownLevel).toBeNull();
    expect(txn.action).toBe('expired');
  });

  it('aggregates sell-through counts by markdown level', async () => {
    const db = createWorkersDatabase({ NEON_CONNECTION_STRING: 'postgres://test' } as Env);

    // Two sold at Markdown 3, one at Markdown 2, one at Markdown 1.
    for (const [offset, sku] of [
      [10, 'A'],
      [20, 'B'],
      [45, 'C'],
      [75, 'D'],
    ] as const) {
      const id = await seedItem(offset, `ST-${sku}`);
      await db.processExpiredItem(id, USER_ID, ORG, 'sold_through');
    }
    // A write-off must not appear in sell-through counts.
    const expiredId = await seedItem(-3, 'ST-EXPIRED');
    await db.processExpiredItem(expiredId, USER_ID, ORG, 'expired', 1);

    const rows = await db.getSellThroughByMarkdownLevel(ORG);
    const byLevel = new Map(rows.map((r) => [r.markdownLevel, r.soldCount]));

    expect(byLevel.get(3)).toBe(2);
    expect(byLevel.get(2)).toBe(1);
    expect(byLevel.get(1)).toBe(1);
    // Only sold-through rows are counted (the expired write-off is excluded).
    const total = rows.reduce((sum, r) => sum + r.soldCount, 0);
    expect(total).toBe(4);
  });
});
