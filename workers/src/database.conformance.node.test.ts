import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NeonQueryFunction } from '@neondatabase/serverless';
import type { Env } from './types/env';
import { createPgliteHarness, createTaggedSql, type PgliteHarness } from './__tests__/pglite-db';
import { DISPOSITIONED_STATUSES } from '../../shared/domain/disposition';
import { MARKDOWN_WINDOWS } from '../../shared/domain/markdown';
import { ReportRepository } from '../../backend/src/repositories/report.repository';
import type { FloorProgress } from '../../backend/src/models/store-area.model';

const backendRequire = createRequire(
  fileURLToPath(new URL('../../backend/package.json', import.meta.url)),
);
backendRequire('reflect-metadata');
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
      cost_price REAL NOT NULL DEFAULT 0,
      retail_price REAL
    );
    CREATE TABLE store_areas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id TEXT NOT NULL,
      parent_id INTEGER,
      name TEXT NOT NULL,
      sub_department TEXT,
      last_checked TEXT
    );
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id TEXT NOT NULL,
      email TEXT,
      username TEXT,
      pin TEXT,
      role TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE check_cycles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE bay_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id TEXT NOT NULL,
      cycle_id INTEGER NOT NULL,
      store_area_id INTEGER NOT NULL,
      user_id INTEGER,
      checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      items_added_count INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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

function toSqliteStatement(strings: TemplateStringsArray, values: unknown[]) {
  let text = '';
  strings.forEach((chunk, index) => {
    text += chunk;
    if (index < values.length) {
      text += '?';
    }
  });
  return text;
}

function createSqlitePrismaAdapter(db: import('better-sqlite3').Database) {
  const runRaw = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = toSqliteStatement(strings, values);
    return db.prepare(text).all(...values);
  };

  return {
    $queryRaw: runRaw,
    $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = toSqliteStatement(strings, values);
      return db.prepare(text).run(...values).changes;
    },
  };
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
    retailPrice: row.retailPrice === null ? null : Number(row.retailPrice),
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

function normalizeFloorProgress(progress: FloorProgress) {
  return {
    activeCycle: progress.activeCycle
      ? {
          id: progress.activeCycle.id,
          name: progress.activeCycle.name,
          status: progress.activeCycle.status,
          startedAt: progress.activeCycle.startedAt,
        }
      : null,
    summary: progress.summary,
    departments: progress.departments.map((department) => ({
      department: department.department,
      summary: department.summary,
      bays: department.bays.map((bay) => ({
        id: bay.id,
        name: bay.name,
        parentId: bay.parentId,
        state: bay.state,
        checkedAt: bay.checkedAt,
        checkedBy: bay.checkedBy,
      })),
    })),
  };
}

