import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NeonQueryFunction } from '@neondatabase/serverless';
import { brandPolicyStatus, hasPolicy } from '../../shared/domain/supplier-policy';
import { createPgliteHarness, createTaggedSql, type PgliteHarness } from './__tests__/pglite-db';

const backendRequire = createRequire(
  fileURLToPath(new URL('../../backend/package.json', import.meta.url)),
);
const SQLiteDatabase = backendRequire('better-sqlite3') as typeof import('better-sqlite3');

const sqlHolder = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('@neondatabase/serverless', () => ({
  neon: vi.fn(() => sqlHolder.current),
}));

import { createWorkersDatabase, type PolicyReviewItem, type SupplierWriteData } from './database';
import type { BrandReviewOptions, BrandReviewPage } from './database';

const ORG = 'policy-org';
const OTHER_ORG = 'policy-other';

function createSqlitePolicyDb(): import('better-sqlite3').Database {
  const db = new SQLiteDatabase(':memory:');
  db.exec(`
    CREATE TABLE suppliers (
      id INTEGER PRIMARY KEY,
      organization_id TEXT NOT NULL,
      name TEXT NOT NULL,
      contact_email TEXT,
      contact_phone TEXT,
      credit_policy_note TEXT NOT NULL DEFAULT '',
      policy_write_off_qty INTEGER,
      policy_credit_qty INTEGER,
      follow_up_days INTEGER NOT NULL DEFAULT 7,
      representative_name TEXT,
      representative_email TEXT,
      policy_updated_at TEXT
    );
    CREATE TABLE brands (
      id INTEGER PRIMARY KEY,
      organization_id TEXT NOT NULL,
      name TEXT NOT NULL,
      manufacturer_name TEXT,
      suggested_supplier_name TEXT,
      supplier_id INTEGER,
      source TEXT NOT NULL DEFAULT 'REFERENCE'
    );
    CREATE TABLE products (
      id INTEGER PRIMARY KEY,
      organization_id TEXT NOT NULL,
      barcode TEXT NOT NULL,
      sku TEXT NOT NULL,
      name TEXT NOT NULL,
      cost_price REAL NOT NULL DEFAULT 0,
      brand_id INTEGER
    );
  `);
  return db;
}

function sqliteCatalogueReview(
  db: import('better-sqlite3').Database,
  organizationId: string,
  options: BrandReviewOptions,
): BrandReviewPage {
  const page = options.page ?? 1;
  const pageSize = options.pageSize ?? 50;
  const operator =
    options.titleMatch === 'startsWith' ? `${options.title ?? ''}%` : `%${options.title ?? ''}%`;
  const where = options.title
    ? 'WHERE organization_id = ? AND LOWER(name) LIKE LOWER(?)'
    : 'WHERE organization_id = ?';
  const values = options.title ? [organizationId, operator] : [organizationId];
  const totalItems = Number(
    (
      db.prepare(`SELECT COUNT(*) AS count FROM products ${where}`).get(...values) as {
        count: number;
      }
    ).count,
  );
  const direction = options.sort === 'titleDesc' ? 'DESC' : 'ASC';
  const rows = db
    .prepare(
      `SELECT id, sku, barcode, name FROM products ${where}
       ORDER BY name COLLATE NOCASE ${direction}, id ASC LIMIT ? OFFSET ?`,
    )
    .all(...values, pageSize, (page - 1) * pageSize) as Array<Record<string, unknown>>;
  return {
    items: rows.map((row) => ({
      productId: Number(row.id),
      sku: String(row.sku),
      barcode: String(row.barcode),
      productName: String(row.name),
      brand: null,
    })),
    page,
    pageSize,
    totalItems,
    totalPages: Math.ceil(totalItems / pageSize),
    nextCursor: null,
  };
}

function sqlitePolicyReview(
  db: import('better-sqlite3').Database,
  organizationId: string,
): PolicyReviewItem[] {
  const rows = db
    .prepare(
      `SELECT b.id AS brandId, b.name AS brandName,
              s.id AS supplierId, s.name AS supplierName,
              s.contact_email AS contactEmail, s.contact_phone AS contactPhone,
              s.credit_policy_note AS creditPolicyNote,
              s.policy_write_off_qty AS policyWriteOffQty,
              s.policy_credit_qty AS policyCreditQty,
              s.follow_up_days AS followUpDays,
              s.representative_name AS representativeName,
              s.representative_email AS representativeEmail,
              s.policy_updated_at AS policyUpdatedAt
       FROM brands b
       LEFT JOIN suppliers s ON s.id = b.supplier_id AND s.organization_id = b.organization_id
       WHERE b.organization_id = ?
       ORDER BY CASE WHEN s.policy_updated_at IS NULL THEN 0 ELSE 1 END,
                s.policy_updated_at ASC, b.name ASC, b.id ASC`,
    )
    .all(organizationId) as Array<Record<string, unknown>>;

  return rows.map((row) => {
    const supplier =
      row.supplierId == null
        ? null
        : {
            id: Number(row.supplierId),
            name: String(row.supplierName),
            contactEmail: (row.contactEmail as string | null) ?? null,
            contactPhone: (row.contactPhone as string | null) ?? null,
            creditPolicyNote: String(row.creditPolicyNote ?? ''),
            policyWriteOffQty: row.policyWriteOffQty == null ? null : Number(row.policyWriteOffQty),
            policyCreditQty: row.policyCreditQty == null ? null : Number(row.policyCreditQty),
            followUpDays: Number(row.followUpDays ?? 7),
            representativeName: (row.representativeName as string | null) ?? null,
            representativeEmail: (row.representativeEmail as string | null) ?? null,
            policyUpdatedAt: (row.policyUpdatedAt as string | null) ?? null,
          };
    return {
      brandId: Number(row.brandId),
      brandName: String(row.brandName),
      supplier,
      status: brandPolicyStatus(row, supplier),
      policyUpdatedAt: supplier?.policyUpdatedAt ?? null,
      representativeName: supplier?.representativeName ?? null,
    };
  });
}

