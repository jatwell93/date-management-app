/**
 * Real-SQL coverage for the supplier-credit write paths (task 3.2, batch 4c).
 *
 * Express checked these in `supplier-credit.service.test.ts` against a mocked
 * repository. In the Worker the checks live inside single SQL statements: tenant
 * ownership is a `WHERE ... organization_id` on the same statement that writes, so a
 * stubbed driver could pass a version that skipped it. These tests seed a second
 * organization and assert row identity, not only counts.
 *
 * Runs under `vitest.node.config.mts` (`*.node.test.ts`, `npm run test:db`).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NeonQueryFunction } from '@neondatabase/serverless';
import { createPgliteHarness, createTaggedSql, type PgliteHarness } from './__tests__/pglite-db';

const sqlHolder = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('@neondatabase/serverless', () => ({
  neon: vi.fn(() => sqlHolder.current),
}));

import { createWorkersDatabase } from './database';

const ORG = 'sc-org';
const OTHER_ORG = 'sc-other';

describe('supplier-credit writes (real SQL)', () => {
  let harness: PgliteHarness;
  let sql: NeonQueryFunction<false, false>;
  let userId: number;
  let supplierId: number;
  let foreignSupplierId: number;
  let productId: number;
  let foreignProductId: number;
  let locationId: number;
  let foreignLocationId: number;
  let brandId: number;
  let foreignBrandId: number;

  const db = () => createWorkersDatabase({ DATABASE_URL: 'postgres://test' } as never);

  const scalar = async (query: Promise<Array<Record<string, unknown>>>) => (await query)[0];

  beforeAll(async () => {
    harness = await createPgliteHarness();
    sql = createTaggedSql(harness.pg);
    sqlHolder.current = sql;
    await sql`INSERT INTO organizations (id, name, slug, updated_at)
              VALUES (${ORG}, ${'SC Org'}, ${'sc-org'}, NOW()),
                     (${OTHER_ORG}, ${'SC Other'}, ${'sc-other'}, NOW())`;
    const users = await sql`INSERT INTO users (organization_id, email, username, role, updated_at)
                            VALUES (${ORG}, ${'sc@example.com'}, ${'scadmin'}, ${'admin'}, NOW())
                            RETURNING id`;
    userId = Number(users[0].id);
  }, 30_000);

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    for (const table of [
      'credit_claim_events',
      'credit_claim_photos',
      'credit_claim_lines',
      'credit_claims',
      'expired_item_transactions',
      'inventory_items',
      'catalogue_corrections',
      'products',
      'brands',
      'suppliers',
      'store_areas',
    ]) {
      await sql([`DELETE FROM ${table}`] as unknown as TemplateStringsArray);
    }
    const supplier = await sql`
      INSERT INTO suppliers (organization_id, name, contact_email, policy_write_off_qty,
                             policy_credit_qty, follow_up_days)
      VALUES (${ORG}, 'Acme', 'claims@acme.test', 3, 1, 7) RETURNING id`;
    supplierId = Number(supplier[0].id);
    const foreignSupplier = await sql`
      INSERT INTO suppliers (organization_id, name, contact_email, policy_write_off_qty,
                             policy_credit_qty, follow_up_days)
      VALUES (${OTHER_ORG}, 'Other', 'claims@other.test', 3, 1, 7) RETURNING id`;
    foreignSupplierId = Number(foreignSupplier[0].id);

    const brand = await sql`
      INSERT INTO brands (organization_id, name, source, created_at, updated_at)
      VALUES (${ORG}, 'Brand A', 'REFERENCE', NOW(), NOW()) RETURNING id`;
    brandId = Number(brand[0].id);
    const foreignBrand = await sql`
      INSERT INTO brands (organization_id, name, source, created_at, updated_at)
      VALUES (${OTHER_ORG}, 'Brand B', 'REFERENCE', NOW(), NOW()) RETURNING id`;
    foreignBrandId = Number(foreignBrand[0].id);

    const product = await sql`
      INSERT INTO products (organization_id, barcode, sku, name, cost_price, updated_at)
      VALUES (${ORG}, 'BAR-A', 'SKU-A', 'Widget', 10, NOW()) RETURNING id`;
    productId = Number(product[0].id);
    const foreignProduct = await sql`
      INSERT INTO products (organization_id, barcode, sku, name, cost_price, updated_at)
      VALUES (${OTHER_ORG}, 'BAR-B', 'SKU-B', 'Foreign Widget', 10, NOW()) RETURNING id`;
    foreignProductId = Number(foreignProduct[0].id);

    const area = await sql`
      INSERT INTO store_areas (organization_id, name, updated_at)
      VALUES (${ORG}, 'Aisle', NOW()) RETURNING id`;
    locationId = Number(area[0].id);
    const foreignArea = await sql`
      INSERT INTO store_areas (organization_id, name, updated_at)
      VALUES (${OTHER_ORG}, 'Aisle', NOW()) RETURNING id`;
    foreignLocationId = Number(foreignArea[0].id);
  });

  describe('disposeClaimableWriteOff', () => {
    const seedWriteOff = async (org = ORG, product = productId, location = locationId) => {
      const item = await sql`
        INSERT INTO inventory_items (organization_id, product_id, location_id, expiry_date, updated_at)
        VALUES (${org}, ${product}, ${location}, NOW(), NOW()) RETURNING id`;
      const transaction = await sql`
        INSERT INTO expired_item_transactions (organization_id, inventory_item_id, action,
                                               units_discarded, updated_at)
        VALUES (${org}, ${Number(item[0].id)}, 'expired', 6, NOW()) RETURNING id`;
      return Number(transaction[0].id);
    };
    const dispositionOf = async (id: number) =>
      (await scalar(sql`SELECT credit_disposition FROM expired_item_transactions WHERE id = ${id}`))
        .credit_disposition;

    it('disposes a write-off once, then reports it already disposed', async () => {
      const id = await seedWriteOff();

      expect(await db().disposeClaimableWriteOff(ORG, id)).toBe('DISPOSED');
      expect(await dispositionOf(id)).toBe('DISPOSED');
      expect(await db().disposeClaimableWriteOff(ORG, id)).toBe('ALREADY_DISPOSED');
      expect(await dispositionOf(id)).toBe('DISPOSED');
    });

    it('refuses a write-off that has entered a claim and leaves it undisposed', async () => {
      const id = await seedWriteOff();
      // A claim line needs the product assigned to the claiming supplier.
      await sql`UPDATE products SET supplier_id = ${supplierId} WHERE id = ${productId}`;
      const built = await db().buildCreditClaim(
        ORG,
        { supplierId, lines: [{ expiredItemTransactionId: id }] },
        userId,
      );
      expect(built.ok).toBe(true);

      expect(await db().disposeClaimableWriteOff(ORG, id)).toBe('CLAIMED');
      expect(await dispositionOf(id)).not.toBe('DISPOSED');
    });

    it('does not disclose or touch another organization write-off', async () => {
      const foreignId = await seedWriteOff(OTHER_ORG, foreignProductId, foreignLocationId);
      const before = await dispositionOf(foreignId);

      expect(await db().disposeClaimableWriteOff(ORG, foreignId)).toBe('NOT_FOUND');
      expect(await db().disposeClaimableWriteOff(ORG, 999_999)).toBe('NOT_FOUND');
      expect(await dispositionOf(foreignId)).toBe(before);
    });

    it('answers a write-off that is not an expiry as not found', async () => {
      const id = await seedWriteOff();
      await sql`UPDATE expired_item_transactions SET action = 'sold_through' WHERE id = ${id}`;

      expect(await db().disposeClaimableWriteOff(ORG, id)).toBe('NOT_FOUND');
    });
  });

  describe('confirmBrandSupplier', () => {
    it('confirms an organization-owned supplier for an organization-owned brand', async () => {
      const brand = await db().confirmBrandSupplier(ORG, brandId, supplierId);

      expect(brand).toMatchObject({ id: brandId, supplierId, source: 'CONFIRMED' });
    });

    it('refuses a supplier from another organization and changes nothing', async () => {
      expect(await db().confirmBrandSupplier(ORG, brandId, foreignSupplierId)).toBeNull();

      const row = await scalar(sql`SELECT supplier_id, source FROM brands WHERE id = ${brandId}`);
      expect(row.supplier_id).toBeNull();
      expect(row.source).toBe('REFERENCE');
    });

    it('refuses a brand from another organization and changes nothing', async () => {
      expect(await db().confirmBrandSupplier(ORG, foreignBrandId, supplierId)).toBeNull();

      const row = await scalar(
        sql`SELECT supplier_id, source FROM brands WHERE id = ${foreignBrandId}`,
      );
      expect(row.supplier_id).toBeNull();
      expect(row.source).toBe('REFERENCE');
    });
  });

  describe('assignProductSupplier', () => {
    const corrections = async () =>
      sql`SELECT kind, status, product_id, chosen_supplier_id FROM catalogue_corrections`;
    const supplierOf = async (id: number) =>
      (await scalar(sql`SELECT supplier_id FROM products WHERE id = ${id}`)).supplier_id;

    it('assigns an organization-owned supplier and records one override correction', async () => {
      expect(await db().assignProductSupplier(ORG, userId, productId, supplierId)).toBe(true);

      expect(Number(await supplierOf(productId))).toBe(supplierId);
      const rows = await corrections();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ kind: 'SUPPLIER_OVERRIDE', status: 'PENDING' });
      expect(Number(rows[0].product_id)).toBe(productId);
      expect(Number(rows[0].chosen_supplier_id)).toBe(supplierId);
    });

    it('clears the supplier without a supplier lookup and records no correction', async () => {
      await sql`UPDATE products SET supplier_id = ${supplierId} WHERE id = ${productId}`;

      expect(await db().assignProductSupplier(ORG, userId, productId, null)).toBe(true);

      expect(await supplierOf(productId)).toBeNull();
      expect(await corrections()).toHaveLength(0);
    });

    it('refuses a supplier from another organization and changes nothing', async () => {
      expect(await db().assignProductSupplier(ORG, userId, productId, foreignSupplierId)).toBe(
        false,
      );

      expect(await supplierOf(productId)).toBeNull();
      expect(await corrections()).toHaveLength(0);
    });

    it('refuses a product from another organization and changes nothing', async () => {
      expect(await db().assignProductSupplier(ORG, userId, foreignProductId, supplierId)).toBe(
        false,
      );

      expect(await supplierOf(foreignProductId)).toBeNull();
      expect(await corrections()).toHaveLength(0);
    });
  });

  describe('addBrand', () => {
    const brandCount = async (org: string) =>
      Number(
        (await scalar(sql`SELECT COUNT(*)::int AS n FROM brands WHERE organization_id = ${org}`)).n,
      );

    it('creates the brand, attaches it to the product and records one correction together', async () => {
      const brand = await db().addBrand(ORG, userId, {
        productId,
        name: 'New Brand',
        supplierId,
      });

      expect(brand).toMatchObject({ name: 'New Brand', supplierId, source: 'USER_ADDED' });
      const product = await scalar(sql`SELECT brand_id FROM products WHERE id = ${productId}`);
      expect(Number(product.brand_id)).toBe(brand?.id);
      const rows = await sql`SELECT kind, status, brand_id, chosen_supplier_id, entered_brand_name
                             FROM catalogue_corrections`;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        kind: 'BRAND_ADDED',
        status: 'PENDING',
        entered_brand_name: 'New Brand',
      });
      expect(Number(rows[0].brand_id)).toBe(brand?.id);
    });

    it('refuses a product from another organization without creating a brand', async () => {
      const before = await brandCount(ORG);

      expect(
        await db().addBrand(ORG, userId, {
          productId: foreignProductId,
          name: 'Sneaky',
          supplierId,
        }),
      ).toBeNull();

      expect(await brandCount(ORG)).toBe(before);
      expect(await sql`SELECT id FROM catalogue_corrections`).toHaveLength(0);
    });

    it('refuses a supplier from another organization without creating a brand', async () => {
      const before = await brandCount(ORG);

      expect(
        await db().addBrand(ORG, userId, {
          productId,
          name: 'Sneaky',
          supplierId: foreignSupplierId,
        }),
      ).toBeNull();

      expect(await brandCount(ORG)).toBe(before);
      const product = await scalar(sql`SELECT brand_id FROM products WHERE id = ${productId}`);
      expect(product.brand_id).toBeNull();
    });
  });

  describe('reviewCatalogueCorrection', () => {
    it('reviews a pending correction once, then reports it already reviewed', async () => {
      const correction = await sql`
        INSERT INTO catalogue_corrections (organization_id, product_id, kind, status,
                                           created_by_user_id, created_at, updated_at)
        VALUES (${ORG}, ${productId}, 'BRAND_ADDED', 'PENDING', ${userId}, NOW(), NOW())
        RETURNING id`;
      const id = Number(correction[0].id);

      expect(await db().reviewCatalogueCorrection(id, 'ACCEPTED')).toBe('UPDATED');
      expect(await db().reviewCatalogueCorrection(id, 'REJECTED')).toBe('ALREADY_REVIEWED');

      const row = await scalar(sql`SELECT status FROM catalogue_corrections WHERE id = ${id}`);
      expect(row.status).toBe('ACCEPTED');
    });

    it('lists pending corrections by id with a stable cursor, across organizations', async () => {
      const ids: number[] = [];
      for (const org of [ORG, OTHER_ORG, ORG]) {
        const row = await sql`
          INSERT INTO catalogue_corrections (organization_id, kind, status, created_at, updated_at)
          VALUES (${org}, 'BRAND_ADDED', 'PENDING', NOW(), NOW()) RETURNING id`;
        ids.push(Number(row[0].id));
      }
      await sql`
        INSERT INTO catalogue_corrections (organization_id, kind, status, created_at, updated_at)
        VALUES (${ORG}, 'BRAND_ADDED', 'ACCEPTED', NOW(), NOW())`;

      const first = await db().listCatalogueCorrections({ status: 'PENDING', limit: 2 });
      expect(first.items.map((i) => i.id)).toEqual([ids[0], ids[1]]);
      expect(first.items.map((i) => i.organization.id)).toEqual([ORG, OTHER_ORG]);
      expect(first.nextCursor).toBe(ids[1]);

      const second = await db().listCatalogueCorrections({
        status: 'PENDING',
        cursor: first.nextCursor ?? undefined,
        limit: 2,
      });
      expect(second.items.map((i) => i.id)).toEqual([ids[2]]);
      expect(second.nextCursor).toBeNull();
    });

    it('answers an unknown correction as not found', async () => {
      expect(await db().reviewCatalogueCorrection(999_999, 'ACCEPTED')).toBe('NOT_FOUND');
    });
  });
});