async function seedWorkersStoreWalkFloorProgress(sql: NeonQueryFunction<false, false>) {
  await sql`DELETE FROM bay_checks`;
  await sql`DELETE FROM check_cycles`;
  await sql`DELETE FROM store_areas`;
  await sql`DELETE FROM users`;
  await sql`
    INSERT INTO organizations (id, name, slug)
    VALUES (${ORG}, ${'Conformance Org'}, ${'conformance-org'})
  `;
  await sql`
    INSERT INTO users (id, organization_id, email, username, role)
    VALUES (${7}, ${ORG}, ${'checker@example.test'}, ${'Checker One'}, ${'team_member'})
  `;
  await sql`
    INSERT INTO store_areas (id, organization_id, name, sub_department)
    VALUES
      (${10}, ${ORG}, ${'Bakery'}, ${'Bakery'}),
      (${20}, ${ORG}, ${'Dairy'}, ${'Dairy'})
  `;
  await sql`
    INSERT INTO store_areas (id, organization_id, parent_id, name, sub_department, last_checked)
    VALUES
      (${12}, ${ORG}, ${10}, ${'Bakery Bay 2'}, ${'Bakery'}, ${null}),
      (${11}, ${ORG}, ${10}, ${'Bakery Bay 1'}, ${'Bakery'}, ${'2026-07-09T07:00:00.000Z'}::timestamptz),
      (${22}, ${ORG}, ${20}, ${'Dairy Bay 2'}, ${'Dairy'}, ${'2026-07-09T09:30:00.000Z'}::timestamptz),
      (${21}, ${ORG}, ${20}, ${'Dairy Bay 1'}, ${'Dairy'}, ${'2026-07-09T06:00:00.000Z'}::timestamptz)
  `;
  await sql`
    INSERT INTO check_cycles (id, organization_id, name, status, started_at, created_at, updated_at)
    VALUES (
      ${31},
      ${ORG},
      ${'Morning walk'},
      ${'active'},
      ${'2026-07-09T08:00:00.000Z'}::timestamptz,
      ${'2026-07-09T08:00:00.000Z'}::timestamptz,
      ${'2026-07-09T08:00:00.000Z'}::timestamptz
    )
  `;
  await sql`
    INSERT INTO bay_checks (
      id, organization_id, cycle_id, store_area_id, user_id, checked_at, items_added_count
    )
    VALUES (
      ${41},
      ${ORG},
      ${31},
      ${22},
      ${7},
      ${'2026-07-09T10:00:00.000Z'}::timestamptz,
      ${2}
    )
  `;
}

