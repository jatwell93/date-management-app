import { createRequire } from 'node:module';
import { fileURLToPath, URL } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NeonQueryFunction } from '@neondatabase/serverless';
import { createPgliteHarness, createTaggedSql, type PgliteHarness } from './__tests__/pglite-db';
import {
  rollupClaimablePool,
  type ClaimableWriteOffRow,
  type ClaimablePoolGroup,
} from '../../shared/domain/credit-claim';

const backendRequire = createRequire(
  fileURLToPath(new URL('../../backend/package.json', import.meta.url)),
);
const SQLiteDatabase = backendRequire('better-sqlite3') as typeof import('better-sqlite3');

const sqlHolder = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('@neondatabase/serverless', () => ({
  neon: vi.fn(() => sqlHolder.current),
}));

import { createWorkersDatabase } from './database';

const ORG = 'org-a';
const OTHER_ORG = 'org-b';

// Minimal SQLite schema for the claimable-pool join. Mirrors the runtime SQLite
// migration 016 columns the query touches.
function createSqliteDb(): import('better-sqlite3').Database {
  const db = new SQLiteDatabase(':memory:');
  db.exec(`
    CREATE TABLE products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id TEXT NOT NULL,
      barcode TEXT, sku TEXT, name TEXT,
      cost_price REAL DEFAULT 0,
      supplier_id INTEGER,
      brand_id INTEGER
    );
    CREATE TABLE inventory_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id TEXT NOT NULL,
      product_id INTEGER, location_id INTEGER,
      expiry_date TEXT, status TEXT DEFAULT 'Active'
    );
    CREATE TABLE suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id TEXT NOT NULL, name TEXT,
      policy_write_off_qty INTEGER, policy_credit_qty INTEGER,
      credit_policy_note TEXT
    );
    CREATE TABLE brands (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id TEXT NOT NULL,
      name TEXT NOT NULL,
      suggested_supplier_name TEXT,
      supplier_id INTEGER,
      source TEXT NOT NULL DEFAULT 'REFERENCE'
    );
    CREATE TABLE expired_item_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id TEXT NOT NULL,
      inventory_item_id INTEGER NOT NULL,
      action TEXT NOT NULL, units_discarded INTEGER,
      credit_disposition TEXT NOT NULL DEFAULT 'PENDING'
    );
    CREATE TABLE credit_claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id TEXT NOT NULL, supplier_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT'
    );
    CREATE TABLE credit_claim_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id TEXT NOT NULL,
      claim_id INTEGER NOT NULL,
      expired_item_transaction_id INTEGER NOT NULL UNIQUE,
      units_claimed INTEGER
    );
  `);
  return db;
}

/** SQLite-side claimable pool: same join, fed to the same shared rollup. */
function sqliteClaimablePool(
  db: import('better-sqlite3').Database,
  org: string,
): ClaimablePoolGroup[] {
  const rows = db
    .prepare(
      `SELECT eit.id AS transactionId,
              s.id AS supplierId,
              s.name AS supplierName,
              s.policy_write_off_qty AS policyWriteOffQty,
              s.policy_credit_qty AS policyCreditQty,
              s.credit_policy_note AS creditPolicyNote,
              b.id AS brandId, b.name AS brandName, b.source AS brandSource,
              b.suggested_supplier_name AS suggestedSupplierName,
              bs.id AS brandSupplierId, bs.name AS brandSupplierName,
              bs.policy_write_off_qty AS brandPolicyWriteOffQty,
              bs.policy_credit_qty AS brandPolicyCreditQty,
              bs.credit_policy_note AS brandCreditPolicyNote,
              p.id AS productId,
              COALESCE(p.sku, '') AS sku,
              p.name AS productName,
              COALESCE(eit.units_discarded, 0) AS unitsDiscarded,
              COALESCE(p.cost_price, 0) AS costPrice
       FROM expired_item_transactions eit
       JOIN inventory_items ii ON ii.id = eit.inventory_item_id
       JOIN products p ON p.id = ii.product_id
       LEFT JOIN suppliers s ON s.id = p.supplier_id
       LEFT JOIN brands b ON b.id = p.brand_id AND b.organization_id = p.organization_id
       LEFT JOIN suppliers bs ON bs.id = b.supplier_id
       LEFT JOIN credit_claim_lines ccl ON ccl.expired_item_transaction_id = eit.id
       WHERE eit.organization_id = ?
         AND eit.action = 'expired'
         AND eit.credit_disposition <> 'DISPOSED'
         AND ccl.id IS NULL
       ORDER BY eit.id ASC`,
    )
    .all(org) as ClaimableWriteOffRow[];
  return rollupClaimablePool(
    rows.map((r) => ({
      ...r,
      supplierId: r.supplierId == null ? null : Number(r.supplierId),
      supplierName: r.supplierName ?? null,
    })),
  );
}

