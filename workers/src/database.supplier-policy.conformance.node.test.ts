import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NeonQueryFunction } from '@neondatabase/serverless';
import { brandPolicyStatus, hasPolicy } from '../../shared/domain/supplier-policy';
import { createPgliteHarness, createTaggedSql, type PgliteHarness } from './__tests__/pglite-db';

const sqlHolder = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('@neondatabase/serverless', () => ({
  neon: vi.fn(() => sqlHolder.current),
}));

import { createWorkersDatabase, type SupplierWriteData } from './database';
import type { BrandReviewOptions } from '../../shared/domain/catalogue-review';

const ORG = 'policy-org';
const OTHER_ORG = 'policy-other';

describe('Worker supplier policy database (Postgres vs shared TS)', () => {
  let harness: PgliteHarness;
  let sql: NeonQueryFunction<false, false>;
  let userId: number;

  beforeAll(async () => {
    harness = await createPgliteHarness();
    sql = createTaggedSql(harness.pg);
    sqlHolder.current = sql;
    await sql`INSERT INTO organizations (id, name, slug, updated_at)
              VALUES (${ORG}, ${'Policy Org'}, ${'policy-org'}, NOW()),
                     (${OTHER_ORG}, ${'Other Org'}, ${'policy-other'}, NOW())`;
    const users = await sql`INSERT INTO users (organization_id, email, username, role, updated_at)
                            VALUES (${ORG}, ${'admin@example.com'}, ${'admin'}, ${'admin'}, NOW())
                            RETURNING id`;
    userId = Number(users[0].id);
  }, 30_000);

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    for (const table of ['catalogue_corrections', 'brands', 'suppliers', 'products']) {
      await sql([`DELETE FROM ${table}`] as unknown as TemplateStringsArray);
    }
  });

  it('persists, lists, updates, and explicitly clears every supplier policy field', async () => {
    const db = createWorkersDatabase({ DATABASE_URL: 'postgres://test' } as never);
    const data: SupplierWriteData = {
      name: 'Supplier',
      creditType: 'FULL_CREDIT',
      contactEmail: 'claims@example.com',
      contactPhone: '02 1234 5678',
      creditPolicyNote: 'Return monthly',
      policyWriteOffQty: 3,
      policyCreditQty: 1,
      followUpDays: 14,
      representativeName: 'Alex',
      representativeEmail: 'alex@example.com',
      policyUpdatedAt: '2026-07-02T00:00:00.000Z',
    };

    const created = await db.createSupplier(ORG, data);
    expect(await db.listSuppliers(ORG)).toEqual([created]);

    const updated = await db.updateSupplier(ORG, created.id, {
      ...data,
      contactPhone: '03 9999 0000',
      policyUpdatedAt: '2026-07-03T00:00:00.000Z',
    });
    expect(updated).toMatchObject({ contactPhone: '03 9999 0000' });

    const cleared = await db.clearSupplierPolicy(ORG, created.id);
    expect(cleared).toMatchObject({
      creditType: 'NONE',
      contactEmail: 'claims@example.com',
      contactPhone: '03 9999 0000',
      creditPolicyNote: '',
      policyWriteOffQty: null,
      policyCreditQty: null,
      followUpDays: 7,
      representativeName: null,
      representativeEmail: null,
    });
    expect(cleared?.policyUpdatedAt).not.toBeNull();
  });

  it('matches shared policy status, null-first order, and organization isolation', async () => {
    const supplierRows = [
      [1, ORG, 'No Policy', '   ', null],
      [2, ORG, 'Earlier', 'Return monthly', '2026-07-01T00:00:00.000Z'],
      [3, ORG, 'Later', 'Photograph damage', '2026-07-02T00:00:00.000Z'],
      [4, OTHER_ORG, 'Foreign', 'Foreign instructions', null],
    ] as const;
    for (const [id, organizationId, name, note, timestamp] of supplierRows) {
      await sql`INSERT INTO suppliers
                  (id, organization_id, name, credit_policy_note, policy_updated_at)
                VALUES (${id}, ${organizationId}, ${name}, ${note}, ${timestamp})`;
    }
    const brandRows = [
      [10, ORG, 'Zulu Missing', 1],
      [11, ORG, 'Alpha Unassigned', null],
      [12, ORG, 'Beta Earlier', 2],
      [13, ORG, 'Alpha Later', 3],
      [14, OTHER_ORG, 'Foreign Brand', 4],
    ] as const;
    for (const [id, organizationId, name, supplierId] of brandRows) {
      await sql`INSERT INTO brands (id, organization_id, name, supplier_id)
                VALUES (${id}, ${organizationId}, ${name}, ${supplierId})`;
    }

    const db = createWorkersDatabase({ DATABASE_URL: 'postgres://test' } as never);
    const workerRows = await db.listPolicyReview(ORG, {});

    // Explicit expectation captured from the original dual-backend suite.
    expect(workerRows).toEqual([
      {
        brandId: 11,
        brandName: 'Alpha Unassigned',
        supplier: null,
        status: 'MISSING',
        policyUpdatedAt: null,
        representativeName: null,
      },
      {
        brandId: 10,
        brandName: 'Zulu Missing',
        supplier: {
          id: 1,
          name: 'No Policy',
          creditType: 'NONE',
          contactEmail: null,
          contactPhone: null,
          creditPolicyNote: '   ',
          policyWriteOffQty: null,
          policyCreditQty: null,
          followUpDays: 7,
          representativeName: null,
          representativeEmail: null,
          policyUpdatedAt: null,
        },
        status: 'MISSING',
        policyUpdatedAt: null,
        representativeName: null,
      },
      {
        brandId: 12,
        brandName: 'Beta Earlier',
        supplier: {
          id: 2,
          name: 'Earlier',
          creditType: 'NONE',
          contactEmail: null,
          contactPhone: null,
          creditPolicyNote: 'Return monthly',
          policyWriteOffQty: null,
          policyCreditQty: null,
          followUpDays: 7,
          representativeName: null,
          representativeEmail: null,
          policyUpdatedAt: '2026-07-01T00:00:00.000Z',
        },
        status: 'ATTACHED',
        policyUpdatedAt: '2026-07-01T00:00:00.000Z',
        representativeName: null,
      },
      {
        brandId: 13,
        brandName: 'Alpha Later',
        supplier: {
          id: 3,
          name: 'Later',
          creditType: 'NONE',
          contactEmail: null,
          contactPhone: null,
          creditPolicyNote: 'Photograph damage',
          policyWriteOffQty: null,
          policyCreditQty: null,
          followUpDays: 7,
          representativeName: null,
          representativeEmail: null,
          policyUpdatedAt: '2026-07-02T00:00:00.000Z',
        },
        status: 'ATTACHED',
        policyUpdatedAt: '2026-07-02T00:00:00.000Z',
        representativeName: null,
      },
    ]);
    expect(workerRows.map((row) => [row.brandName, row.status])).toEqual([
      ['Alpha Unassigned', 'MISSING'],
      ['Zulu Missing', 'MISSING'],
      ['Beta Earlier', 'ATTACHED'],
      ['Alpha Later', 'ATTACHED'],
    ]);
    expect(workerRows.every((row) => row.status === brandPolicyStatus(row, row.supplier))).toBe(
      true,
    );
    expect(
      workerRows
        .filter((row) => row.supplier)
        .every((row) => hasPolicy(row.supplier) === (row.status === 'ATTACHED')),
    ).toBe(true);
    await expect(
      db.listPolicyReview(ORG, { status: 'ATTACHED', supplier: 'ear' }),
    ).resolves.toHaveLength(1);
  });

  it('matches numbered title filtering, totals, page boundaries, and stable ordering', async () => {
    const rows = [
      [101, ORG, 'BAR-101', 'SKU-101', 'vitamin C'],
      [102, ORG, 'BAR-102', 'SKU-102', 'Vitamin A'],
      [103, ORG, 'BAR-103', 'SKU-103', 'Vitamin A'],
      [104, ORG, 'BAR-104', 'SKU-104', 'Zinc'],
      [105, OTHER_ORG, 'BAR-105', 'SKU-105', 'Vitamin Foreign'],
    ] as const;
    for (const [id, organizationId, barcode, sku, name] of rows) {
      await sql`INSERT INTO products (id, organization_id, barcode, sku, name, cost_price, updated_at)
                VALUES (${id}, ${organizationId}, ${barcode}, ${sku}, ${name}, ${1}, NOW())`;
    }

    const options: BrandReviewOptions = {
      page: 1,
      pageSize: 2,
      title: 'VITAMIN',
      titleMatch: 'startsWith',
      sort: 'titleAsc',
    };
    const db = createWorkersDatabase({ DATABASE_URL: 'postgres://test' } as never);

    // Explicit expectations captured from the original dual-backend suite.
    await expect(db.reviewBrands(ORG, options)).resolves.toEqual({
      items: [
        {
          productId: 102,
          sku: 'SKU-102',
          barcode: 'BAR-102',
          productName: 'Vitamin A',
          brand: null,
        },
        {
          productId: 103,
          sku: 'SKU-103',
          barcode: 'BAR-103',
          productName: 'Vitamin A',
          brand: null,
        },
      ],
      page: 1,
      pageSize: 2,
      totalItems: 3,
      totalPages: 2,
      nextCursor: null,
    });
    await expect(db.reviewBrands(ORG, { ...options, page: 2 })).resolves.toEqual({
      items: [
        {
          productId: 101,
          sku: 'SKU-101',
          barcode: 'BAR-101',
          productName: 'vitamin C',
          brand: null,
        },
      ],
      page: 2,
      pageSize: 2,
      totalItems: 3,
      totalPages: 2,
      nextCursor: null,
    });
  });

  it('bulk-attaches atomically, reports no-ops, and rejects policy-less suppliers', async () => {
    const db = createWorkersDatabase({ DATABASE_URL: 'postgres://test' } as never);
    const suppliers = await sql`INSERT INTO suppliers (organization_id, name, credit_policy_note)
                                VALUES (${ORG}, ${'Policy'}, ${'Return monthly'}),
                                       (${ORG}, ${'Bare'}, ${''}) RETURNING id`;
    const policySupplierId = Number(suppliers[0].id);
    const bareSupplierId = Number(suppliers[1].id);
    const brands = await sql`INSERT INTO brands (organization_id, name, supplier_id)
                             VALUES (${ORG}, ${'First'}, ${null}),
                                    (${ORG}, ${'Second'}, ${policySupplierId}),
                                    (${OTHER_ORG}, ${'Foreign'}, ${null}) RETURNING id`;
    const firstId = Number(brands[0].id);
    const secondId = Number(brands[1].id);
    const foreignId = Number(brands[2].id);

    await expect(
      db.bulkAttachSupplier(ORG, policySupplierId, [firstId, secondId], userId),
    ).resolves.toEqual({ kind: 'SUCCESS', attached: 1, unchanged: 1, corrections: 1 });
    await expect(db.bulkAttachSupplier(ORG, bareSupplierId, [firstId], userId)).resolves.toEqual({
      kind: 'SUPPLIER_POLICY_MISSING',
    });

    await sql`UPDATE brands SET supplier_id = NULL WHERE id = ${firstId}`;
    await expect(
      db.bulkAttachSupplier(ORG, policySupplierId, [firstId, foreignId], userId),
    ).resolves.toEqual({ kind: 'BRAND_NOT_FOUND' });
    const rows = await sql`SELECT supplier_id FROM brands WHERE id = ${firstId}`;
    expect(rows[0].supplier_id).toBeNull();
  });

  it('bulk-links SKUs atomically, counts target no-ops, and records one correction per link', async () => {
    const db = createWorkersDatabase({ DATABASE_URL: 'postgres://test' } as never);
    const brands = await sql`INSERT INTO brands (organization_id, name, source)
                             VALUES (${ORG}, ${'Target'}, ${'USER_ADDED'}),
                                    (${ORG}, ${'Different'}, ${'USER_ADDED'}) RETURNING id`;
    const targetId = Number(brands[0].id);
    const differentId = Number(brands[1].id);
    const products = await sql`INSERT INTO products
      (organization_id, barcode, sku, name, brand_id, cost_price, updated_at)
      VALUES (${ORG}, ${'NEW'}, ${'NEW'}, ${'New'}, ${null}, ${0}, NOW()),
             (${ORG}, ${'LINKED'}, ${'LINKED'}, ${'Linked'}, ${targetId}, ${0}, NOW()),
             (${ORG}, ${'CONFLICT'}, ${'CONFLICT'}, ${'Conflict'}, ${differentId}, ${0}, NOW())
      RETURNING id`;
    const newId = Number(products[0].id);
    const linkedId = Number(products[1].id);
    const conflictId = Number(products[2].id);

    await expect(
      db.bulkLinkProducts(ORG, { brandId: targetId }, [newId, linkedId], userId),
    ).resolves.toEqual({
      kind: 'SUCCESS',
      brandId: targetId,
      linked: 1,
      alreadyLinked: 1,
      corrections: 1,
    });

    await sql`UPDATE products SET brand_id = NULL WHERE id = ${newId}`;
    await expect(
      db.bulkLinkProducts(ORG, { brandId: targetId }, [newId, conflictId], userId),
    ).resolves.toEqual({ kind: 'BRAND_CONFLICT' });
    const rows = await sql`SELECT brand_id FROM products WHERE id = ${newId}`;
    expect(rows[0].brand_id).toBeNull();
  });
});