describe('Worker supplier policy database and dual-backend conformance', () => {
  let harness: PgliteHarness;
  let sql: NeonQueryFunction<false, false>;
  let sqlite: import('better-sqlite3').Database;
  let userId: number;

  beforeAll(async () => {
    harness = await createPgliteHarness();
    sql = createTaggedSql(harness.pg);
    sqlHolder.current = sql;
    await sql`INSERT INTO organizations (id, name, slug)
              VALUES (${ORG}, ${'Policy Org'}, ${'policy-org'}),
                     (${OTHER_ORG}, ${'Other Org'}, ${'policy-other'})`;
    const users = await sql`INSERT INTO users (organization_id, email, username, role)
                            VALUES (${ORG}, ${'admin@example.com'}, ${'admin'}, ${'admin'})
                            RETURNING id`;
    userId = Number(users[0].id);
  }, 30_000);

  afterAll(async () => {
    sqlite?.close();
    await harness.close();
  });

  beforeEach(async () => {
    for (const table of ['catalogue_corrections', 'brands', 'suppliers', 'products']) {
      await sql([`DELETE FROM ${table}`] as unknown as TemplateStringsArray);
    }
    sqlite?.close();
    sqlite = createSqlitePolicyDb();
  });

  it('persists, lists, updates, and explicitly clears every supplier policy field', async () => {
    const db = createWorkersDatabase({ DATABASE_URL: 'postgres://test' } as never);
    const data: SupplierWriteData = {
      name: 'Supplier',
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

  it('matches SQLite/shared policy status, null-first order, and organization isolation', async () => {
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
      sqlite
        .prepare(
          `INSERT INTO suppliers
             (id, organization_id, name, credit_policy_note, policy_updated_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(id, organizationId, name, note, timestamp);
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
      sqlite
        .prepare('INSERT INTO brands (id, organization_id, name, supplier_id) VALUES (?, ?, ?, ?)')
        .run(id, organizationId, name, supplierId);
    }

    const db = createWorkersDatabase({ DATABASE_URL: 'postgres://test' } as never);
    const workerRows = await db.listPolicyReview(ORG, {});
    const sqliteRows = sqlitePolicyReview(sqlite, ORG);

    expect(workerRows).toEqual(sqliteRows);
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

  it('matches SQLite numbered title filtering, totals, page boundaries, and stable ordering', async () => {
    const rows = [
      [101, ORG, 'BAR-101', 'SKU-101', 'vitamin C'],
      [102, ORG, 'BAR-102', 'SKU-102', 'Vitamin A'],
      [103, ORG, 'BAR-103', 'SKU-103', 'Vitamin A'],
      [104, ORG, 'BAR-104', 'SKU-104', 'Zinc'],
      [105, OTHER_ORG, 'BAR-105', 'SKU-105', 'Vitamin Foreign'],
    ] as const;
    for (const [id, organizationId, barcode, sku, name] of rows) {
      await sql`INSERT INTO products (id, organization_id, barcode, sku, name, cost_price)
                VALUES (${id}, ${organizationId}, ${barcode}, ${sku}, ${name}, ${1})`;
      sqlite
        .prepare(
          'INSERT INTO products (id, organization_id, barcode, sku, name, cost_price) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(id, organizationId, barcode, sku, name, 1);
    }

    const options: BrandReviewOptions = {
      page: 1,
      pageSize: 2,
      title: 'VITAMIN',
      titleMatch: 'startsWith',
      sort: 'titleAsc',
    };
    const db = createWorkersDatabase({ DATABASE_URL: 'postgres://test' } as never);

    await expect(db.reviewBrands(ORG, options)).resolves.toEqual(
      sqliteCatalogueReview(sqlite, ORG, options),
    );
    await expect(db.reviewBrands(ORG, { ...options, page: 2 })).resolves.toEqual(
      sqliteCatalogueReview(sqlite, ORG, { ...options, page: 2 }),
    );
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
      (organization_id, barcode, sku, name, brand_id)
      VALUES (${ORG}, ${'NEW'}, ${'NEW'}, ${'New'}, ${null}),
             (${ORG}, ${'LINKED'}, ${'LINKED'}, ${'Linked'}, ${targetId}),
             (${ORG}, ${'CONFLICT'}, ${'CONFLICT'}, ${'Conflict'}, ${differentId})
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
