/**
 * Real-data (pglite) coverage for tier usage limits (task 3.1.a, issue #471).
 *
 * These have to run against real SQL rather than a mocked `sql` tag, because
 * the property under test IS the SQL: the cap is a subquery of the INSERT. A
 * stubbed driver would happily "pass" a read-then-insert implementation with a
 * far wider TOCTOU window — Neon's HTTP driver gives no transaction to close it
 * with, which is why the check lives in the statement instead of around it.
 *
 * **The cap is soft, not exact**, and nothing here proves otherwise: pglite is
 * one in-process connection and serializes every statement, so the concurrent
 * interleaving that lets two creates both observe room cannot be reproduced in
 * this harness. See `utils/usage-limits.ts` for the guarantee that actually
 * holds in production.
 *
 * Context for why the caps are counted rather than read from a column:
 * `organization_usage.active_users` / `.total_skus` are written once as
 * literal zeros and incremented nowhere in either backend, so every gate that
 * read them compared `0 >= max` and never fired. See `utils/usage-limits.ts`.
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
import { isUniqueViolation } from './db-errors';

const ORG = 'org-a';
const OTHER_ORG = 'org-b';
const USER_ID = 1;

describe('Workers tier usage limits (real SQL)', () => {
  let harness: PgliteHarness;
  let sql: NeonQueryFunction<false, false>;
  let locationId: number;
  let uploaderId: number;

  const makeDb = () => createWorkersDatabase({ NEON_CONNECTION_STRING: 'postgres://test' } as Env);

  beforeAll(async () => {
    harness = await createPgliteHarness();
    sql = createTaggedSql(harness.pg);
    sqlHolder.current = sql;
    // products/uploads/etc. carry real organization FKs.
    await sql`INSERT INTO organizations (id, name, slug, updated_at)
              VALUES (${ORG}, 'Org A', 'org-a', NOW()),
                     (${OTHER_ORG}, 'Org B', 'org-b', NOW())
              ON CONFLICT (id) DO NOTHING`;
  }, 30000); // pglite WASM cold-start can exceed the default 10s hook timeout

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await sql`DELETE FROM audit_log`;
    await sql`DELETE FROM inventory_items`;
    await sql`DELETE FROM products`;
    await sql`DELETE FROM store_areas`;
    await sql`DELETE FROM uploads`;
    await sql`DELETE FROM users`;
    const areaRows = await sql`
      INSERT INTO store_areas (organization_id, name, updated_at) VALUES (${ORG}, ${'Aisle 1'}, NOW()) RETURNING id`;
    locationId = Number(areaRows[0].id);
  });

  // uploads.user_id is a real FK — seed lazily so usage counts stay honest.
  const seedUploader = async () => {
    const uploaderRows = await sql`
      INSERT INTO users (organization_id, username, role, updated_at)
      VALUES (${ORG}, ${'uploader'}, ${'admin'}, NOW()) RETURNING id`;
    uploaderId = Number(uploaderRows[0].id);
  };

  const seedProducts = async (count: number, organizationId = ORG) => {
    for (let i = 0; i < count; i += 1) {
      await sql`
        INSERT INTO products (organization_id, barcode, sku, name, cost_price, updated_at)
        VALUES (${organizationId}, ${`BAR-${organizationId}-${i}`}, ${`SKU-${organizationId}-${i}`},
                ${`Product ${i}`}, 1, NOW())`;
    }
  };

  const countProducts = async (organizationId = ORG) => {
    const rows = await sql`
      SELECT COUNT(*)::int as count FROM products WHERE organization_id = ${organizationId}`;
    return Number(rows[0].count);
  };

  describe('createProduct SKU cap', () => {
    it('creates the product that sits exactly at the last free slot', async () => {
      await seedProducts(4);

      const product = await makeDb().createProduct(
        ORG,
        { barcode: 'BAR-LAST', name: 'Last allowed' },
        5,
      );

      expect(product).not.toBeNull();
      expect(product?.name).toBe('Last allowed');
      expect(await countProducts()).toBe(5);
    });

    it('refuses the product that would exceed the cap, and writes nothing', async () => {
      await seedProducts(5);

      const product = await makeDb().createProduct(
        ORG,
        { barcode: 'BAR-OVER', name: 'One too many' },
        5,
      );

      expect(product).toBeNull();
      expect(await countProducts()).toBe(5);
      const rows = await sql`SELECT id FROM products WHERE barcode = ${'BAR-OVER'}`;
      expect(rows).toHaveLength(0);
    });

    // The cap must be per-tenant. Counting every row in `products` regardless
    // of organization would let a large tenant exhaust a small tenant's quota,
    // which is the same shape as the cross-tenant defects in #462/#466.
    it("does not count another organization's products toward the cap", async () => {
      await seedProducts(50, OTHER_ORG);
      await seedProducts(1, ORG);

      const product = await makeDb().createProduct(
        ORG,
        { barcode: 'BAR-OWN', name: 'Own tenant' },
        5,
      );

      expect(product).not.toBeNull();
      expect(await countProducts(ORG)).toBe(2);
      expect(await countProducts(OTHER_ORG)).toBe(50);
    });

    // Each create re-evaluates the cap against committed state, so the second
    // of two back-to-back creates for the last slot is refused. A cap resolved
    // once and reused, or counted before the loop, would admit both.
    //
    // **This does NOT prove the concurrent case, despite the `Promise.all`.**
    // pglite is a single in-process connection and serializes these two
    // statements, so the first has committed before the second takes its
    // snapshot -- the interleaving that matters cannot occur here. Under real
    // concurrency the cap is soft: READ COMMITTED lets both statements observe
    // room and both insert (see `utils/usage-limits.ts`). Demonstrating that
    // needs two real connections, which this harness does not have; asserting
    // it here would be asserting the harness, not the database.
    it('refuses the second of two back-to-back creates for the last slot', async () => {
      await seedProducts(4);
      const db = makeDb();

      const results = await Promise.all([
        db.createProduct(ORG, { barcode: 'BAR-RACE-1', name: 'Racer 1' }, 5),
        db.createProduct(ORG, { barcode: 'BAR-RACE-2', name: 'Racer 2' }, 5),
      ]);

      expect(results.filter((r) => r !== null)).toHaveLength(1);
      expect(results.filter((r) => r === null)).toHaveLength(1);
      expect(await countProducts()).toBe(5);
    });

    it('treats a zero cap as admitting nothing', async () => {
      const product = await makeDb().createProduct(ORG, { barcode: 'BAR-ZERO', name: 'Nope' }, 0);

      expect(product).toBeNull();
      expect(await countProducts()).toBe(0);
    });

    // Measure-only mode (USAGE_LIMITS_ENFORCE off) retries the refused INSERT
    // with UNLIMITED_CAP. The unit tests can only show that constant is a safe
    // JS integer; whether it survives the driver as an integer the planner will
    // compare against COUNT(*) is a real-SQL question, so it is asked here.
    // Number.MAX_SAFE_INTEGER exceeds int4, so a cap parameter inferred as
    // `integer` rather than `bigint` would error instead of admitting the row.
    it('admits the over-cap product when the cap is lifted to UNLIMITED_CAP', async () => {
      await seedProducts(5);

      const product = await makeDb().createProduct(
        ORG,
        { barcode: 'BAR-OVER', name: 'One too many' },
        UNLIMITED_CAP,
      );

      expect(product).not.toBeNull();
      expect(await countProducts()).toBe(6);
    });
  });

  describe('createInventoryItem active-expiry cap', () => {
    let productId: number;

    beforeEach(async () => {
      const rows = await sql`
        INSERT INTO products (organization_id, barcode, sku, name, cost_price, updated_at)
        VALUES (${ORG}, ${'BAR-INV'}, ${'SKU-INV'}, ${'Inventory product'}, 5, NOW())
        RETURNING id`;
      productId = Number(rows[0].id);
      // audit_log.user_id is a real FK — createInventoryItem writes audit
      // rows for USER_ID.
      await sql`INSERT INTO users (id, organization_id, username, role, updated_at)
                VALUES (${USER_ID}, ${ORG}, ${'actor'}, ${'admin'}, NOW())`;
    });

    // Each item gets its own expiry day: one active item per product, expiry
    // and location is a unique index (migration 0019), so identical rows would
    // not seed.
    const seedItems = async (count: number, status = 'Normal') => {
      for (let i = 0; i < count; i += 1) {
        await sql`
          INSERT INTO inventory_items (organization_id, product_id, location_id, expiry_date, status, updated_at)
          VALUES (${ORG}, ${productId}, ${locationId}, DATE '2099-01-01' + ${i}::int, ${status}, NOW())`;
      }
    };

    const countItems = async () => {
      const rows = await sql`
        SELECT COUNT(*)::int as count FROM inventory_items WHERE organization_id = ${ORG}`;
      return Number(rows[0].count);
    };

    it('creates the item that sits exactly at the last free slot', async () => {
      await seedItems(2);

      const item = await makeDb().createInventoryItem(
        ORG,
        USER_ID,
        { productId, expiryDate: '2099-06-01', locationId },
        3,
      );

      expect(item).not.toBeNull();
      expect(await countItems()).toBe(3);
    });

    it('refuses the item that would exceed the cap, and writes no audit row', async () => {
      await seedItems(3);

      const item = await makeDb().createInventoryItem(
        ORG,
        USER_ID,
        { productId, expiryDate: '2099-06-01', locationId },
        3,
      );

      expect(item).toBeNull();
      expect(await countItems()).toBe(3);
      // The insert and its audit entry share one CTE, so a refusal must leave
      // neither -- an orphaned 'create' audit row for an item that does not
      // exist would corrupt the audit trail.
      const audit = await sql`
        SELECT id FROM audit_log WHERE organization_id = ${ORG} AND action = ${'create'}`;
      expect(audit).toHaveLength(0);
    });

    // Mirrors countActiveExpiryItems in
    // backend/src/repositories/subscription.repository.ts:149. Without this,
    // an organization that had worked through its expiries would stay locked
    // out at its cap forever.
    it.each([['Processed'], ['Completed'], ['Discarded'], ['Archived'], ['Sold Through']])(
      'does not count items in the terminal status %s toward the cap',
      async (terminalStatus) => {
        await seedItems(10, terminalStatus);

        const item = await makeDb().createInventoryItem(
          ORG,
          USER_ID,
          { productId, expiryDate: '2099-06-01', locationId },
          3,
        );

        expect(item).not.toBeNull();
      },
    );

    // Serialized by pglite, like its products counterpart above -- it shows the
    // cap is re-evaluated per statement, not that the concurrent race is closed.
    it('refuses the second of two back-to-back creates for the last slot', async () => {
      await seedItems(2);
      const db = makeDb();

      const results = await Promise.all([
        db.createInventoryItem(
          ORG,
          USER_ID,
          { productId, expiryDate: '2099-06-01', locationId },
          3,
        ),
        db.createInventoryItem(
          ORG,
          USER_ID,
          { productId, expiryDate: '2099-06-02', locationId },
          3,
        ),
      ]);

      expect(results.filter((r) => r !== null)).toHaveLength(1);
      expect(await countItems()).toBe(3);
    });
  });

  // The cap counts live rows, so anything that removes or retires a row has to
  // give the slot back. Express's "counter stays accurate across creations and
  // deletions" row (multi-tenant-usage-limits.test.ts:506) asserted this against
  // a counter column; here there is no counter to drift, so the property to
  // prove is that the COUNT in the INSERT agrees with what the caller can see.
  // Duplicate identity is closed by the unique indexes, not by a read-then-write
  // check, so two uploads racing for one barcode cannot both land. pglite
  // serializes statements and cannot stage the race; what it can prove is that
  // the index is the arbiter, which is what makes the race safe on Neon.
  describe('product identity is enforced by the database', () => {
    it('refuses a second product with the same barcode in one organization', async () => {
      await makeDb().createProduct(ORG, { barcode: 'BAR-DUP', sku: 'SKU-D1', name: 'First' }, 10);

      const attempt = makeDb().createProduct(
        ORG,
        { barcode: 'BAR-DUP', sku: 'SKU-D2', name: 'Second' },
        10,
      );

      await expect(attempt).rejects.toSatisfy(isUniqueViolation);
      expect(await countProducts()).toBe(1);
      const rows = await sql`SELECT name FROM products WHERE barcode = ${'BAR-DUP'}`;
      expect(rows.map((row) => row.name)).toEqual(['First']);
    });

    it('refuses a second product with the same SKU in one organization', async () => {
      await makeDb().createProduct(ORG, { barcode: 'BAR-S1', sku: 'SKU-DUP', name: 'First' }, 10);

      const attempt = makeDb().createProduct(
        ORG,
        { barcode: 'BAR-S2', sku: 'SKU-DUP', name: 'Second' },
        10,
      );

      await expect(attempt).rejects.toSatisfy(isUniqueViolation);
      expect(await countProducts()).toBe(1);
    });

    it('lets two organizations hold the same barcode', async () => {
      await makeDb().createProduct(ORG, { barcode: 'BAR-SHARED', name: 'Mine' }, 10);

      const other = await makeDb().createProduct(
        OTHER_ORG,
        { barcode: 'BAR-SHARED', name: 'Theirs' },
        10,
      );

      expect(other?.name).toBe('Theirs');
      expect(await countProducts(OTHER_ORG)).toBe(1);
    });
  });

  // `createQueuedCatalogueUpload` guards with `WHERE NOT EXISTS`, which two
  // concurrent requests can both pass. The partial unique index from migration
  // 0001 is what actually admits one of them; the handler maps its violation to
  // 409. Asserting the index is asserting the guarantee.
  describe('one active catalogue import per organization', () => {
    const insertCatalogueUpload = async (organizationId: string, key: string, status: string) => {
      await sql`
        INSERT INTO uploads
          (organization_id, user_id, file_key, file_name, file_size_bytes, import_type, status, updated_at)
        VALUES (${organizationId}, ${uploaderId}, ${key}, ${`${key}.csv`}, 10, ${'product-catalog'}, ${status}, NOW())`;
    };

    beforeEach(async () => {
      await seedUploader();
    });

    it.each(['pending', 'queued', 'validating', 'processing'])(
      'refuses a second import while the first is %s',
      async (activeStatus) => {
        await insertCatalogueUpload(ORG, 'first', activeStatus);

        await expect(insertCatalogueUpload(ORG, 'second', 'pending')).rejects.toSatisfy(
          isUniqueViolation,
        );
        const rows = await sql`SELECT file_key FROM uploads WHERE organization_id = ${ORG}`;
        expect(rows.map((row) => row.file_key)).toEqual(['first']);
      },
    );

    it('admits the next import once the first has finished or failed', async () => {
      await insertCatalogueUpload(ORG, 'done', 'completed');
      await insertCatalogueUpload(ORG, 'broken', 'failed');

      await insertCatalogueUpload(ORG, 'next', 'pending');

      const rows = await sql`SELECT file_key FROM uploads WHERE organization_id = ${ORG}`;
      expect(rows).toHaveLength(3);
    });

    it('does not let one organization block another', async () => {
      await insertCatalogueUpload(ORG, 'mine', 'processing');

      await insertCatalogueUpload(OTHER_ORG, 'theirs', 'pending');

      const rows = await sql`SELECT file_key FROM uploads WHERE organization_id = ${OTHER_ORG}`;
      expect(rows).toHaveLength(1);
    });
  });

  describe('slots are returned when rows are removed or retired', () => {
    it('admits a product once another is deleted', async () => {
      await seedProducts(5);
      const db = makeDb();
      expect(await db.createProduct(ORG, { barcode: 'BAR-X', name: 'Blocked' }, 5)).toBeNull();

      const rows = await sql`SELECT id FROM products WHERE organization_id = ${ORG} LIMIT 1`;
      const removed = await db.deleteProduct(ORG, Number(rows[0].id));
      expect(removed).toEqual({ outcome: 'deleted' });

      const created = await db.createProduct(ORG, { barcode: 'BAR-Y', name: 'Admitted' }, 5);
      expect(created?.name).toBe('Admitted');
      expect(await countProducts()).toBe(5);
    });

    it('does not count a discarded inventory item against the active-expiry cap', async () => {
      await sql`INSERT INTO users (id, organization_id, username, role, updated_at)
                VALUES (${USER_ID}, ${ORG}, ${'actor'}, ${'admin'}, NOW())`;
      const productRows = await sql`
        INSERT INTO products (organization_id, barcode, sku, name, cost_price, updated_at)
        VALUES (${ORG}, ${'BAR-D'}, ${'SKU-D'}, ${'Discard product'}, 5, NOW()) RETURNING id`;
      const productId = Number(productRows[0].id);
      for (let i = 0; i < 3; i += 1) {
        await sql`
          INSERT INTO inventory_items (organization_id, product_id, location_id, expiry_date, status, updated_at)
          VALUES (${ORG}, ${productId}, ${locationId}, ${'2099-01-01'}, ${'Discarded'}, NOW())`;
      }

      const item = await makeDb().createInventoryItem(
        ORG,
        USER_ID,
        { productId, expiryDate: '2099-06-01', locationId },
        1,
      );

      expect(item).not.toBeNull();
    });

    it('admits a user once another is soft-deleted', async () => {
      const adminRows = await sql`
        INSERT INTO users (organization_id, username, role, updated_at)
        VALUES (${ORG}, ${'admin'}, ${'admin'}, NOW()) RETURNING id`;
      const actor = { userId: Number(adminRows[0].id), ipAddress: null };
      const leaverRows = await sql`
        INSERT INTO users (organization_id, username, role, updated_at)
        VALUES (${ORG}, ${'leaver'}, ${'team_member'}, NOW()) RETURNING id`;
      const db = makeDb();
      const seat = (username: string) =>
        db.createOrganizationUser(ORG, { username, role: 'team_member', seatCap: 2, actor });
      expect(await seat('blocked')).toBeNull();

      expect(await db.softDeleteUser(ORG, Number(leaverRows[0].id))).toBe(true);

      const created = await seat('replacement');
      expect(created).not.toBeNull();
    });
  });

  describe('usage reporting', () => {
    it('counts SKUs, users and active expiries for the organization only', async () => {
      await seedProducts(3);
      await seedProducts(7, OTHER_ORG);
      await sql`INSERT INTO users (organization_id, username, role, updated_at) VALUES (${ORG}, ${'a'}, ${'admin'}, NOW())`;
      await sql`INSERT INTO users (organization_id, username, role, updated_at) VALUES (${ORG}, ${'b'}, ${'team_member'}, NOW())`;
      await sql`INSERT INTO users (organization_id, username, role, updated_at) VALUES (${OTHER_ORG}, ${'c'}, ${'admin'}, NOW())`;
      // A soft-deleted user is invisible to listUsers, so it must not be
      // reported (or enforced) as a seat either.
      await sql`INSERT INTO users (organization_id, username, role, updated_at, deleted_at) VALUES (${ORG}, ${'gone'}, ${'team_member'}, NOW(), NOW())`;

      const productRows = await sql`
        SELECT id FROM products WHERE organization_id = ${ORG} LIMIT 1`;
      const pid = Number(productRows[0].id);
      await sql`
        INSERT INTO inventory_items (organization_id, product_id, location_id, expiry_date, status, updated_at)
        VALUES (${ORG}, ${pid}, ${locationId}, ${'2099-01-01'}, ${'Normal'}, NOW())`;
      await sql`
        INSERT INTO inventory_items (organization_id, product_id, location_id, expiry_date, status, updated_at)
        VALUES (${ORG}, ${pid}, ${locationId}, ${'2099-01-01'}, ${'Discarded'}, NOW())`;

      const counts = await makeDb().getUsageCounts(ORG);

      expect(counts).toEqual({ skus: 3, users: 2, activeExpiries: 1 });
    });

    it('returns zeroes for an organization with nothing in it', async () => {
      const counts = await makeDb().getUsageCounts('org-empty');

      expect(counts).toEqual({ skus: 0, users: 0, activeExpiries: 0 });
    });

    it('sums recorded upload bytes for the organization, ignoring deleted rows', async () => {
      await seedUploader();
      await sql`
        INSERT INTO uploads (organization_id, user_id, file_key, file_name, file_size_bytes, status, updated_at)
        VALUES (${ORG}, ${uploaderId}, ${'k1'}, ${'a.csv'}, 1000, ${'completed'}, NOW())`;
      await sql`
        INSERT INTO uploads (organization_id, user_id, file_key, file_name, file_size_bytes, status, updated_at)
        VALUES (${ORG}, ${uploaderId}, ${'k2'}, ${'b.csv'}, 500, ${'completed'}, NOW())`;
      await sql`
        INSERT INTO uploads (organization_id, user_id, file_key, file_name, file_size_bytes, status, updated_at)
        VALUES (${ORG}, ${uploaderId}, ${'k3'}, ${'gone.csv'}, 9999, ${'deleted'}, NOW())`;
      await sql`
        INSERT INTO uploads (organization_id, user_id, file_key, file_name, file_size_bytes, status, updated_at)
        VALUES (${OTHER_ORG}, ${uploaderId}, ${'k4'}, ${'other.csv'}, 7777, ${'completed'}, NOW())`;

      expect(await makeDb().getStorageUsedBytes(ORG)).toBe(1500);
    });

    // `uploads.file_size_bytes` is INTEGER, so no single row can exceed ~2.1GB
    // (the upload path caps files at 100MB anyway) -- but the SUM across rows
    // can, and SUM(integer) is bigint in Postgres. What this pins is that the
    // total stays arithmetically correct past 2^31 rather than wrapping.
    //
    // It does NOT prove the bigint-as-string case: pglite hands bigint back as
    // a JS number, whereas @neondatabase/serverless returns a string, so the
    // Number() cast in getStorageUsedBytes is load-bearing in production and
    // unfalsifiable from here. Verified by mutation -- removing the cast leaves
    // this test green. Do not read a passing run as cover for dropping it.
    it('sums past the 32-bit ceiling without wrapping', async () => {
      await seedUploader();
      const hundredMb = 100 * 1024 * 1024;
      for (let i = 0; i < 30; i += 1) {
        await sql`
          INSERT INTO uploads (organization_id, user_id, file_key, file_name, file_size_bytes, status, updated_at)
          VALUES (${ORG}, ${uploaderId}, ${`big-${i}`}, ${`big${i}.csv`}, ${hundredMb}, ${'completed'}, NOW())`;
      }

      const used = await makeDb().getStorageUsedBytes(ORG);

      expect(used).toBe(hundredMb * 30);
      expect(used).toBeGreaterThan(2 ** 31 - 1);
    });

    it('reports zero rather than null when an organization has no uploads', async () => {
      expect(await makeDb().getStorageUsedBytes('org-empty')).toBe(0);
    });
  });
});
