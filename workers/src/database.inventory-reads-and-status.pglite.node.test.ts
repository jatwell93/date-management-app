/**
 * Real-SQL coverage for inventory item reads by product, and for the status an item is
 * given when it is created or its expiry date is edited (task 3.2, batch 5).
 *
 * Express derived the status from the expiry date on create and on an expiry edit
 * (`inventory.service.ts:164`, `:224`). The Worker defaulted to `Normal` and kept the old
 * status on an edit, and the live frontend never sends a status, so an item scanned on the day
 * it expired stayed `Normal` until the nightly job ran. These tests pin the derived status and
 * the cases where it must not apply: an explicit status, and a disposed item.
 *
 * The two product reads feed the barcode lookup and the recent-items list on the scan page.
 * Both are organization-scoped in SQL; the tests seed another organization's rows on the same
 * product shape so a lost predicate returns them.
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
import { UNLIMITED_CAP } from './utils/usage-limits';

const ORG = 'org-a';
const OTHER_ORG = 'org-b';
const USER_ID = 1;

/** A calendar date `days` from today, as YYYY-MM-DD in UTC. */
function dateInDays(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

describe('inventory reads and derived status (real SQL)', () => {
  let harness: PgliteHarness;
  let sql: NeonQueryFunction<false, false>;
  let productId: number;
  let otherOrgProductId: number;
  let aisle1: number;
  let aisle2: number;
  let otherOrgAisle: number;

  const makeDb = () => createWorkersDatabase({ NEON_CONNECTION_STRING: 'postgres://test' } as Env);

  const seedItem = async (
    org: string,
    product: number,
    location: number,
    expiry: string,
    createdAt: string,
    status = 'Normal',
  ) => {
    const rows = await sql`
      INSERT INTO inventory_items
        (organization_id, product_id, location_id, expiry_date, status, created_at, updated_at)
      VALUES (${org}, ${product}, ${location}, ${expiry}, ${status}, ${createdAt}, NOW())
      RETURNING id`;
    return Number(rows[0].id);
  };

  const statusOf = async (id: number) =>
    String((await sql`SELECT status FROM inventory_items WHERE id = ${id}`)[0].status);

  beforeAll(async () => {
    harness = await createPgliteHarness();
    sql = createTaggedSql(harness.pg);
    sqlHolder.current = sql;
    await sql`INSERT INTO organizations (id, name, slug, updated_at)
              VALUES (${ORG}, 'Org A', 'org-a', NOW()),
                     (${OTHER_ORG}, 'Org B', 'org-b', NOW())
              ON CONFLICT (id) DO NOTHING`;
  }, 30000);

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await sql`DELETE FROM audit_log`;
    await sql`DELETE FROM inventory_items`;
    await sql`DELETE FROM products`;
    await sql`DELETE FROM store_areas`;
    await sql`DELETE FROM users`;
    await sql`INSERT INTO users (id, organization_id, username, role, updated_at)
              VALUES (${USER_ID}, ${ORG}, ${'actor'}, ${'admin'}, NOW())`;
    const product = await sql`
      INSERT INTO products (organization_id, barcode, sku, name, cost_price, updated_at)
      VALUES (${ORG}, ${'BAR-1'}, ${'SKU-1'}, ${'Milk'}, 5, NOW()) RETURNING id`;
    productId = Number(product[0].id);
    const foreignProduct = await sql`
      INSERT INTO products (organization_id, barcode, sku, name, cost_price, updated_at)
      VALUES (${OTHER_ORG}, ${'BAR-1'}, ${'SKU-1'}, ${'Foreign milk'}, 5, NOW()) RETURNING id`;
    otherOrgProductId = Number(foreignProduct[0].id);
    const areaOne = await sql`
      INSERT INTO store_areas (organization_id, name, updated_at)
      VALUES (${ORG}, ${'Aisle 1'}, NOW()) RETURNING id`;
    const areaTwo = await sql`
      INSERT INTO store_areas (organization_id, name, updated_at)
      VALUES (${ORG}, ${'Aisle 2'}, NOW()) RETURNING id`;
    const foreignArea = await sql`
      INSERT INTO store_areas (organization_id, name, updated_at)
      VALUES (${OTHER_ORG}, ${'Aisle 1'}, NOW()) RETURNING id`;
    aisle1 = Number(areaOne[0].id);
    aisle2 = Number(areaTwo[0].id);
    otherOrgAisle = Number(foreignArea[0].id);
  });

  describe('findInventoryItemsByProductId', () => {
    it("returns the organization's items for the product, soonest expiry first, with the area", async () => {
      const later = await seedItem(ORG, productId, aisle2, '2099-09-01', '2026-01-02T00:00:00Z');
      const sooner = await seedItem(ORG, productId, aisle1, '2099-03-01', '2026-01-01T00:00:00Z');
      await seedItem(
        OTHER_ORG,
        otherOrgProductId,
        otherOrgAisle,
        '2099-01-01',
        '2026-01-01T00:00:00Z',
      );

      const items = await makeDb().findInventoryItemsByProductId(ORG, productId);

      expect(items.map((item) => item.id)).toEqual([sooner, later]);
      expect(items[0].storeArea).toMatchObject({ id: aisle1, name: 'Aisle 1' });
    });

    it("returns nothing when asked for another organization's product", async () => {
      await seedItem(
        OTHER_ORG,
        otherOrgProductId,
        otherOrgAisle,
        '2099-01-01',
        '2026-01-01T00:00:00Z',
      );

      const items = await makeDb().findInventoryItemsByProductId(ORG, otherOrgProductId);

      expect(items).toEqual([]);
    });
  });

  describe('findRecentInventoryItemsByProductId', () => {
    it('returns the newest items first, up to the limit, with the area name', async () => {
      const oldest = await seedItem(ORG, productId, aisle1, '2099-01-01', '2026-01-01T00:00:00Z');
      const middle = await seedItem(ORG, productId, aisle2, '2099-01-02', '2026-01-02T00:00:00Z');
      const newest = await seedItem(ORG, productId, aisle1, '2099-01-03', '2026-01-03T00:00:00Z');

      const two = await makeDb().findRecentInventoryItemsByProductId(ORG, productId, 2);
      const all = await makeDb().findRecentInventoryItemsByProductId(ORG, productId, 10);

      expect(two.map((item) => item.id)).toEqual([newest, middle]);
      expect(all.map((item) => item.id)).toEqual([newest, middle, oldest]);
      expect(two[1].locationName).toBe('Aisle 2');
    });

    it("never returns another organization's items", async () => {
      const own = await seedItem(ORG, productId, aisle1, '2099-01-01', '2026-01-01T00:00:00Z');
      await seedItem(
        OTHER_ORG,
        otherOrgProductId,
        otherOrgAisle,
        '2099-01-01',
        '2026-02-01T00:00:00Z',
      );

      const items = await makeDb().findRecentInventoryItemsByProductId(ORG, productId, 10);
      const foreign = await makeDb().findRecentInventoryItemsByProductId(
        ORG,
        otherOrgProductId,
        10,
      );

      expect(items.map((item) => item.id)).toEqual([own]);
      expect(foreign).toEqual([]);
    });
  });

  describe('createInventoryItem status', () => {
    const create = (expiryDate: string, status?: string) =>
      makeDb().createInventoryItem(
        ORG,
        USER_ID,
        { productId, expiryDate, locationId: aisle1, status },
        UNLIMITED_CAP,
      );

    it.each([
      ['yesterday', -1, 'Expired'],
      ['today', 0, 'Expired'],
      ['in 5 days', 5, 'Markdown 3'],
      ['in 30 days', 30, 'Markdown 3'],
      ['in 31 days', 31, 'Markdown 2'],
      ['in 60 days', 60, 'Markdown 2'],
      ['in 61 days', 61, 'Markdown 1'],
      ['in 90 days', 90, 'Markdown 1'],
      ['in 120 days', 120, 'Normal'],
    ])('derives the status for an item that expires %s', async (_label, days, expected) => {
      const item = await create(dateInDays(days));

      expect(item?.status).toBe(expected);
    });

    it('keeps a status the caller names, whatever the date says', async () => {
      const item = await create(dateInDays(60), 'Markdown 1');

      expect(item?.status).toBe('Markdown 1');
    });

    it('writes one audit row for the created item', async () => {
      const item = await create(dateInDays(5));

      const audit = await sql`
        SELECT action FROM audit_log WHERE inventory_item_id = ${item!.id}`;
      expect(audit.map((row) => row.action)).toEqual(['create']);
    });
  });

  describe('updateInventoryItem status', () => {
    const update = (
      id: number,
      data: { expiryDate?: string; status?: string; locationId?: number },
    ) => makeDb().updateInventoryItem(ORG, USER_ID, id, data);

    it('re-derives the status when the expiry date is edited', async () => {
      const id = await seedItem(ORG, productId, aisle1, dateInDays(120), '2026-01-01T00:00:00Z');

      const updated = await update(id, { expiryDate: dateInDays(5) });

      expect(updated?.status).toBe('Markdown 3');
      expect(await statusOf(id)).toBe('Markdown 3');
    });

    it('brings an expired item back to a live status when its date is corrected forward', async () => {
      const id = await seedItem(
        ORG,
        productId,
        aisle1,
        dateInDays(-3),
        '2026-01-01T00:00:00Z',
        'Expired',
      );

      const updated = await update(id, { expiryDate: dateInDays(120) });

      expect(updated?.status).toBe('Normal');
    });

    it('keeps a status the caller names, whatever the new date says', async () => {
      const id = await seedItem(ORG, productId, aisle1, dateInDays(120), '2026-01-01T00:00:00Z');

      const updated = await update(id, { expiryDate: dateInDays(5), status: 'Markdown 1' });

      expect(updated?.status).toBe('Markdown 1');
    });

    it('does not resurrect a disposed item when its date is edited', async () => {
      const id = await seedItem(
        ORG,
        productId,
        aisle1,
        dateInDays(-3),
        '2026-01-01T00:00:00Z',
        'Processed',
      );

      const updated = await update(id, { expiryDate: dateInDays(120) });

      expect(updated?.status).toBe('Processed');
    });

    it('leaves the status alone when the edit does not touch the date', async () => {
      const id = await seedItem(
        ORG,
        productId,
        aisle1,
        dateInDays(5),
        '2026-01-01T00:00:00Z',
        'Markdown 1',
      );

      const updated = await update(id, { locationId: aisle2 });

      expect(updated?.status).toBe('Markdown 1');
      expect(updated?.locationId).toBe(aisle2);
    });
  });
});
