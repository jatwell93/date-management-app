/**
 * Real-SQL (pglite) coverage for cross-tenant isolation on the **write and
 * delete** paths.
 *
 * `database.tenant-isolation.pglite.node.test.ts` (PR #462) covers the read
 * paths, which were genuinely broken. This file covers the mutations, which the
 * task 2.2 audit recorded as the highest-consequence *uncovered* surface:
 *
 *   > a DELETE or UPDATE keyed on id alone would pass the entire current
 *   > Worker suite
 *
 * Auditing that claim found the mutations themselves are sound — every
 * `UPDATE`/`DELETE` in `database.ts` carries `organization_id` in both its
 * ownership pre-check and the mutating statement, and every call site in
 * `index-minimal.ts` passes `auth.organizationId`. The tests below pin that,
 * because "correct today" and "cannot regress" are different properties and only
 * the second one survives Phase 4.
 *
 * It also found one real defect, covered here and fixed alongside:
 * `updateInventoryItem` validated that a supplied `locationId` belonged to the
 * caller's organization but did **not** validate `productId`, while
 * `createInventoryItem` validated both. That asymmetry let an authenticated user
 * repoint their own inventory item at another tenant's product id, and several
 * report queries then join `products` without correlating on organization — so a
 * write became a read leak. See the "cross-org reference" block below.
 *
 * Every assertion is written to fail if the predicate it guards is removed. The
 * standard is the same as the read file: seed a foreign row that WOULD be
 * affected if scoping regressed, act as the wrong organization, then assert both
 * halves — the attacker's call had no effect, AND the victim's row is untouched.
 * Asserting only the return value would pass against a method that reports
 * failure while still writing.
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
import { isReferentialError } from './tenant-references';

const ORG = 'org-a';
const OTHER_ORG = 'org-b';

function makeDb() {
  return createWorkersDatabase({ NEON_CONNECTION_STRING: 'postgres://test' } as Env);
}

describe('Workers cross-tenant write and delete isolation (real SQL)', () => {
  let harness: PgliteHarness;
  let sql: NeonQueryFunction<false, false>;

  // Captured per test: SERIAL keeps counting across truncations, so literal ids
  // would drift as tests are added or reordered.
  let ownProductId: number;
  let foreignProductId: number;
  let ownAreaId: number;
  let foreignAreaId: number;
  let ownItemId: number;
  let foreignItemId: number;
  let ownUserId: number;
  let foreignUserId: number;

  beforeAll(async () => {
    harness = await createPgliteHarness();
    sql = createTaggedSql(harness.pg);
    sqlHolder.current = sql;

    // check_cycles/bay_checks carry a real FK to organizations; the rest of the
    // tables here do not, but seeding both orgs keeps the fixture honest.
    await sql`
      INSERT INTO organizations (id, name, slug)
      VALUES (${ORG}, 'Org A', 'org-a'), (${OTHER_ORG}, 'Org B', 'org-b')
      ON CONFLICT (id) DO NOTHING`;
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await sql`DELETE FROM audit_log`;
    await sql`DELETE FROM inventory_items`;
    await sql`DELETE FROM products`;
    await sql`DELETE FROM store_areas`;
    await sql`DELETE FROM users`;

    const ownProduct = await sql`
      INSERT INTO products (organization_id, barcode, sku, name, cost_price)
      VALUES (${ORG}, 'BAR-OWN', 'SKU-OWN', 'Own Product', 10)
      RETURNING id`;
    ownProductId = Number(ownProduct[0].id);

    // Distinctive values: every assertion below checks that none of these ever
    // reaches org-a, so a leak is identifiable rather than merely a count.
    const foreignProduct = await sql`
      INSERT INTO products (organization_id, barcode, sku, name, cost_price)
      VALUES (${OTHER_ORG}, 'BAR-SECRET', 'SKU-SECRET', 'Secret Competitor Product', 999)
      RETURNING id`;
    foreignProductId = Number(foreignProduct[0].id);

    const ownArea = await sql`
      INSERT INTO store_areas (organization_id, name)
      VALUES (${ORG}, 'Own Aisle') RETURNING id`;
    ownAreaId = Number(ownArea[0].id);

    const foreignArea = await sql`
      INSERT INTO store_areas (organization_id, name)
      VALUES (${OTHER_ORG}, 'Secret Aisle') RETURNING id`;
    foreignAreaId = Number(foreignArea[0].id);

    const ownItem = await sql`
      INSERT INTO inventory_items (organization_id, product_id, location_id, expiry_date, status)
      VALUES (${ORG}, ${ownProductId}, ${ownAreaId}, '2099-01-01', 'Normal')
      RETURNING id`;
    ownItemId = Number(ownItem[0].id);

    const foreignItem = await sql`
      INSERT INTO inventory_items (organization_id, product_id, location_id, expiry_date, status)
      VALUES (${OTHER_ORG}, ${foreignProductId}, ${foreignAreaId}, '2099-06-15', 'Normal')
      RETURNING id`;
    foreignItemId = Number(foreignItem[0].id);

    const ownUser = await sql`
      INSERT INTO users (organization_id, email, username, role)
      VALUES (${ORG}, 'a@example.com', 'user-a', 'member') RETURNING id`;
    ownUserId = Number(ownUser[0].id);

    const foreignUser = await sql`
      INSERT INTO users (organization_id, email, username, role)
      VALUES (${OTHER_ORG}, 'b@example.com', 'user-b', 'member') RETURNING id`;
    foreignUserId = Number(foreignUser[0].id);
  });

  describe('updateInventoryItem', () => {
    it("returns null and leaves the row untouched for another organization's item", async () => {
      const db = makeDb();

      const result = await db.updateInventoryItem(ORG, ownUserId, foreignItemId, {
        status: 'Expired',
        expiryDate: '2000-01-01',
      });

      expect(result).toBeNull();

      // The return value alone is not enough: a method could report null and
      // still have written. Read the row back independently.
      const rows = await sql`
        SELECT status, expiry_date::text AS expiry FROM inventory_items WHERE id = ${foreignItemId}`;
      expect(rows[0].status).toBe('Normal');
      expect(rows[0].expiry).toBe('2099-06-15');
    });

    it('does not write an audit row for a rejected cross-tenant update', async () => {
      const db = makeDb();
      await db.updateInventoryItem(ORG, ownUserId, foreignItemId, { status: 'Expired' });

      // A phantom audit row would misattribute an action that never happened,
      // and would leak org-b's item id into org-a's audit trail.
      const audit = await sql`SELECT id FROM audit_log`;
      expect(audit).toHaveLength(0);
    });

    it("rejects repointing an item at another organization's product", async () => {
      const db = makeDb();

      // The item is the caller's own, so ownership passes; only the *referenced*
      // product is foreign. This is the defect described in the file header.
      await expect(
        db.updateInventoryItem(ORG, ownUserId, ownItemId, { productId: foreignProductId }),
      ).rejects.toThrow('Product does not exist');

      const rows = await sql`SELECT product_id FROM inventory_items WHERE id = ${ownItemId}`;
      expect(Number(rows[0].product_id)).toBe(ownProductId);
    });

    it("rejects repointing an item at another organization's store area", async () => {
      const db = makeDb();

      await expect(
        db.updateInventoryItem(ORG, ownUserId, ownItemId, { locationId: foreignAreaId }),
      ).rejects.toThrow('Location does not exist');

      const rows = await sql`SELECT location_id FROM inventory_items WHERE id = ${ownItemId}`;
      expect(Number(rows[0].location_id)).toBe(ownAreaId);
    });

    it('still performs a legitimate same-organization update', async () => {
      const db = makeDb();

      // Guards against "fixing" isolation by rejecting everything: the three
      // tests above would all pass against a method that never updates at all.
      const second = await sql`
        INSERT INTO products (organization_id, barcode, sku, name, cost_price)
        VALUES (${ORG}, 'BAR-OWN-2', 'SKU-OWN-2', 'Own Product 2', 20) RETURNING id`;
      const secondId = Number(second[0].id);

      const result = await db.updateInventoryItem(ORG, ownUserId, ownItemId, {
        productId: secondId,
        status: 'Expired',
      });

      expect(result).not.toBeNull();
      expect(result?.status).toBe('Expired');

      const rows =
        await sql`SELECT product_id, status FROM inventory_items WHERE id = ${ownItemId}`;
      expect(Number(rows[0].product_id)).toBe(secondId);
      expect(rows[0].status).toBe('Expired');
    });
  });

  describe('deleteInventoryItem', () => {
    it("returns false and leaves another organization's item in place", async () => {
      const db = makeDb();

      const deleted = await db.deleteInventoryItem(ORG, ownUserId, foreignItemId);
      expect(deleted).toBe(false);

      const rows = await sql`SELECT id FROM inventory_items WHERE id = ${foreignItemId}`;
      expect(rows).toHaveLength(1);
    });

    it('does not write an audit row for a rejected cross-tenant delete', async () => {
      const db = makeDb();
      await db.deleteInventoryItem(ORG, ownUserId, foreignItemId);

      const audit = await sql`SELECT id FROM audit_log`;
      expect(audit).toHaveLength(0);
    });

    it("still deletes the caller's own item, and audits it", async () => {
      const db = makeDb();

      const deleted = await db.deleteInventoryItem(ORG, ownUserId, ownItemId);
      expect(deleted).toBe(true);

      const rows = await sql`SELECT id FROM inventory_items WHERE id = ${ownItemId}`;
      expect(rows).toHaveLength(0);

      const audit = await sql`
        SELECT organization_id, action FROM audit_log WHERE inventory_item_id = ${ownItemId}`;
      expect(audit).toHaveLength(1);
      expect(audit[0].organization_id).toBe(ORG);
      expect(audit[0].action).toBe('delete');
    });
  });

  describe('store area write and delete', () => {
    it("returns null and leaves another organization's area untouched on update", async () => {
      const db = makeDb();

      const result = await db.updateStoreArea(ORG, foreignAreaId, { name: 'Renamed By Attacker' });
      expect(result).toBeNull();

      const rows = await sql`SELECT name FROM store_areas WHERE id = ${foreignAreaId}`;
      expect(rows[0].name).toBe('Secret Aisle');
    });

    it("returns false and leaves another organization's area in place on delete", async () => {
      const db = makeDb();

      const deleted = await db.deleteStoreArea(ORG, foreignAreaId);
      expect(deleted).toBe(false);

      const rows = await sql`SELECT id FROM store_areas WHERE id = ${foreignAreaId}`;
      expect(rows).toHaveLength(1);
    });

    it("does not consult another organization's inventory for the in-use check", async () => {
      const db = makeDb();

      // org-b's area IS in use by org-b's item. Asking as org-a must not raise
      // "in use" — that would disclose that another tenant references it.
      // Combined with the test above, the only correct outcome is a plain false.
      await expect(db.deleteStoreArea(ORG, foreignAreaId)).resolves.toBe(false);
    });

    it("still deletes the caller's own unused area", async () => {
      const db = makeDb();

      const spare = await sql`
        INSERT INTO store_areas (organization_id, name)
        VALUES (${ORG}, 'Spare Aisle') RETURNING id`;

      await expect(db.deleteStoreArea(ORG, Number(spare[0].id))).resolves.toBe(true);
    });
  });

  describe('user role update and soft delete', () => {
    it("refuses to change another organization's user role", async () => {
      const db = makeDb();

      // Privilege escalation across tenants: granting yourself admin in someone
      // else's organization.
      const result = await db.updateUserRole(ORG, foreignUserId, 'admin');
      expect(result).toBeNull();

      const rows = await sql`SELECT role FROM users WHERE id = ${foreignUserId}`;
      expect(rows[0].role).toBe('member');
    });

    it("refuses to soft-delete another organization's user", async () => {
      const db = makeDb();

      const deleted = await db.softDeleteUser(ORG, foreignUserId);
      expect(deleted).toBe(false);

      const rows = await sql`SELECT deleted_at FROM users WHERE id = ${foreignUserId}`;
      expect(rows[0].deleted_at).toBeNull();
    });

    it("still updates and soft-deletes the caller's own user", async () => {
      const db = makeDb();

      expect(await db.updateUserRole(ORG, ownUserId, 'admin')).not.toBeNull();
      expect(await db.softDeleteUser(ORG, ownUserId)).toBe(true);

      const rows = await sql`SELECT role, deleted_at FROM users WHERE id = ${ownUserId}`;
      expect(rows[0].role).toBe('admin');
      expect(rows[0].deleted_at).not.toBeNull();
    });
  });

  // These cases assert the cross-org reference checks fire BEFORE the insert, so
// the tier cap must never be the reason a create fails here. A cap far above
// any fixture count keeps the assertions about references, not quota.
const UNCAPPED = 1_000_000;

describe('createInventoryItem cross-org references', () => {
    it("refuses to create an item pointing at another organization's product", async () => {
      const db = makeDb();

      await expect(
        db.createInventoryItem(ORG, ownUserId, {
          productId: foreignProductId,
          expiryDate: '2099-01-01',
          locationId: ownAreaId,
        }, UNCAPPED),
      ).rejects.toThrow('Product does not exist');

      const rows = await sql`
        SELECT id FROM inventory_items
        WHERE organization_id = ${ORG} AND product_id = ${foreignProductId}`;
      expect(rows).toHaveLength(0);
    });

    it("refuses to create an item pointing at another organization's store area", async () => {
      const db = makeDb();

      await expect(
        db.createInventoryItem(ORG, ownUserId, {
          productId: ownProductId,
          expiryDate: '2099-01-01',
          locationId: foreignAreaId,
        }, UNCAPPED),
      ).rejects.toThrow('Location does not exist');
    });
  });

  describe('cross-org rejections are classified as client errors', () => {
    /**
     * The route layer turns these throws into a 400 via `isReferentialError`;
     * anything it does not recognise becomes a 500. Before that helper existed,
     * the two catch sites matched string literals independently, and
     * `handleUpdateInventoryItem` listed only `Location` — so the productId
     * rejection added alongside these tests would have surfaced as a 500.
     *
     * This catches the REAL thrown error rather than asserting over
     * `REFERENTIAL_ERRORS` directly. Checking the constant against itself would
     * pass no matter what the database layer throws; catching the throw means a
     * new reference check written with a fresh string literal fails here
     * instead of silently becoming a 500 in production.
     */
    const cases: Array<[string, () => Promise<unknown>]> = [
      [
        'createInventoryItem, foreign product',
        () =>
          makeDb().createInventoryItem(ORG, ownUserId, {
            productId: foreignProductId,
            expiryDate: '2099-01-01',
            locationId: ownAreaId,
          }, UNCAPPED),
      ],
      [
        'createInventoryItem, foreign location',
        () =>
          makeDb().createInventoryItem(ORG, ownUserId, {
            productId: ownProductId,
            expiryDate: '2099-01-01',
            locationId: foreignAreaId,
          }, UNCAPPED),
      ],
      [
        'updateInventoryItem, foreign product',
        () =>
          makeDb().updateInventoryItem(ORG, ownUserId, ownItemId, { productId: foreignProductId }),
      ],
      [
        'updateInventoryItem, foreign location',
        () =>
          makeDb().updateInventoryItem(ORG, ownUserId, ownItemId, { locationId: foreignAreaId }),
      ],
    ];

    it.each(cases)('%s throws an error the route maps to 400', async (_name, act) => {
      const error = await act().then(
        () => null,
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(Error);
      expect(isReferentialError((error as Error).message)).toBe(true);
    });
  });

  describe('report joins do not resolve cross-org references', () => {
    /**
     * Defence in depth for the leak described in the file header.
     *
     * The `updateInventoryItem` fix closes the route that could *create* a
     * cross-org reference, but these joins outlive that one check — and a row
     * written before the fix, or by a future code path, would still be resolved
     * by them. `inventory_items.product_id` carries no FK constraint, so the bad
     * state inserts cleanly and can be tested directly.
     */
    it('does not leak a foreign product through the loss-by-SKU report', async () => {
      await sql`
        INSERT INTO inventory_items (organization_id, product_id, location_id, expiry_date, status)
        VALUES (${ORG}, ${foreignProductId}, ${ownAreaId}, '2000-01-01', 'Normal')`;

      const report = await makeDb().getLossBySkuReport(ORG);

      // The foreign product's sku, name and 999 cost must not appear.
      expect(report.map((r) => r.sku)).not.toContain('SKU-SECRET');
      expect(report.map((r) => r.productName)).not.toContain('Secret Competitor Product');
      expect(report.every((r) => Number(r.totalLoss) < 999)).toBe(true);
    });

    it('does not leak a foreign product through the expired-items worklist', async () => {
      await sql`
        INSERT INTO inventory_items (organization_id, product_id, location_id, expiry_date, status)
        VALUES (${ORG}, ${foreignProductId}, ${ownAreaId}, '2000-01-01', 'Normal')`;

      const worklist = await makeDb().getExpiredItems(ORG);

      expect(worklist.map((r) => r.sku)).not.toContain('SKU-SECRET');
      expect(worklist.map((r) => r.productName)).not.toContain('Secret Competitor Product');
    });
  });
});
