/**
 * Real-data (pglite) coverage for the markdown worklist (detailed expiry report).
 *
 * Regression for PR #258 review: an item marked sold-through from the worklist must
 * NOT reappear in `getDetailedExpiryReport` after a refresh. `processExpiredItem`
 * sets the item status to 'Sold Through' (workers) / 'Processed' (SQLite backend),
 * and the report must exclude those terminal statuses while still surfacing genuinely
 * urgent day-0 'Expired'-status stock.
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

describe('Workers markdown worklist (real SQL)', () => {
  let harness: PgliteHarness;
  let sql: NeonQueryFunction<false, false>;
  let locationId: number;

  beforeAll(async () => {
    harness = await createPgliteHarness();
    sql = createTaggedSql(harness.pg);
    sqlHolder.current = sql;
  }, 30000); // pglite WASM cold-start can exceed the default 10s hook timeout

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await sql`DELETE FROM expired_item_transactions`;
    await sql`DELETE FROM inventory_items`;
    await sql`DELETE FROM products`;
    await sql`DELETE FROM store_areas`;
    const areaRows = await sql`
      INSERT INTO store_areas (organization_id, name) VALUES (${ORG}, ${'Aisle 1'}) RETURNING id`;
    locationId = Number(areaRows[0].id);
  });

  // Seeds a product + inventory item N days from expiry with the given status.
  const seedItem = async (offsetDays: number, sku: string, status = 'Active'): Promise<number> => {
    const productRows = await sql`
      INSERT INTO products (organization_id, barcode, sku, name, cost_price)
      VALUES (${ORG}, ${sku}, ${sku}, ${'Item ' + sku}, 10)
      RETURNING id`;
    const productId = Number(productRows[0].id);
    const itemRows = await sql`
      INSERT INTO inventory_items (organization_id, product_id, location_id, expiry_date, status)
      VALUES (${ORG}, ${productId}, ${locationId}, (CURRENT_DATE + ${offsetDays} * INTERVAL '1 day')::date, ${status})
      RETURNING id`;
    return Number(itemRows[0].id);
  };

  it('drops an item from the worklist after it is sold through', async () => {
    const db = createWorkersDatabase({ NEON_CONNECTION_STRING: 'postgres://test' } as Env);
    const itemId = await seedItem(20, 'SKU-SOLD');

    const before = await db.getDetailedExpiryReport(ORG);
    expect(before.map((r) => r.inventoryId)).toContain(itemId);

    await db.processExpiredItem(itemId, USER_ID, ORG, 'sold_through');

    const after = await db.getDetailedExpiryReport(ORG);
    expect(after.map((r) => r.inventoryId)).not.toContain(itemId);
  });

  it('still surfaces a day-0 item carrying Expired status (most urgent, not a write-off)', async () => {
    const db = createWorkersDatabase({ NEON_CONNECTION_STRING: 'postgres://test' } as Env);
    const urgentId = await seedItem(0, 'SKU-TODAY', 'Expired');

    const report = await db.getDetailedExpiryReport(ORG);

    expect(report.map((r) => r.inventoryId)).toContain(urgentId);
  });
});