function seedSqliteStoreWalkFloorProgress(sqlite: import('better-sqlite3').Database) {
  sqlite
    .prepare(
      'INSERT INTO users (id, organization_id, email, username, role) VALUES (?, ?, ?, ?, ?)',
    )
    .run(7, ORG, 'checker@example.test', 'checker-one', 'Checker One');
  sqlite
    .prepare(
      'INSERT INTO store_areas (id, organization_id, name, sub_department) VALUES (?, ?, ?, ?)',
    )
    .run(10, ORG, 'Bakery', 'Bakery');
  sqlite
    .prepare(
      'INSERT INTO store_areas (id, organization_id, name, sub_department) VALUES (?, ?, ?, ?)',
    )
    .run(20, ORG, 'Dairy', 'Dairy');

  const insertBay = sqlite.prepare(
    'INSERT INTO store_areas (id, organization_id, parent_id, name, sub_department, last_checked) VALUES (?, ?, ?, ?, ?, ?)',
  );
  insertBay.run(12, ORG, 10, 'Bakery Bay 2', 'Bakery', null);
  insertBay.run(11, ORG, 10, 'Bakery Bay 1', 'Bakery', '2026-07-09T07:00:00.000Z');
  insertBay.run(22, ORG, 20, 'Dairy Bay 2', 'Dairy', '2026-07-09T09:30:00.000Z');
  insertBay.run(21, ORG, 20, 'Dairy Bay 1', 'Dairy', '2026-07-09T06:00:00.000Z');

  sqlite
    .prepare(
      'INSERT INTO check_cycles (id, organization_id, name, status, started_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      31,
      ORG,
      'Morning walk',
      'active',
      '2026-07-09T08:00:00.000Z',
      '2026-07-09T08:00:00.000Z',
      '2026-07-09T08:00:00.000Z',
    );
  sqlite
    .prepare(
      'INSERT INTO bay_checks (id, organization_id, cycle_id, store_area_id, user_id, checked_at, items_added_count) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(41, ORG, 31, 22, 7, '2026-07-09T10:00:00.000Z', 2);
}

// Audit-report seed: two cycles (one completed, one active) and two checkers.
// Ava checks six distinct bays at a single instant with zero findings — that
// clamps elapsedHours to one minute (360 bays/hour) and trips both flags. Ben
// checks two bays 30 minutes apart with findings — a steady, unflagged pace.
// userName sources differ per backend (SQLite COALESCE(pin, role); Workers
// COALESCE(username, email)), so pin and username are seeded to the same value.
const AUDIT_BAY_IDS = [101, 102, 103, 104, 105, 106, 107, 108] as const;
const AVA_CHECKED_BAY_IDS = [101, 102, 103, 104, 105, 106] as const;

async function seedWorkersStoreWalkAudit(sql: NeonQueryFunction<false, false>) {
  await sql`DELETE FROM bay_checks`;
  await sql`DELETE FROM check_cycles`;
  await sql`DELETE FROM store_areas`;
  await sql`DELETE FROM users`;
  await sql`
    INSERT INTO organizations (id, name, slug)
    VALUES (${ORG}, ${'Conformance Org'}, ${'conformance-org'})
    ON CONFLICT (id) DO NOTHING
  `;
  await sql`
    INSERT INTO users (id, organization_id, username, role)
    VALUES
      (${51}, ${ORG}, ${'Ava Checker'}, ${'team_member'}),
      (${52}, ${ORG}, ${'Ben Checker'}, ${'team_member'})
  `;
  await sql`
    INSERT INTO store_areas (id, organization_id, name, sub_department)
    VALUES
      (${100}, ${ORG}, ${'Chilled'}, ${'Chilled'}),
      (${200}, ${ORG}, ${'Ambient'}, ${'Ambient'})
  `;
  for (const bayId of AUDIT_BAY_IDS) {
    const parentId = bayId < 105 ? 100 : 200;
    await sql`
      INSERT INTO store_areas (id, organization_id, parent_id, name, sub_department)
      VALUES (${bayId}, ${ORG}, ${parentId}, ${`Bay ${bayId}`}, ${'Chilled'})
    `;
  }
  await sql`
    INSERT INTO check_cycles (id, organization_id, name, status, started_at, completed_at)
    VALUES
      (${900}, ${ORG}, ${'Morning walk'}, ${'completed'},
        ${'2026-07-09T08:00:00.000Z'}::timestamptz, ${'2026-07-09T08:45:00.000Z'}::timestamptz),
      (${901}, ${ORG}, ${'Evening walk'}, ${'active'},
        ${'2026-07-09T09:00:00.000Z'}::timestamptz, ${null})
  `;
  for (const bayId of AVA_CHECKED_BAY_IDS) {
    await sql`
      INSERT INTO bay_checks (organization_id, cycle_id, store_area_id, user_id, checked_at, items_added_count)
      VALUES (${ORG}, ${900}, ${bayId}, ${51}, ${'2026-07-09T08:10:00.000Z'}::timestamptz, ${0})
    `;
  }
  await sql`
    INSERT INTO bay_checks (organization_id, cycle_id, store_area_id, user_id, checked_at, items_added_count)
    VALUES
      (${ORG}, ${901}, ${101}, ${52}, ${'2026-07-09T09:05:00.000Z'}::timestamptz, ${3}),
      (${ORG}, ${901}, ${102}, ${52}, ${'2026-07-09T09:35:00.000Z'}::timestamptz, ${2})
  `;
}

function seedSqliteStoreWalkAudit(sqlite: import('better-sqlite3').Database) {
  const insertUser = sqlite.prepare(
    'INSERT INTO users (id, organization_id, username, pin, role) VALUES (?, ?, ?, ?, ?)',
  );
  insertUser.run(51, ORG, 'ava', 'Ava Checker', 'team_member');
  insertUser.run(52, ORG, 'ben', 'Ben Checker', 'team_member');

  const insertDept = sqlite.prepare(
    'INSERT INTO store_areas (id, organization_id, name, sub_department) VALUES (?, ?, ?, ?)',
  );
  insertDept.run(100, ORG, 'Chilled', 'Chilled');
  insertDept.run(200, ORG, 'Ambient', 'Ambient');

  const insertBay = sqlite.prepare(
    'INSERT INTO store_areas (id, organization_id, parent_id, name, sub_department) VALUES (?, ?, ?, ?, ?)',
  );
  for (const bayId of AUDIT_BAY_IDS) {
    insertBay.run(bayId, ORG, bayId < 105 ? 100 : 200, `Bay ${bayId}`, 'Chilled');
  }

  const insertCycle = sqlite.prepare(
    'INSERT INTO check_cycles (id, organization_id, name, status, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  insertCycle.run(
    900,
    ORG,
    'Morning walk',
    'completed',
    '2026-07-09T08:00:00.000Z',
    '2026-07-09T08:45:00.000Z',
  );
  insertCycle.run(901, ORG, 'Evening walk', 'active', '2026-07-09T09:00:00.000Z', null);

  const insertCheck = sqlite.prepare(
    'INSERT INTO bay_checks (organization_id, cycle_id, store_area_id, user_id, checked_at, items_added_count) VALUES (?, ?, ?, ?, ?, ?)',
  );
  for (const bayId of AVA_CHECKED_BAY_IDS) {
    insertCheck.run(ORG, 900, bayId, 51, '2026-07-09T08:10:00.000Z', 0);
  }
  insertCheck.run(ORG, 901, 101, 52, '2026-07-09T09:05:00.000Z', 3);
  insertCheck.run(ORG, 901, 102, 52, '2026-07-09T09:35:00.000Z', 2);
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
      INSERT INTO products (organization_id, barcode, sku, name, cost_price, retail_price)
      VALUES (${org}, ${seed.sku}, ${seed.sku}, ${'Item ' + seed.sku}, 10, 18.5)
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
        'INSERT INTO products (organization_id, barcode, sku, name, cost_price, retail_price) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(org, seed.sku, seed.sku, `Item ${seed.sku}`, 10, 18.5);
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

  it('returns identical store-walk floor-progress coverage and row order', async () => {
    await seedWorkersStoreWalkFloorProgress(sql);
    seedSqliteStoreWalkFloorProgress(sqlite);
    const workersDb = createWorkersDatabase({ NEON_CONNECTION_STRING: 'postgres://test' } as Env);
    const { StoreAreaRepository } =
      await import('../../backend/src/repositories/store-area.repository');
    const sqliteRepo = new StoreAreaRepository(createSqlitePrismaAdapter(sqlite) as never);

    await expect(workersDb.getFloorProgress(ORG).then(normalizeFloorProgress)).resolves.toEqual(
      normalizeFloorProgress(await sqliteRepo.getFloorProgress(ORG)),
    );
  });

  it('returns identical store-walk audit cycles, users, and flags', async () => {
    await seedWorkersStoreWalkAudit(sql);
    seedSqliteStoreWalkAudit(sqlite);

    const workersDb = createWorkersDatabase({ NEON_CONNECTION_STRING: 'postgres://test' } as Env);
    const sqliteRepo = new ReportRepository(sqlite, ORG);

    const workersReport = await workersDb.getStoreWalkAuditReport(ORG);
    const sqliteReport = sqliteRepo.getStoreWalkAuditReport();

    expect(workersReport).toEqual(sqliteReport);

    // Cycles order by started_at DESC: the active "Evening walk" precedes the
    // completed "Morning walk". Assert the derived numbers and the unified flag
    // wording (the Workers copy previously dropped "consecutive") on both engines.
    expect(workersReport).toEqual([
      {
        cycleId: 901,
        cycleName: 'Evening walk',
        status: 'active',
        completionMinutes: null,
        users: [
          {
            userId: 52,
            userName: 'Ben Checker',
            baysChecked: 2,
            coveragePercent: 25,
            baysPerHour: 4,
          },
        ],
        flags: [],
      },
      {
        cycleId: 900,
        cycleName: 'Morning walk',
        status: 'completed',
        completionMinutes: 45,
        users: [
          {
            userId: 51,
            userName: 'Ava Checker',
            baysChecked: 6,
            coveragePercent: 75,
            baysPerHour: 360,
          },
        ],
        flags: [
          {
            type: 'implausible_pace',
            userName: 'Ava Checker',
            message: '360 bays/hour is faster than the review threshold.',
          },
          {
            type: 'all_zero_findings',
            userName: 'Ava Checker',
            message: '6 consecutive bay checks recorded zero items added.',
          },
        ],
      },
    ]);
  });
});