describe('dual-backend claimable-pool conformance', () => {
  let harness: PgliteHarness;
  let sql: NeonQueryFunction<false, false>;
  let sqlite: import('better-sqlite3').Database;

  beforeAll(async () => {
    harness = await createPgliteHarness();
    sql = createTaggedSql(harness.pg);
    sqlHolder.current = sql;
    await sql`INSERT INTO organizations (id, name, slug)
              VALUES (${ORG}, ${'Organization A'}, ${'organization-a'}),
                     (${OTHER_ORG}, ${'Organization B'}, ${'organization-b'})`;
  }, 30000);

  afterAll(async () => {
    sqlite?.close();
    await harness.close();
  });

  beforeEach(async () => {
    for (const table of [
      'catalogue_corrections',
      'credit_claim_lines',
      'expired_item_transactions',
      'inventory_items',
      'brands',
      'suppliers',
      'products',
    ]) {
      await sql([`DELETE FROM ${table}`] as unknown as TemplateStringsArray);
    }
    sqlite?.close();
    sqlite = createSqliteDb();
  });

  async function seed(scenario: {
    suppliers: Array<{ id: number; name: string; ratio?: [number, number] }>;
    brands?: Array<{
      id: number;
      name: string;
      suggestedSupplierName?: string;
      supplierId?: number | null;
      source?: 'REFERENCE' | 'USER_ADDED' | 'CONFIRMED';
    }>;
    products: Array<{
      id: number;
      sku: string;
      cost: number;
      supplierId: number | null;
      brandId?: number | null;
    }>;
    writeOffs: Array<{
      txId: number;
      productId: number;
      units: number;
      claimed?: boolean;
      disposed?: boolean;
      org?: string;
    }>;
  }): Promise<void> {
    for (const s of scenario.suppliers) {
      await sql`INSERT INTO suppliers (id, organization_id, name, policy_write_off_qty, policy_credit_qty)
                VALUES (${s.id}, ${ORG}, ${s.name}, ${s.ratio?.[0] ?? null}, ${s.ratio?.[1] ?? null})`;
      sqlite
        .prepare(
          'INSERT INTO suppliers (id, organization_id, name, policy_write_off_qty, policy_credit_qty) VALUES (?, ?, ?, ?, ?)',
        )
        .run(s.id, ORG, s.name, s.ratio?.[0] ?? null, s.ratio?.[1] ?? null);
    }
    for (const b of scenario.brands ?? []) {
      await sql`INSERT INTO brands (id, organization_id, name, suggested_supplier_name, supplier_id, source)
                VALUES (${b.id}, ${ORG}, ${b.name}, ${b.suggestedSupplierName ?? null}, ${b.supplierId ?? null}, ${b.source ?? 'REFERENCE'})`;
      sqlite
        .prepare(
          'INSERT INTO brands (id, organization_id, name, suggested_supplier_name, supplier_id, source) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(
          b.id,
          ORG,
          b.name,
          b.suggestedSupplierName ?? null,
          b.supplierId ?? null,
          b.source ?? 'REFERENCE',
        );
    }
    // A parent claim (id=1) for the "already claimed" write-offs to reference — the
    // pglite harness enforces the real credit_claim_lines.claim_id FK.
    if (scenario.writeOffs.some((w) => w.claimed) && scenario.suppliers[0]) {
      const supplierId = scenario.suppliers[0].id;
      await sql`INSERT INTO credit_claims (id, organization_id, supplier_id, status)
                VALUES (1, ${ORG}, ${supplierId}, ${'SENT'})`;
      sqlite
        .prepare(
          'INSERT INTO credit_claims (id, organization_id, supplier_id, status) VALUES (?, ?, ?, ?)',
        )
        .run(1, ORG, supplierId, 'SENT');
    }
    for (const p of scenario.products) {
      await sql`INSERT INTO products (id, organization_id, barcode, sku, name, cost_price, supplier_id, brand_id)
                VALUES (${p.id}, ${ORG}, ${p.sku}, ${p.sku}, ${'Item ' + p.sku}, ${p.cost}, ${p.supplierId}, ${p.brandId ?? null})`;
      sqlite
        .prepare(
          'INSERT INTO products (id, organization_id, barcode, sku, name, cost_price, supplier_id, brand_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(p.id, ORG, p.sku, p.sku, `Item ${p.sku}`, p.cost, p.supplierId, p.brandId ?? null);
    }
    for (const w of scenario.writeOffs) {
      const org = w.org ?? ORG;
      await sql`INSERT INTO inventory_items (id, organization_id, product_id, location_id, status)
                VALUES (${w.txId}, ${org}, ${w.productId}, 1, ${'Expired'})`;
      await sql`INSERT INTO expired_item_transactions (id, organization_id, inventory_item_id, action, units_discarded, credit_disposition)
                VALUES (${w.txId}, ${org}, ${w.txId}, ${'expired'}, ${w.units}, ${w.disposed ? 'DISPOSED' : 'PENDING'})`;
      sqlite
        .prepare(
          'INSERT INTO inventory_items (id, organization_id, product_id, location_id, status) VALUES (?, ?, ?, ?, ?)',
        )
        .run(w.txId, org, w.productId, 1, 'Expired');
      sqlite
        .prepare(
          'INSERT INTO expired_item_transactions (id, organization_id, inventory_item_id, action, units_discarded, credit_disposition) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(w.txId, org, w.txId, 'expired', w.units, w.disposed ? 'DISPOSED' : 'PENDING');
      if (w.claimed) {
        await sql`INSERT INTO credit_claim_lines (organization_id, claim_id, expired_item_transaction_id, units_claimed)
                  VALUES (${org}, 1, ${w.txId}, ${w.units})`;
        sqlite
          .prepare(
            'INSERT INTO credit_claim_lines (organization_id, claim_id, expired_item_transaction_id, units_claimed) VALUES (?, ?, ?, ?)',
          )
          .run(org, 1, w.txId, w.units);
      }
    }
  }

  it('groups identically across Neon/pglite and SQLite, including order and totals', async () => {
    await seed({
      suppliers: [
        { id: 10, name: 'Blackmores', ratio: [3, 1] },
        { id: 20, name: 'Nature’s Own', ratio: [2, 1] },
      ],
      products: [
        { id: 100, sku: 'BM-1', cost: 10, supplierId: 10 },
        { id: 200, sku: 'NO-1', cost: 5, supplierId: 20 },
        { id: 300, sku: 'X-1', cost: 8, supplierId: null }, // needs-supplier bucket
      ],
      writeOffs: [
        { txId: 1, productId: 100, units: 6 },
        { txId: 2, productId: 200, units: 4 },
        { txId: 3, productId: 300, units: 2 },
        { txId: 4, productId: 100, units: 3, claimed: true }, // excluded (already claimed)
      ],
    });

    const workersDb = createWorkersDatabase({ NEON_CONNECTION_STRING: 'postgres://x' } as never);
    const workersResult = await workersDb.getClaimablePool(ORG);
    const sqliteResult = sqliteClaimablePool(sqlite, ORG);

    expect(workersResult).toEqual(sqliteResult);
    // Sanity: real suppliers by name first, needs-supplier last; claimed row excluded.
    expect(workersResult.map((g) => g.supplierName)).toEqual(['Blackmores', 'Nature’s Own', null]);
    expect(workersResult[0].expectedCreditValueTotal).toBe(20); // floor(6/3)*1 * $10
  });

  it('excludes other organizations from the pool', async () => {
    await seed({
      suppliers: [{ id: 10, name: 'Blackmores', ratio: [3, 1] }],
      products: [{ id: 100, sku: 'BM-1', cost: 10, supplierId: 10 }],
      writeOffs: [{ txId: 1, productId: 100, units: 6, org: OTHER_ORG }],
    });

    const workersDb = createWorkersDatabase({ NEON_CONNECTION_STRING: 'postgres://x' } as never);
    expect(await workersDb.getClaimablePool(ORG)).toEqual(sqliteClaimablePool(sqlite, ORG));
    expect(await workersDb.getClaimablePool(ORG)).toEqual([]);
  });

  it('resolves confirmed brands, preserves product overrides, and excludes disposed rows', async () => {
    await seed({
      suppliers: [
        { id: 10, name: 'Brand Supplier' },
        { id: 20, name: 'Override Supplier', ratio: [2, 1] },
      ],
      brands: [
        { id: 30, name: 'Confirmed Brand', supplierId: 10, source: 'CONFIRMED' },
        {
          id: 40,
          name: 'Reference Brand',
          suggestedSupplierName: 'Suggested Maker',
          source: 'REFERENCE',
        },
      ],
      products: [
        { id: 100, sku: 'BRAND', cost: 10, supplierId: null, brandId: 30 },
        { id: 200, sku: 'OVERRIDE', cost: 8, supplierId: 20, brandId: 30 },
        { id: 300, sku: 'PENDING', cost: 4, supplierId: null, brandId: 40 },
        { id: 400, sku: 'DISPOSED', cost: 2, supplierId: null },
      ],
      writeOffs: [
        { txId: 1, productId: 100, units: 1 },
        { txId: 2, productId: 200, units: 2 },
        { txId: 3, productId: 300, units: 1 },
        { txId: 4, productId: 400, units: 1, disposed: true },
      ],
    });

    const workersDb = createWorkersDatabase({ NEON_CONNECTION_STRING: 'postgres://x' } as never);
    const workersResult = await workersDb.getClaimablePool(ORG);
    expect(workersResult).toEqual(sqliteClaimablePool(sqlite, ORG));
    expect(workersResult.map((group) => group.state)).toEqual([
      'NO_POLICY',
      'CLAIMABLE',
      'PENDING_CONFIRMATION',
    ]);
    expect(workersResult.flatMap((group) => group.items.map((item) => item.sku))).not.toContain(
      'DISPOSED',
    );
  });

  it('returns the Express-compatible organization shape for central corrections', async () => {
    await sql`
      INSERT INTO catalogue_corrections (organization_id, barcode, kind, status)
      VALUES (${ORG}, ${'9300000000001'}, ${'UNMATCHED'}, ${'PENDING'})
    `;
    const workersDb = createWorkersDatabase({ NEON_CONNECTION_STRING: 'postgres://x' } as never);

    const result = await workersDb.listCatalogueCorrections({ status: 'PENDING', limit: 50 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      organizationId: ORG,
      organization: { id: ORG, name: 'Organization A' },
    });
  });

  it('makes platform correction decisions terminal and distinguishes missing rows', async () => {
    const inserted = await sql`
      INSERT INTO catalogue_corrections (organization_id, kind, status)
      VALUES (${ORG}, ${'UNMATCHED'}, ${'PENDING'})
      RETURNING id
    `;
    const id = Number(inserted[0].id);
    const workersDb = createWorkersDatabase({ NEON_CONNECTION_STRING: 'postgres://x' } as never);

    await expect(workersDb.reviewCatalogueCorrection(id, 'ACCEPTED')).resolves.toBe('UPDATED');
    await expect(workersDb.reviewCatalogueCorrection(id, 'REJECTED')).resolves.toBe(
      'ALREADY_REVIEWED',
    );
    await expect(workersDb.reviewCatalogueCorrection(999999, 'REJECTED')).resolves.toBe(
      'NOT_FOUND',
    );
    const stored = await sql`SELECT status FROM catalogue_corrections WHERE id = ${id}`;
    expect(stored[0].status).toBe('ACCEPTED');
  });
});
