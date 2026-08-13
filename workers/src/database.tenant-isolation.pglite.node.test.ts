/**
 * Real-SQL (pglite) coverage for cross-tenant isolation on the product,
 * inventory and store-area read paths.
 *
 * These six queries had **no organization predicate at all** and their methods
 * took no organization argument, so four live authenticated routes returned
 * every tenant's data to any signed-in user:
 *
 *   GET /api/products          -> findProducts + countProducts
 *   GET /api/products/:id      -> findProductById
 *   GET /api/inventory-items   -> findInventoryItems + countInventoryItems
 *   GET /api/store-areas       -> findStoreAreas
 *
 * The gap was invisible because `__tests__/multi-tenant-isolation.test.ts`
 * appears to cover exactly this — its cases are named "Organization A cannot
 * see Organization B products" and "Organization B cannot read Organization A
 * product by ID" — but every one of its bodies is a comment followed by
 * `expect(expected).toBe(true)`. A test that cannot fail reported success while
 * the query returned the whole table.
 *
 * Every assertion here is written so that removing the organization predicate
 * from the query under test makes it fail. Each one seeds `OTHER_ORG` rows that
 * would be returned if scoping regressed, and asserts on identity, not just
 * count, so a coincidentally-equal number of rows cannot pass.
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

function makeDb() {
  return createWorkersDatabase({ NEON_CONNECTION_STRING: 'postgres://test' } as Env);
}

describe('Workers cross-tenant read isolation (real SQL)', () => {
  let harness: PgliteHarness;
  let sql: NeonQueryFunction<false, false>;
  // Ids are captured per test run rather than hard-coded: SERIAL keeps counting
  // across the truncations below, so a literal id would drift.
  let ownProductId: number;
  let foreignProductId: number;
  let ownAreaId: number;

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
    await sql`DELETE FROM products`;
    await sql`DELETE FROM store_areas`;

    // One product per organization. Deliberately given names that sort the
    // foreign row FIRST under `ORDER BY name ASC`, so an unscoped query cannot
    // accidentally satisfy a "first row is mine" assertion.
    const ownRows = await sql`
      INSERT INTO products (organization_id, barcode, sku, name, cost_price)
      VALUES (${ORG}, 'BAR-OWN', 'SKU-OWN', 'Zulu Own Product', 10)
      RETURNING id`;
    ownProductId = Number(ownRows[0].id);

    const foreignRows = await sql`
      INSERT INTO products (organization_id, barcode, sku, name, cost_price)
      VALUES (${OTHER_ORG}, 'BAR-FOREIGN', 'SKU-FOREIGN', 'Alpha Foreign Product', 99)
      RETURNING id`;
    foreignProductId = Number(foreignRows[0].id);

    const ownArea = await sql`
      INSERT INTO store_areas (organization_id, name) VALUES (${ORG}, 'Zulu Own Aisle')
      RETURNING id`;
    ownAreaId = Number(ownArea[0].id);

    const foreignArea = await sql`
      INSERT INTO store_areas (organization_id, name) VALUES (${OTHER_ORG}, 'Alpha Foreign Aisle')
      RETURNING id`;

    await sql`
      INSERT INTO inventory_items (organization_id, product_id, location_id, expiry_date, status)
      VALUES (${ORG}, ${ownProductId}, ${ownAreaId}, CURRENT_DATE + 30, 'Active')`;
    // Earlier expiry, so it sorts first under `ORDER BY i.expiry_date ASC`.
    await sql`
      INSERT INTO inventory_items (organization_id, product_id, location_id, expiry_date, status)
      VALUES (${OTHER_ORG}, ${foreignProductId}, ${Number(foreignArea[0].id)},
              CURRENT_DATE + 1, 'Active')`;
  });

  describe('products', () => {
    it('findProducts returns only the caller organization products', async () => {
      const products = await makeDb().findProducts(ORG, {});

      expect(products).toHaveLength(1);
      expect(products[0].id).toBe(ownProductId);
      expect(products.some((p) => p.sku === 'SKU-FOREIGN')).toBe(false);
    });

    it('findProducts does not leak other organizations through the search filter', async () => {
      // "Product" matches both rows by name, so an unscoped search returns two.
      const products = await makeDb().findProducts(ORG, { search: 'Product' });

      expect(products).toHaveLength(1);
      expect(products[0].id).toBe(ownProductId);
    });

    it('findProducts returns nothing for an organization with no products', async () => {
      const products = await makeDb().findProducts('org-with-nothing', {});
      expect(products).toEqual([]);
    });

    it('countProducts counts only the caller organization', async () => {
      expect(await makeDb().countProducts(ORG)).toBe(1);
    });

    it('countProducts scopes the search variant too', async () => {
      expect(await makeDb().countProducts(ORG, 'Product')).toBe(1);
    });

    it('findProductById returns the product when it belongs to the caller', async () => {
      const product = await makeDb().findProductById(ORG, ownProductId);
      expect(product?.id).toBe(ownProductId);
    });

    /**
     * The IDOR case. Product ids are SERIAL, so an attacker enumerates them
     * trivially; before the fix this returned another tenant's row including
     * `costPrice` and `notes`.
     */
    it('findProductById returns null for a product owned by another organization', async () => {
      const product = await makeDb().findProductById(ORG, foreignProductId);
      expect(product).toBeNull();
    });
  });

  describe('inventory items', () => {
    it('findInventoryItems returns only the caller organization items', async () => {
      const items = await makeDb().findInventoryItems(ORG, {});

      expect(items).toHaveLength(1);
      expect(items[0].productId).toBe(ownProductId);
    });

    it('countInventoryItems counts only the caller organization', async () => {
      expect(await makeDb().countInventoryItems(ORG)).toBe(1);
    });
  });

  describe('store areas', () => {
    it('findStoreAreas returns only the caller organization areas', async () => {
      const areas = await makeDb().findStoreAreas(ORG);

      expect(areas).toHaveLength(1);
      expect(areas[0].id).toBe(ownAreaId);
      expect(areas.some((a) => a.name === 'Alpha Foreign Aisle')).toBe(false);
    });
  });
});
