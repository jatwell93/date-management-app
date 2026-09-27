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
    await sql`INSERT INTO organizations (id, name, slug, updated_at)
              VALUES (${ORG}, 'Org A', 'org-a', NOW())`;
    // expired_item_transactions.user_id is a real FK — USER_ID writes ledger rows.
    await sql`INSERT INTO users (id, organization_id, username, role, updated_at)
              VALUES (${USER_ID}, ${ORG}, 'actor', 'admin', NOW())`;
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await sql`DELETE FROM expired_item_transactions`;
    await sql`DELETE FROM inventory_items`;
    await sql`DELETE FROM products`;
    // store_areas was left behind between tests, which only worked because the
    // harness was missing production's
    // `store_areas_organization_id_name_sub_department_key`
    // (`database/migrations/0000_baseline.up.sql:397`). Three tests here insert
    // ('Shelf', 'Grocery') for the same organization -- rows production would
    // have refused. With the index in place the leak is a duplicate-key error,
    // so the rows are cleared like every other table.
    await sql`DELETE FROM store_areas`;
  });

  // Seeds a product + inventory item N days from expiry and returns the item id.
  const seedItem = async (offsetDays: number, sku: string): Promise<number> => {
    const productRows = await sql`
      INSERT INTO products (organization_id, barcode, sku, name, cost_price, updated_at)
      VALUES (${ORG}, ${sku}, ${sku}, ${'Item ' + sku}, 10, NOW())
      RETURNING id`;
    const productId = Number(productRows[0].id);
    const areaRows = await sql`
      INSERT INTO store_areas (organization_id, name, updated_at)
      VALUES (${ORG}, ${'Loc ' + sku}, NOW())
      RETURNING id`;
    const itemRows = await sql`
      INSERT INTO inventory_items (organization_id, product_id, location_id, expiry_date, updated_at)
      VALUES (${ORG}, ${productId}, ${Number(areaRows[0].id)}, (CURRENT_DATE + ${offsetDays} * INTERVAL '1 day')::date, NOW())
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
      INSERT INTO products (organization_id, barcode, sku, name, cost_price, updated_at)
      VALUES (${ORG}, ${'ZERO'}, ${'ZERO'}, ${'Zero Cost'}, 0, NOW())
      RETURNING id`;
    const productId = Number(productRows[0].id);
    const areaRows = await sql`
      INSERT INTO store_areas (organization_id, name, updated_at)
      VALUES (${ORG}, ${'Zero Aisle'}, NOW())
      RETURNING id`;
    const itemRows = await sql`
      INSERT INTO inventory_items (organization_id, product_id, location_id, expiry_date, status, updated_at)
      VALUES (${ORG}, ${productId}, ${Number(areaRows[0].id)}, (CURRENT_DATE - INTERVAL '1 day')::date, ${'Expired'}, NOW())
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
      INSERT INTO products (organization_id, barcode, sku, name, cost_price, updated_at)
      VALUES (${ORG}, ${'MULTI'}, ${'MULTI'}, ${'Multi Item'}, 7, NOW())
      RETURNING id`;
    const productId = Number(productRows[0].id);
    const areaRows = await sql`
      INSERT INTO store_areas (organization_id, name, sub_department, updated_at)
      VALUES (${ORG}, ${'Fridge'}, ${'Cold Chain'}, NOW())
      RETURNING id`;
    const locationId = Number(areaRows[0].id);
    const ids: number[] = [];
    for (const offset of [-7, -5, -3, -1]) {
      const itemRows = await sql`
        INSERT INTO inventory_items (organization_id, product_id, location_id, expiry_date, status, updated_at)
        VALUES (${ORG}, ${productId}, ${locationId}, (CURRENT_DATE + ${offset} * INTERVAL '1 day')::date, ${'Expired'}, NOW())
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

    // Over-count write-off: the remaining pool has 1 marker row but the user
    // physically counted 2 expired units. We record the full entered quantity in
    // the ledger and clear the worklist entry, rather than rejecting. See #268.
    const overTxn = await db.processExpiredItem(ids[3], USER_ID, ORG, 'expired', 2);
    expect(overTxn).toMatchObject({
      inventoryItemId: ids[3],
      action: 'expired',
      unitsDiscarded: 2,
      financialLoss: 14,
    });
    expect(await db.getExpiredItems(ORG)).toHaveLength(0);
  });

  it('records more expired units than there are scanned rows (issue #268)', async () => {
    // Reproduces the reported bug: the scan flow logs a single SKU + expiry marker
    // (one inventory row), so the worklist shows quantityAvailable: 1. The user
    // reconciles real stock in the back office and writes off the true count (15).
    // The ledger must record all 15 units and clear the worklist entry.
    const db = createWorkersDatabase({ NEON_CONNECTION_STRING: 'postgres://test' } as Env);
    const productRows = await sql`
      INSERT INTO products (organization_id, barcode, sku, name, cost_price, updated_at)
      VALUES (${ORG}, ${'ONE'}, ${'ONE'}, ${'Single Marker'}, 3, NOW())
      RETURNING id`;
    const productId = Number(productRows[0].id);
    const areaRows = await sql`
      INSERT INTO store_areas (organization_id, name, sub_department, updated_at)
      VALUES (${ORG}, ${'Shelf'}, ${'Grocery'}, NOW())
      RETURNING id`;
    const locationId = Number(areaRows[0].id);
    const itemRows = await sql`
      INSERT INTO inventory_items (organization_id, product_id, location_id, expiry_date, status, updated_at)
      VALUES (${ORG}, ${productId}, ${locationId}, (CURRENT_DATE - INTERVAL '1 day')::date, ${'Expired'}, NOW())
      RETURNING id`;
    const itemId = Number(itemRows[0].id);

    const before = await db.getExpiredItems(ORG);
    expect(before[0]).toMatchObject({ sku: 'ONE', quantityAvailable: 1 });

    const txn = await db.processExpiredItem(itemId, USER_ID, ORG, 'expired', 15);
    expect(txn).toMatchObject({
      inventoryItemId: itemId,
      action: 'expired',
      unitsDiscarded: 15,
      financialLoss: 45,
    });

    // The single marker row is dispositioned and the worklist entry is cleared.
    expect(await db.getExpiredItems(ORG)).toHaveLength(0);
    // The realized-loss ledger reflects the full entered quantity.
    expect(await db.getExpiredLossBySku(ORG)).toEqual([
      expect.objectContaining({ sku: 'ONE', totalLoss: 45, count: 15 }),
    ]);
  });

  it('rejects a NULL cost_price — the real schema forbids it (issue #268)', async () => {
    // The old harness allowed NULL here, which was drift: the authoritative
    // baseline declares `cost_price DOUBLE PRECISION NOT NULL`
    // (database/migrations/0000_baseline.up.sql:125), so the NULL row the #268
    // repro relied on cannot exist in production. What remains worth pinning is
    // that the schema itself enforces this, keeping the production COALESCE
    // guard in the worklist query defensive rather than load-bearing.
    await expect(
      sql`
        INSERT INTO products (organization_id, barcode, sku, name, cost_price, updated_at)
        VALUES (${ORG}, ${'NULLC'}, ${'NULLC'}, ${'No Cost Item'}, NULL, NOW())`,
    ).rejects.toMatchObject({ code: '23502' });
  });

  it('writes off a future-dated Markdown item shown in the worklist (issue #268)', async () => {
    // Regression: the worklist (getExpiredItems) surfaces Markdown items before
    // their expiry date, so the write-off matcher must accept the same statuses.
    // Previously the matcher only matched 'Expired', so processing a future-dated
    // Markdown item threw "Cannot discard 1 units; only 0 expired units are available".
    const db = createWorkersDatabase({ NEON_CONNECTION_STRING: 'postgres://test' } as Env);
    const productRows = await sql`
      INSERT INTO products (organization_id, barcode, sku, name, cost_price, updated_at)
      VALUES (${ORG}, ${'MKDN'}, ${'MKDN'}, ${'Markdown Item'}, 5, NOW())
      RETURNING id`;
    const productId = Number(productRows[0].id);
    const areaRows = await sql`
      INSERT INTO store_areas (organization_id, name, sub_department, updated_at)
      VALUES (${ORG}, ${'Shelf'}, ${'Grocery'}, NOW())
      RETURNING id`;
    const locationId = Number(areaRows[0].id);
    // 20 days to expiry => Markdown 3 window, not yet expired.
    const itemRows = await sql`
      INSERT INTO inventory_items (organization_id, product_id, location_id, expiry_date, status, updated_at)
      VALUES (${ORG}, ${productId}, ${locationId}, (CURRENT_DATE + INTERVAL '20 days')::date, ${'Markdown 3'}, NOW())
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
      INSERT INTO products (organization_id, barcode, sku, name, cost_price, updated_at)
      VALUES (${ORG}, ${'MIX'}, ${'MIX'}, ${'Mixed Item'}, 4, NOW())
      RETURNING id`;
    const productId = Number(productRows[0].id);
    const areaRows = await sql`
      INSERT INTO store_areas (organization_id, name, sub_department, updated_at)
      VALUES (${ORG}, ${'Bay'}, ${'Grocery'}, NOW())
      RETURNING id`;
    const locationId = Number(areaRows[0].id);
    // One already expired, one future-dated Markdown 3 — same product/location/cost.
    await sql`
      INSERT INTO inventory_items (organization_id, product_id, location_id, expiry_date, status, updated_at)
      VALUES (${ORG}, ${productId}, ${locationId}, (CURRENT_DATE - INTERVAL '2 days')::date, ${'Expired'}, NOW())`;
    await sql`
      INSERT INTO inventory_items (organization_id, product_id, location_id, expiry_date, status, updated_at)
      VALUES (${ORG}, ${productId}, ${locationId}, (CURRENT_DATE + INTERVAL '20 days')::date, ${'Markdown 3'}, NOW())`;

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

  it('reports realized expired losses from the transaction ledger (expired-losses report)', async () => {
    const db = createWorkersDatabase({ NEON_CONNECTION_STRING: 'postgres://test' } as Env);
    const productRows = await sql`
      INSERT INTO products (organization_id, barcode, sku, name, cost_price, updated_at)
      VALUES (${ORG}, ${'LOSS'}, ${'LOSS'}, ${'Loss Item'}, 9, NOW())
      RETURNING id`;
    const productId = Number(productRows[0].id);
    const areaRows = await sql`
      INSERT INTO store_areas (organization_id, name, sub_department, updated_at)
      VALUES (${ORG}, ${'Aisle'}, ${'General'}, NOW())
      RETURNING id`;
    const locationId = Number(areaRows[0].id);
    // Item is already dispositioned (Sold Through status) — proving the ledger
    // reports realized write-offs, independent of current inventory status.
    const itemRows = await sql`
      INSERT INTO inventory_items (organization_id, product_id, location_id, expiry_date, status, updated_at)
      VALUES (${ORG}, ${productId}, ${locationId}, (CURRENT_DATE - INTERVAL '2 days')::date, ${'Sold Through'}, NOW())
      RETURNING id`;
    await sql`
      INSERT INTO expired_item_transactions
        (organization_id, inventory_item_id, user_id, action, units_discarded, financial_loss, updated_at)
      VALUES (${ORG}, ${Number(itemRows[0].id)}, ${USER_ID}, ${'expired'}, 1, 9, NOW())`;

    expect(await db.getExpiredLossBySku(ORG)).toEqual([
      expect.objectContaining({ sku: 'LOSS', productName: 'Loss Item', totalLoss: 9, count: 1 }),
    ]);
    expect(await db.getExpiredLossByStoreArea(ORG)).toEqual([
      expect.objectContaining({ locationName: 'Aisle', totalLoss: 9, count: 1 }),
    ]);
  });

  it('values currently-expired stock (by expiry date, not status) for the loss-by-sku/department reports', async () => {
    // The standalone /reports/loss-by-* endpoints value stock CURRENTLY sitting
    // expired (cost_price), not the write-off ledger. "Expired" is defined by
    // expiry_date, because the Workers scan path stores items as 'Normal' and
    // never recomputes status — filtering on a literal 'Expired' status returned
    // nothing on Neon and left the graphs empty. See #268.
    const db = createWorkersDatabase({ NEON_CONNECTION_STRING: 'postgres://test' } as Env);
    const productRows = await sql`
      INSERT INTO products (organization_id, barcode, sku, name, cost_price, updated_at)
      VALUES (${ORG}, ${'CUR'}, ${'CUR'}, ${'Current Item'}, 6, NOW())
      RETURNING id`;
    const productId = Number(productRows[0].id);
    const areaRows = await sql`
      INSERT INTO store_areas (organization_id, name, sub_department, updated_at)
      VALUES (${ORG}, ${'Aisle'}, ${'Bakery'}, NOW())
      RETURNING id`;
    const locationId = Number(areaRows[0].id);
    // Counted: two past-expiry 'Expired' + one past-expiry 'Normal' (the scan-path
    // case that was previously invisible). Ignored: an already-processed unit and a
    // future-dated 'Normal' unit that has not expired yet.
    await sql`
      INSERT INTO inventory_items (organization_id, product_id, location_id, expiry_date, status, updated_at)
      VALUES (${ORG}, ${productId}, ${locationId}, (CURRENT_DATE - INTERVAL '1 day')::date, ${'Expired'}, NOW()),
             (${ORG}, ${productId}, ${locationId}, (CURRENT_DATE - INTERVAL '1 day')::date, ${'Expired'}, NOW()),
             (${ORG}, ${productId}, ${locationId}, (CURRENT_DATE - INTERVAL '1 day')::date, ${'Normal'}, NOW()),
             (${ORG}, ${productId}, ${locationId}, (CURRENT_DATE - INTERVAL '1 day')::date, ${'Processed'}, NOW()),
             (${ORG}, ${productId}, ${locationId}, (CURRENT_DATE + INTERVAL '5 days')::date, ${'Normal'}, NOW())`;

    expect(await db.getLossBySkuReport(ORG)).toEqual([
      expect.objectContaining({ sku: 'CUR', productName: 'Current Item', totalLoss: 18, count: 3 }),
    ]);
    expect(await db.getLossByDepartmentReport(ORG)).toEqual([
      expect.objectContaining({ department: 'Bakery', totalLoss: 18, count: 3 }),
    ]);
  });

  it('caps the loss-by-sku/department reports at the top 5 sources of loss', async () => {
    // Surface only the five biggest loss sources so the graphs stay a focused
    // "worst offenders" view rather than an unbounded list. See #268.
    const db = createWorkersDatabase({ NEON_CONNECTION_STRING: 'postgres://test' } as Env);

    // Six SKUs/departments with ascending cost so ranking is unambiguous; the
    // cheapest (cost 1) must be dropped once we cap at five.
    for (let i = 1; i <= 6; i++) {
      const productRows = await sql`
        INSERT INTO products (organization_id, barcode, sku, name, cost_price, updated_at)
        VALUES (${ORG}, ${`B${i}`}, ${`SKU_${i}`}, ${`Product ${i}`}, ${i}, NOW())
        RETURNING id`;
      const productId = Number(productRows[0].id);
      const areaRows = await sql`
        INSERT INTO store_areas (organization_id, name, sub_department, updated_at)
        VALUES (${ORG}, ${`Aisle ${i}`}, ${`Dept_${i}`}, NOW())
        RETURNING id`;
      const locationId = Number(areaRows[0].id);
      await sql`
        INSERT INTO inventory_items (organization_id, product_id, location_id, expiry_date, status, updated_at)
        VALUES (${ORG}, ${productId}, ${locationId}, (CURRENT_DATE - INTERVAL '1 day')::date, ${'Normal'}, NOW())`;
    }

    const skuReport = await db.getLossBySkuReport(ORG);
    expect(skuReport).toHaveLength(5);
    expect(skuReport.map((row) => row.sku)).toEqual(['SKU_6', 'SKU_5', 'SKU_4', 'SKU_3', 'SKU_2']);

    const deptReport = await db.getLossByDepartmentReport(ORG);
    expect(deptReport).toHaveLength(5);
    expect(deptReport.map((row) => row.department)).toEqual([
      'Dept_6',
      'Dept_5',
      'Dept_4',
      'Dept_3',
      'Dept_2',
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
