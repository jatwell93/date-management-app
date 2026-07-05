import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NeonQueryFunction } from '@neondatabase/serverless';
import type { Env } from './types/env';
import { createPgliteHarness, createTaggedSql, type PgliteHarness } from './__tests__/pglite-db';
import { DISPOSITIONED_STATUSES } from '../../shared/domain/disposition';
import { MARKDOWN_WINDOWS } from '../../shared/domain/markdown';
import { ReportRepository } from '../../backend/src/repositories/report.repository';

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
const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface SeededItem {
  offsetDays: number;
  sku: string;
  status?: string;
  org?: string;
}

function createSqliteDb(): import('better-sqlite3').Database {
  const db = new SQLiteDatabase(':memory:');
  db.exec(`
    CREATE TABLE products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id TEXT NOT NULL,
      barcode TEXT NOT NULL,
      sku TEXT NOT NULL,
      name TEXT NOT NULL,
      cost_price REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE store_areas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id TEXT NOT NULL,
      name TEXT NOT NULL,
      sub_department TEXT
    );
    CREATE TABLE inventory_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id TEXT NOT NULL,
      product_id INTEGER NOT NULL,
      location_id INTEGER NOT NULL,
      expiry_date TEXT,
      status TEXT NOT NULL DEFAULT 'Active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE expired_item_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id TEXT NOT NULL,
      inventory_item_id INTEGER NOT NULL,
      user_id INTEGER,
      action TEXT NOT NULL,
      units_discarded INTEGER,
      financial_loss REAL,
      markdown_level INTEGER,
      transaction_date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

function expiryDateForOffset(offsetDays: number): string {
  const now = new Date();
  const baseUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(baseUtc + offsetDays * MS_PER_DAY).toISOString().slice(0, 10);
}

function normalizeDetailedRows(
  rows: Awaited<ReturnType<ReportRepository['getDetailedExpiryReport']>>,
) {
  return rows.map((row) => ({
    expiryDate: row.expiryDate.slice(0, 10),
    status: row.status,
    sku: row.sku,
    subDepartment: row.subDepartment ?? '',
  }));
}

function normalizeSummary(report: Awaited<ReturnType<ReportRepository['getOverallExpiryReport']>>) {
  return {
    total_expiring: Number(report.total_expiring),
    expired_count: Number(report.expired_count),
    markdown1_count: Number(report.markdown1_count),
    markdown2_count: Number(report.markdown2_count),
    markdown3_count: Number(report.markdown3_count),
    total_markdown: Number(report.total_markdown),
    expiry_risk_count: Number(report.expiry_risk_count),
    next_month_markdown_count: Number(report.next_month_markdown_count),
    active_expiry_stock_count: Number(report.active_expiry_stock_count),
  };
}

function normalizeSellThrough(
  rows: Awaited<ReturnType<ReportRepository['getSellThroughByMarkdownLevel']>>,
) {
  return rows.map((row) => ({
    markdownLevel: row.markdownLevel === null ? null : Number(row.markdownLevel),
    soldCount: Number(row.soldCount),
  }));
}

describe('dual-backend report conformance', () => {
  let harness: PgliteHarness;
  let sql: NeonQueryFunction<false, false>;
  let sqlite: import('better-sqlite3').Database;
  let workersLocationId: number;
  let sqliteLocationId: number;
  let sqliteProductId = 0;

  beforeAll(async () => {
    harness = await createPgliteHarness();
    sql = createTaggedSql(harness.pg);
    sqlHolder.current = sql;
  }, 30000);

  afterAll(async () => {
    sqlite?.close();
    await harness.close();
  });

  beforeEach(async () => {
    await sql`DELETE FROM expired_item_transactions`;
    await sql`DELETE FROM inventory_items`;
    await sql`DELETE FROM products`;
    await sql`DELETE FROM store_areas`;
    const areaRows = await sql`
      INSERT INTO store_areas (organization_id, name, sub_department)
      VALUES (${ORG}, ${'Aisle 1'}, ${'Dairy'})
      RETURNING id`;
    workersLocationId = Number(areaRows[0].id);

    sqlite?.close();
    sqlite = createSqliteDb();
    const sqliteArea = sqlite
      .prepare('INSERT INTO store_areas (organization_id, name, sub_department) VALUES (?, ?, ?)')
      .run(ORG, 'Aisle 1', 'Dairy');
    sqliteLocationId = Number(sqliteArea.lastInsertRowid);
  });

  async function seedItem(seed: SeededItem): Promise<void> {
    const org = seed.org ?? ORG;
    const status = seed.status ?? 'Active';
    const expiryDate = expiryDateForOffset(seed.offsetDays);
    const productRows = await sql`
      INSERT INTO products (organization_id, barcode, sku, name, cost_price)
      VALUES (${org}, ${seed.sku}, ${seed.sku}, ${'Item ' + seed.sku}, 10)
      RETURNING id`;
    await sql`
      INSERT INTO inventory_items (organization_id, product_id, location_id, expiry_date, status)
      VALUES (
        ${org},
        ${Number(productRows[0].id)},
        ${workersLocationId},
        ${expiryDate}::date,
        ${status}
      )`;

    const product = sqlite
      .prepare(
        'INSERT INTO products (organization_id, barcode, sku, name, cost_price) VALUES (?, ?, ?, ?, ?)',
      )
      .run(org, seed.sku, seed.sku, `Item ${seed.sku}`, 10);
    sqliteProductId = Number(product.lastInsertRowid);
    sqlite
      .prepare(
        'INSERT INTO inventory_items (organization_id, product_id, location_id, expiry_date, status) VALUES (?, ?, ?, ?, ?)',
      )
      .run(org, sqliteProductId, sqliteLocationId, expiryDate, status);
  }

  function seedSoldThrough(markdownLevel: number | null, org = ORG): void {
    sqlite
      .prepare(
        "INSERT INTO expired_item_transactions (organization_id, inventory_item_id, action, markdown_level) VALUES (?, 1, 'sold_through', ?)",
      )
      .run(org, markdownLevel);
  }

  async function seedWorkersSoldThrough(markdownLevel: number | null, org = ORG): Promise<void> {
    await sql`
      INSERT INTO expired_item_transactions (organization_id, inventory_item_id, action, markdown_level)
      VALUES (${org}, 1, ${'sold_through'}, ${markdownLevel})`;
  }

  it('documents the shared domain constants used by both backends', () => {
    expect(DISPOSITIONED_STATUSES).toEqual(['Processed', 'Sold Through']);
    expect(MARKDOWN_WINDOWS).toMatchObject({
      markdown1: { level: 1, minDays: 61, maxDays: 90 },
      markdown2: { level: 2, minDays: 31, maxDays: 60 },
      markdown3: { level: 3, minDays: 0, maxDays: 30 },
      nextMonthMarkdown: { minDays: 91, maxDays: 120 },
    });
  });

  it('returns identical detailed worklist rows, summary counts, and sell-through order', async () => {
    const seeds: SeededItem[] = [
      { offsetDays: -1, sku: 'EXPIRED-PAST' },
      { offsetDays: 10, sku: 'URGENT', status: 'Expired' },
      { offsetDays: 20, sku: 'M3' },
      // Two items sharing an expiry_date: exercises the ii.id tiebreaker so the
      // engines cannot order ties differently (the NULLS/ordering drift class).
      { offsetDays: 15, sku: 'TIE-B' },
      { offsetDays: 15, sku: 'TIE-A' },
      { offsetDays: 45, sku: 'M2' },
      { offsetDays: 75, sku: 'M1' },
      { offsetDays: 100, sku: 'NEXT' },
      { offsetDays: 140, sku: 'FUTURE' },
      { offsetDays: 25, sku: 'SQLITE-SOLD', status: 'Processed' },
      { offsetDays: 25, sku: 'WORKERS-SOLD', status: 'Sold Through' },
      { offsetDays: 25, sku: 'OTHER-ORG', org: OTHER_ORG },
    ];
    for (const seed of seeds) await seedItem(seed);
    for (const level of [1, 2, 3, 3, null]) {
      seedSoldThrough(level);
      await seedWorkersSoldThrough(level);
    }
    seedSoldThrough(3, OTHER_ORG);
    await seedWorkersSoldThrough(3, OTHER_ORG);

    const workersDb = createWorkersDatabase({ NEON_CONNECTION_STRING: 'postgres://test' } as Env);
    const sqliteRepo = new ReportRepository(sqlite, ORG);

    await expect(
      workersDb.getDetailedExpiryReport(ORG).then(normalizeDetailedRows),
    ).resolves.toEqual(normalizeDetailedRows(sqliteRepo.getDetailedExpiryReport()));
    // Unlike the 90-day worklist, active entries include far-future items
    // (offsets 100 and 140 above) — both backends must return the same set.
    await expect(
      workersDb.getActiveExpiryEntries(ORG).then(normalizeDetailedRows),
    ).resolves.toEqual(normalizeDetailedRows(sqliteRepo.getActiveExpiryEntries()));
    await expect(workersDb.getOverallExpiryReport(ORG).then(normalizeSummary)).resolves.toEqual(
      normalizeSummary(sqliteRepo.getOverallExpiryReport()),
    );
    await expect(
      workersDb.getSellThroughByMarkdownLevel(ORG).then(normalizeSellThrough),
    ).resolves.toEqual(normalizeSellThrough(sqliteRepo.getSellThroughByMarkdownLevel()));
  });
});
