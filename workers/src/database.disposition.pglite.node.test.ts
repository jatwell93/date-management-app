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
    const stored =
      await sql`SELECT markdown_level FROM expired_item_transactions WHERE id = ${txn.id}`;
    expect(stored[0].markdown_level).toBe(expected);
  });

  it('records no markdown level when writing off expired stock', async () => {
    const db = createWorkersDatabase({ NEON_CONNECTION_STRING: 'postgres://test' } as Env);
    const itemId = await seedItem(-5, 'SKU-EXPIRED');

    const txn = await db.processExpiredItem(itemId, USER_ID, ORG, 'expired', 1);

    expect(txn.markdownLevel).toBeNull();
    expect(txn.action).toBe('expired');
  });

  it('records a zero financial loss as 0, not NULL, for a zero-cost expired write-off', async () => {
    // A $0 cost item still represents a real disposition: the loss applies and
    // equals zero. Storing NULL (loss not applicable) would diverge from the
    // SQLite backend, which records 0. Guards against `value || null` coercion.
    const db = createWorkersDatabase({ NEON_CONNECTION_STRING: 'postgres://test' } as Env);
    const productRows = await sql`
      INSERT INTO products (organization_id, barcode, sku, name, cost_price)
      VALUES (${ORG}, ${'ZERO'}, ${'ZERO'}, ${'Zero Cost'}, 0)
      RETURNING id`;
    const productId = Number(productRows[0].id);
    const itemRows = await sql`
      INSERT INTO inventory_items (organization_id, product_id, expiry_date, status)
      VALUES (${ORG}, ${productId}, (CURRENT_DATE - INTERVAL '1 day')::date, ${'Expired'})
      RETURNING id`;
    const itemId = Number(itemRows[0].id);

    const txn = await db.processExpiredItem(itemId, USER_ID, ORG, 'expired', 1);
    expect(txn.financialLoss).toBe(0);

    const stored = await sql`
      SELECT financial_loss FROM expired_item_transactions WHERE id = ${txn.id}`;
    expect(stored[0].financial_loss).toBe(0);
    expect(stored[0].financial_loss).not.toBeNull();
  });

  it('processes a multi-unit expired write-off as one ledger row and removes processed rows', async () => {
    const db = createWorkersDatabase({ NEON_CONNECTION_STRING: 'postgres://test' } as Env);
    const productRows = await sql`
      INSERT INTO products (organization_id, barcode, sku, name, cost_price)
      VALUES (${ORG}, ${'MULTI'}, ${'MULTI'}, ${'Multi Item'}, 7)
      RETURNING id`;
    const productId = Number(productRows[0].id);
    const areaRows = await sql`
      INSERT INTO store_areas (organization_id, name, sub_department)
      VALUES (${ORG}, ${'Fridge'}, ${'Cold Chain'})
      RETURNING id`;
    const locationId = Number(areaRows[0].id);
    const ids: number[] = [];
    for (const offset of [-7, -5, -3, -1]) {
      const itemRows = await sql`
        INSERT INTO inventory_items (organization_id, product_id, location_id, expiry_date, status)
        VALUES (${ORG}, ${productId}, ${locationId}, (CURRENT_DATE + ${offset} * INTERVAL '1 day')::date, ${'Expired'})
        RETURNING id`;
      ids.push(Number(itemRows[0].id));
    }

    const before = await db.getExpiredItems(ORG);
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ sku: 'MULTI', quantityAvailable: 4 });

    const txn = await db.processExpiredItem(ids[1], USER_ID, ORG, 'expired', 3);

    expect(txn).toMatchObject({
      inventoryItemId: ids[1],
      action: 'expired',
      unitsDiscarded: 3,
      financialLoss: 21,
    });

    const transactions = await sql`
      SELECT inventory_item_id, units_discarded, financial_loss
      FROM expired_item_transactions`;
    expect(transactions).toEqual([
      expect.objectContaining({
        inventory_item_id: ids[1],
        units_discarded: 3,
        financial_loss: 21,
      }),
    ]);

    const statuses = await sql`
      SELECT id, status FROM inventory_items WHERE product_id = ${productId} ORDER BY expiry_date ASC`;
    expect(statuses.slice(0, 3).map((row) => row.status)).toEqual([
      'Processed',
      'Processed',
      'Processed',
    ]);
    expect(statuses[3].status).toBe('Expired');

    const after = await db.getExpiredItems(ORG);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ sku: 'MULTI', quantityAvailable: 1 });

    await expect(db.processExpiredItem(ids[3], USER_ID, ORG, 'expired', 2)).rejects.toThrow(
      'Cannot discard 2 units; only 1 expired units are available',
    );
  });

  it('writes off a future-dated Markdown item shown in the worklist (issue #268)', async () => {
    // Regression: the worklist (getExpiredItems) surfaces Markdown items before
    // their expiry date, so the write-off matcher must accept the same statuses.
    // Previously the matcher only matched 'Expired', so processing a future-dated
    // Markdown item threw "Cannot discard 1 units; only 0 expired units are available".
    const db = createWorkersDatabase({ NEON_CONNECTION_STRING: 'postgres://test' } as Env);
    const productRows = await sql`
      INSERT INTO products (organization_id, barcode, sku, name, cost_price)
      VALUES (${ORG}, ${'MKDN'}, ${'MKDN'}, ${'Markdown Item'}, 5)
      RETURNING id`;
    const productId = Number(productRows[0].id);
    const areaRows = await sql`
      INSERT INTO store_areas (organization_id, name, sub_department)
      VALUES (${ORG}, ${'Shelf'}, ${'Grocery'})
      RETURNING id`;
    const locationId = Number(areaRows[0].id);
    // 20 days to expiry => Markdown 3 window, not yet expired.
    const itemRows = await sql`
      INSERT INTO inventory_items (organization_id, product_id, location_id, expiry_date, status)
      VALUES (${ORG}, ${productId}, ${locationId}, (CURRENT_DATE + INTERVAL '20 days')::date, ${'Markdown 3'})
      RETURNING id`;
    const itemId = Number(itemRows[0].id);

    // The worklist surfaces it...
    const worklist = await db.getExpiredItems(ORG);
    expect(worklist).toHaveLength(1);
    expect(worklist[0]).toMatchObject({ sku: 'MKDN', quantityAvailable: 1 });

    // ...and the write-off matcher must agree, not reject it.
    const txn = await db.processExpiredItem(itemId, USER_ID, ORG, 'expired', 1);
    expect(txn).toMatchObject({ inventoryItemId: itemId, action: 'expired', unitsDiscarded: 1 });

    const after = await db.getExpiredItems(ORG);
    expect(after).toHaveLength(0);
  });

  it('merges mixed Expired + Markdown stock at one location into a single processable row', async () => {
    // The worklist groups by product/location/cost_price (not status) so it lines up
    // with the write-off matcher's pool. A product with both an expired and a future
    // Markdown unit at the same location must be one row the user can fully write off.
    const db = createWorkersDatabase({ NEON_CONNECTION_STRING: 'postgres://test' } as Env);
    const productRows = await sql`
      INSERT INTO products (organization_id, barcode, sku, name, cost_price)
      VALUES (${ORG}, ${'MIX'}, ${'MIX'}, ${'Mixed Item'}, 4)
      RETURNING id`;
    const productId = Number(productRows[0].id);
    const areaRows = await sql`
      INSERT INTO store_areas (organization_id, name, sub_department)
      VALUES (${ORG}, ${'Bay'}, ${'Grocery'})
      RETURNING id`;
    const locationId = Number(areaRows[0].id);
    // One already expired, one future-dated Markdown 3 — same product/location/cost.
    await sql`
      INSERT INTO inventory_items (organization_id, product_id, location_id, expiry_date, status)
      VALUES (${ORG}, ${productId}, ${locationId}, (CURRENT_DATE - INTERVAL '2 days')::date, ${'Expired'})`;
    await sql`
      INSERT INTO inventory_items (organization_id, product_id, location_id, expiry_date, status)
      VALUES (${ORG}, ${productId}, ${locationId}, (CURRENT_DATE + INTERVAL '20 days')::date, ${'Markdown 3'})`;

    const worklist = await db.getExpiredItems(ORG);
    expect(worklist).toHaveLength(1);
    // Earliest-expiry item drives the displayed status (the one processed first).
    expect(worklist[0]).toMatchObject({
      sku: 'MIX',
      quantityAvailable: 2,
      status: 'Expired',
      locationName: 'Bay',
    });

    // The whole pool (both statuses) can be written off in one action.
    const txn = await db.processExpiredItem(worklist[0].id, USER_ID, ORG, 'expired', 2);
    expect(txn).toMatchObject({ action: 'expired', unitsDiscarded: 2 });
    expect(await db.getExpiredItems(ORG)).toHaveLength(0);
  });

  it('reports expired losses from the transaction ledger', async () => {
    const db = createWorkersDatabase({ NEON_CONNECTION_STRING: 'postgres://test' } as Env);
    const productRows = await sql`
      INSERT INTO products (organization_id, barcode, sku, name, cost_price)
      VALUES (${ORG}, ${'LOSS'}, ${'LOSS'}, ${'Loss Item'}, 9)
      RETURNING id`;
    const productId = Number(productRows[0].id);
    const areaRows = await sql`
      INSERT INTO store_areas (organization_id, name, sub_department)
      VALUES (${ORG}, ${'Aisle'}, ${'General'})
      RETURNING id`;
    const locationId = Number(areaRows[0].id);
    const itemRows = await sql`
      INSERT INTO inventory_items (organization_id, product_id, location_id, expiry_date, status)
      VALUES (${ORG}, ${productId}, ${locationId}, (CURRENT_DATE - INTERVAL '2 days')::date, ${'Sold Through'})
      RETURNING id`;
    await sql`
      INSERT INTO expired_item_transactions
        (organization_id, inventory_item_id, user_id, action, units_discarded, financial_loss)
      VALUES (${ORG}, ${Number(itemRows[0].id)}, ${USER_ID}, ${'expired'}, 1, 9)`;

    expect(await db.getLossBySkuReport(ORG)).toEqual([
      expect.objectContaining({
        sku: 'LOSS',
        productName: 'Loss Item',
        totalLoss: 9,
        count: 1,
      }),
    ]);
    expect(await db.getLossByDepartmentReport(ORG)).toEqual([
      expect.objectContaining({
        locationName: 'Aisle',
        totalLoss: 9,
        count: 1,
      }),
    ]);
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
