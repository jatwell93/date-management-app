import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NeonQueryFunction } from '@neondatabase/serverless';
import { createPgliteHarness, createTaggedSql, type PgliteHarness } from './__tests__/pglite-db';

const sqlHolder = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@neondatabase/serverless', () => ({ neon: vi.fn(() => sqlHolder.current) }));

import { createWorkersDatabase } from './database';

describe('Worker markdown credit-context projections', () => {
  let harness: PgliteHarness;
  let sql: NeonQueryFunction<false, false>;

  beforeAll(async () => {
    harness = await createPgliteHarness();
    sql = createTaggedSql(harness.pg);
    sqlHolder.current = sql;
    await sql`INSERT INTO organizations (id, name, slug, updated_at)
              VALUES ('scope-org', 'Scope Org', 'scope-org', NOW()),
                     ('other-org', 'Other Org', 'other-org', NOW())`;
  }, 30_000);

  afterAll(async () => harness.close());

  beforeEach(async () => {
    for (const table of ['inventory_items', 'products', 'brands', 'suppliers', 'store_areas']) {
      await sql([`DELETE FROM ${table}`] as unknown as TemplateStringsArray);
    }
  });

  it('uses the direct product supplier and refuses full credit from a reference brand', async () => {
    const suppliers = await sql`
      INSERT INTO suppliers (organization_id, name, credit_policy_note, credit_type)
      VALUES ('scope-org', 'Direct', 'Return monthly', 'FULL_CREDIT'),
             ('scope-org', 'Reference', 'Return monthly', 'FULL_CREDIT')
      RETURNING id, name`;
    const brands = await sql`
      INSERT INTO brands (organization_id, name, supplier_id, source)
      VALUES ('scope-org', 'Pending Brand', ${suppliers[1].id}, 'REFERENCE')
      RETURNING id`;
    await sql`
      INSERT INTO products (
        organization_id, barcode, sku, name, cost_price, retail_price, supplier_id, brand_id, updated_at
      )
      VALUES ('scope-org', 'direct', 'direct', 'Direct', 0, 19, ${suppliers[0].id}, ${brands[0].id}, NOW()),
             ('scope-org', 'reference', 'reference', 'Reference', 0, 21, NULL, ${brands[0].id}, NOW())`;

    const db = createWorkersDatabase({ DATABASE_URL: 'postgres://test' } as never);
    await expect(db.findProductByBarcode('scope-org', 'direct')).resolves.toMatchObject({
      creditScope: 'FULL_CREDIT',
      creditScopeReason: 'FULL_CREDIT',
      creditSupplierName: 'Direct',
      retailPrice: 19,
    });
    await expect(db.findProductBySku('scope-org', 'reference')).resolves.toMatchObject({
      creditScope: 'NO_CREDIT',
      creditScopeReason: 'PENDING_CONFIRMATION',
      creditSupplierName: 'Reference',
      retailPrice: 21,
    });
  });

  it('projects confirmed brand context in deterministic expiry order without cross-org influence', async () => {
    const suppliers = await sql`
      INSERT INTO suppliers (organization_id, name, credit_policy_note, credit_type)
      VALUES ('scope-org', 'Confirmed', 'Return monthly', 'FULL_CREDIT'),
             ('other-org', 'Foreign', 'Return monthly', 'FULL_CREDIT')
      RETURNING id, organization_id`;
    const brand = await sql`
      INSERT INTO brands (organization_id, name, supplier_id, source)
      VALUES ('scope-org', 'Confirmed Brand', ${suppliers[0].id}, 'CONFIRMED') RETURNING id`;
    const area = await sql`
      INSERT INTO store_areas (organization_id, name, updated_at) VALUES ('scope-org', 'Aisle', NOW()) RETURNING id`;
    const products = await sql`
      INSERT INTO products (organization_id, barcode, sku, name, cost_price, supplier_id, brand_id, updated_at)
      VALUES ('scope-org', 'brand', 'brand', 'Brand Product', 0, NULL, ${brand[0].id}, NOW()),
             ('scope-org', 'foreign', 'foreign', 'Foreign Product', 0, ${suppliers[1].id}, NULL, NOW()),
             ('other-org', 'cross-product', 'cross-product', 'Cross Tenant Product', 0, NULL, NULL, NOW())
      RETURNING id`;
    await sql`
      INSERT INTO inventory_items (organization_id, product_id, location_id, expiry_date, updated_at)
      VALUES ('scope-org', ${products[1].id}, ${area[0].id}, CURRENT_DATE + INTERVAL '2 day', NOW()),
             ('scope-org', ${products[0].id}, ${area[0].id}, CURRENT_DATE + INTERVAL '1 day', NOW()),
             ('scope-org', ${products[2].id}, ${area[0].id}, CURRENT_DATE + INTERVAL '3 day', NOW())`;

    const db = createWorkersDatabase({ DATABASE_URL: 'postgres://test' } as never);
    const rows = await db.getDetailedExpiryReport('scope-org');
    expect(rows.map((row) => row.productName)).toEqual(['Brand Product', 'Foreign Product']);
    expect(rows[0]).toMatchObject({
      creditScope: 'FULL_CREDIT',
      creditScopeReason: 'FULL_CREDIT',
      creditSupplierName: 'Confirmed',
    });
    expect(rows[1]).toMatchObject({
      creditScope: 'NO_CREDIT',
      creditScopeReason: 'NEEDS_BRAND',
      creditSupplierId: null,
    });
    await expect(db.getActiveExpiryEntries('scope-org')).resolves.toHaveLength(2);
  });
});
