import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NeonQueryFunction } from '@neondatabase/serverless';
import type { Env } from './types/env';
import { createPgliteHarness, createTaggedSql, type PgliteHarness } from './__tests__/pglite-db';
import { DISPOSITIONED_STATUSES } from '../../shared/domain/disposition';
import { MARKDOWN_WINDOWS } from '../../shared/domain/markdown';
import type { FloorProgress } from './database';

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
  creditContext?: 'DIRECT_FULL' | 'REFERENCE_FULL';
}

function expiryDateForOffset(offsetDays: number): string {
  const now = new Date();
  const baseUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(baseUtc + offsetDays * MS_PER_DAY).toISOString().slice(0, 10);
}

type DetailedExpiryRow = Awaited<
  ReturnType<ReturnType<typeof createWorkersDatabase>['getDetailedExpiryReport']>
>;

function normalizeDetailedRows(rows: DetailedExpiryRow) {
  return rows.map((row) => ({
    expiryDate: row.expiryDate.slice(0, 10),
    status: row.status,
    sku: row.sku,
    retailPrice: row.retailPrice === null ? null : Number(row.retailPrice),
    subDepartment: row.subDepartment ?? '',
    creditScope: row.creditScope,
    creditScopeReason: row.creditScopeReason,
    creditSupplierId: row.creditSupplierId,
    creditSupplierName: row.creditSupplierName,
  }));
}

function normalizeSummary(
  report: Awaited<ReturnType<ReturnType<typeof createWorkersDatabase>['getOverallExpiryReport']>>,
) {
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
  rows: Awaited<
    ReturnType<ReturnType<typeof createWorkersDatabase>['getSellThroughByMarkdownLevel']>
  >,
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
    INSERT INTO organizations (id, name, slug, updated_at)
    VALUES (${ORG}, ${'Conformance Org'}, ${'conformance-org'}, NOW())
    ON CONFLICT (id) DO NOTHING
  `;
  await sql`
    INSERT INTO users (id, organization_id, email, username, role, updated_at)
    VALUES (${7}, ${ORG}, ${'checker@example.test'}, ${'Checker One'}, ${'team_member'}, NOW())
  `;
  await sql`
    INSERT INTO store_areas (id, organization_id, name, sub_department, updated_at)
    VALUES
      (${10}, ${ORG}, ${'Bakery'}, ${'Bakery'}, NOW()),
      (${20}, ${ORG}, ${'Dairy'}, ${'Dairy'}, NOW())
  `;
  await sql`
    INSERT INTO store_areas (id, organization_id, parent_id, name, sub_department, last_checked, updated_at)
    VALUES
      (${12}, ${ORG}, ${10}, ${'Bakery Bay 2'}, ${'Bakery'}, ${null}, NOW()),
      (${11}, ${ORG}, ${10}, ${'Bakery Bay 1'}, ${'Bakery'}, ${'2026-07-09T07:00:00.000Z'}::timestamptz, NOW()),
      (${22}, ${ORG}, ${20}, ${'Dairy Bay 2'}, ${'Dairy'}, ${'2026-07-09T09:30:00.000Z'}::timestamptz, NOW()),
      (${21}, ${ORG}, ${20}, ${'Dairy Bay 1'}, ${'Dairy'}, ${'2026-07-09T06:00:00.000Z'}::timestamptz, NOW())
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

// Audit-report seed: two cycles (one completed, one active) and two checkers.
// Ava checks six distinct bays at a single instant with zero findings — that
// clamps elapsedHours to one minute (360 bays/hour) and trips both flags. Ben
// checks two bays 30 minutes apart with findings — a steady, unflagged pace.
const AUDIT_BAY_IDS = [101, 102, 103, 104, 105, 106, 107, 108] as const;
const AVA_CHECKED_BAY_IDS = [101, 102, 103, 104, 105, 106] as const;

async function seedWorkersStoreWalkAudit(sql: NeonQueryFunction<false, false>) {
  await sql`DELETE FROM bay_checks`;
  await sql`DELETE FROM check_cycles`;
  await sql`DELETE FROM store_areas`;
  await sql`DELETE FROM users`;
  await sql`
    INSERT INTO organizations (id, name, slug, updated_at)
    VALUES (${ORG}, ${'Conformance Org'}, ${'conformance-org'}, NOW())
    ON CONFLICT (id) DO NOTHING
  `;
  await sql`
    INSERT INTO users (id, organization_id, username, role, updated_at)
    VALUES
      (${51}, ${ORG}, ${'Ava Checker'}, ${'team_member'}, NOW()),
      (${52}, ${ORG}, ${'Ben Checker'}, ${'team_member'}, NOW())
  `;
  await sql`
    INSERT INTO store_areas (id, organization_id, name, sub_department, updated_at)
    VALUES
      (${100}, ${ORG}, ${'Chilled'}, ${'Chilled'}, NOW()),
      (${200}, ${ORG}, ${'Ambient'}, ${'Ambient'}, NOW())
  `;
  for (const bayId of AUDIT_BAY_IDS) {
    const parentId = bayId < 105 ? 100 : 200;
    await sql`
      INSERT INTO store_areas (id, organization_id, parent_id, name, sub_department, updated_at)
      VALUES (${bayId}, ${ORG}, ${parentId}, ${`Bay ${bayId}`}, ${'Chilled'}, NOW())
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

describe('Worker report conformance (Postgres vs shared expectations)', () => {
  let harness: PgliteHarness;
  let sql: NeonQueryFunction<false, false>;
  let workersLocationId: number;
  // Supplier ids are SERIAL-assigned; record them at seed time so the explicit
  // expectation below can name the credit supplier without hard-coding ids.
  const supplierIdsBySku = new Map<string, number>();

  beforeAll(async () => {
    harness = await createPgliteHarness();
    sql = createTaggedSql(harness.pg);
    sqlHolder.current = sql;
  }, 30000);

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    supplierIdsBySku.clear();
    await sql`
      INSERT INTO organizations (id, name, slug, updated_at)
      VALUES (${ORG}, ${'Organization A'}, ${'organization-a'}, NOW()),
             (${OTHER_ORG}, ${'Organization B'}, ${'organization-b'}, NOW())
      ON CONFLICT (id) DO NOTHING`;
    await sql`DELETE FROM expired_item_transactions`;
    await sql`DELETE FROM inventory_items`;
    await sql`DELETE FROM products`;
    await sql`DELETE FROM brands`;
    await sql`DELETE FROM suppliers`;
    await sql`DELETE FROM store_areas`;
    const areaRows = await sql`
      INSERT INTO store_areas (organization_id, name, sub_department, updated_at)
      VALUES (${ORG}, ${'Aisle 1'}, ${'Dairy'}, NOW())
      RETURNING id`;
    workersLocationId = Number(areaRows[0].id);
  });

  async function seedItem(seed: SeededItem): Promise<void> {
    const org = seed.org ?? ORG;
    const status = seed.status ?? 'Active';
    const expiryDate = expiryDateForOffset(seed.offsetDays);
    const supplierName = `Supplier ${seed.sku}`;
    let workersSupplierId: number | null = null;
    let workersBrandId: number | null = null;

    if (seed.creditContext) {
      const supplierRows = await sql`
        INSERT INTO suppliers (organization_id, name, credit_policy_note, credit_type)
        VALUES (${org}, ${supplierName}, ${'Return monthly'}, ${'FULL_CREDIT'})
        RETURNING id`;
      workersSupplierId = Number(supplierRows[0].id);
      supplierIdsBySku.set(seed.sku, workersSupplierId);
    }

    if (seed.creditContext === 'REFERENCE_FULL') {
      const brandRows = await sql`
        INSERT INTO brands (organization_id, name, supplier_id, source)
        VALUES (${org}, ${'Brand ' + seed.sku}, ${workersSupplierId}, ${'REFERENCE'})
        RETURNING id`;
      workersBrandId = Number(brandRows[0].id);
    }

    const productRows = await sql`
      INSERT INTO products (
        organization_id, barcode, sku, name, cost_price, retail_price, supplier_id, brand_id, updated_at
      )
      VALUES (
        ${org}, ${seed.sku}, ${seed.sku}, ${'Item ' + seed.sku}, 10, 18.5,
        ${seed.creditContext === 'DIRECT_FULL' ? workersSupplierId : null}, ${workersBrandId}, NOW()
      )
      RETURNING id`;
    await sql`
      INSERT INTO inventory_items (organization_id, product_id, location_id, expiry_date, status, updated_at)
      VALUES (
        ${org},
        ${Number(productRows[0].id)},
        ${workersLocationId},
        ${expiryDate}::date,
        ${status},
        NOW()
      )`;
  }

  async function seedWorkersSoldThrough(markdownLevel: number | null, org = ORG): Promise<void> {
    // expired_item_transactions.inventory_item_id is a real FK — point the
    // sold-through rows at a seeded item.
    const items =
      await sql`SELECT id FROM inventory_items WHERE organization_id = ${org} ORDER BY id LIMIT 1`;
    const inventoryItemId = Number(items[0].id);
    await sql`
      INSERT INTO expired_item_transactions (organization_id, inventory_item_id, action, markdown_level, updated_at)
      VALUES (${org}, ${inventoryItemId}, ${'sold_through'}, ${markdownLevel}, NOW())`;
  }

  it('documents the shared domain constants used by the report SQL', () => {
    expect(DISPOSITIONED_STATUSES).toEqual(['Processed', 'Sold Through']);
    expect(MARKDOWN_WINDOWS).toMatchObject({
      markdown1: { level: 1, minDays: 61, maxDays: 90 },
      markdown2: { level: 2, minDays: 31, maxDays: 60 },
      markdown3: { level: 3, minDays: 0, maxDays: 30 },
      nextMonthMarkdown: { minDays: 91, maxDays: 120 },
    });
  });

  it('returns the expected detailed worklist rows, summary counts, and sell-through order', async () => {
    const seeds: SeededItem[] = [
      { offsetDays: -1, sku: 'EXPIRED-PAST' },
      { offsetDays: 10, sku: 'URGENT', status: 'Expired' },
      { offsetDays: 20, sku: 'M3' },
      // Two items sharing an expiry_date: exercises the ii.id tiebreaker so
      // tied rows order deterministically.
      { offsetDays: 15, sku: 'TIE-B' },
      { offsetDays: 15, sku: 'TIE-A' },
      { offsetDays: 45, sku: 'M2' },
      { offsetDays: 75, sku: 'M1', creditContext: 'DIRECT_FULL' },
      { offsetDays: 76, sku: 'REFERENCE', creditContext: 'REFERENCE_FULL' },
      { offsetDays: 100, sku: 'NEXT' },
      { offsetDays: 140, sku: 'FUTURE' },
      { offsetDays: 25, sku: 'SQLITE-SOLD', status: 'Processed' },
      { offsetDays: 25, sku: 'WORKERS-SOLD', status: 'Sold Through' },
      { offsetDays: 25, sku: 'OTHER-ORG', org: OTHER_ORG },
    ];
    for (const seed of seeds) await seedItem(seed);
    for (const level of [1, 2, 3, 3, null]) {
      await seedWorkersSoldThrough(level);
    }
    await seedWorkersSoldThrough(3, OTHER_ORG);

    const workersDb = createWorkersDatabase({ NEON_CONNECTION_STRING: 'postgres://test' } as Env);

    const expectedWorklist = [
      {
        expiryDate: expiryDateForOffset(10),
        status: 'Expired',
        sku: 'URGENT',
        retailPrice: 18.5,
        subDepartment: 'Dairy',
        creditScope: 'NO_CREDIT',
        creditScopeReason: 'NEEDS_BRAND',
        creditSupplierId: null,
        creditSupplierName: null,
      },
      {
        expiryDate: expiryDateForOffset(15),
        status: 'Active',
        sku: 'TIE-B',
        retailPrice: 18.5,
        subDepartment: 'Dairy',
        creditScope: 'NO_CREDIT',
        creditScopeReason: 'NEEDS_BRAND',
        creditSupplierId: null,
        creditSupplierName: null,
      },
      {
        expiryDate: expiryDateForOffset(15),
        status: 'Active',
        sku: 'TIE-A',
        retailPrice: 18.5,
        subDepartment: 'Dairy',
        creditScope: 'NO_CREDIT',
        creditScopeReason: 'NEEDS_BRAND',
        creditSupplierId: null,
        creditSupplierName: null,
      },
      {
        expiryDate: expiryDateForOffset(20),
        status: 'Active',
        sku: 'M3',
        retailPrice: 18.5,
        subDepartment: 'Dairy',
        creditScope: 'NO_CREDIT',
        creditScopeReason: 'NEEDS_BRAND',
        creditSupplierId: null,
        creditSupplierName: null,
      },
      {
        expiryDate: expiryDateForOffset(45),
        status: 'Active',
        sku: 'M2',
        retailPrice: 18.5,
        subDepartment: 'Dairy',
        creditScope: 'NO_CREDIT',
        creditScopeReason: 'NEEDS_BRAND',
        creditSupplierId: null,
        creditSupplierName: null,
      },
      {
        expiryDate: expiryDateForOffset(75),
        status: 'Active',
        sku: 'M1',
        retailPrice: 18.5,
        subDepartment: 'Dairy',
        creditScope: 'FULL_CREDIT',
        creditScopeReason: 'FULL_CREDIT',
        creditSupplierId: supplierIdsBySku.get('M1') ?? null,
        creditSupplierName: 'Supplier M1',
      },
      {
        expiryDate: expiryDateForOffset(76),
        status: 'Active',
        sku: 'REFERENCE',
        retailPrice: 18.5,
        subDepartment: 'Dairy',
        creditScope: 'NO_CREDIT',
        creditScopeReason: 'PENDING_CONFIRMATION',
        creditSupplierId: supplierIdsBySku.get('REFERENCE') ?? null,
        creditSupplierName: 'Supplier REFERENCE',
      },
    ];

    await expect(
      workersDb.getDetailedExpiryReport(ORG).then(normalizeDetailedRows),
    ).resolves.toEqual(expectedWorklist);
    // Unlike the 90-day worklist, active entries include far-future items
    // (offsets 100 and 140 above).
    await expect(
      workersDb.getActiveExpiryEntries(ORG).then(normalizeDetailedRows),
    ).resolves.toEqual([
      ...expectedWorklist,
      {
        expiryDate: expiryDateForOffset(100),
        status: 'Active',
        sku: 'NEXT',
        retailPrice: 18.5,
        subDepartment: 'Dairy',
        creditScope: 'NO_CREDIT',
        creditScopeReason: 'NEEDS_BRAND',
        creditSupplierId: null,
        creditSupplierName: null,
      },
      {
        expiryDate: expiryDateForOffset(140),
        status: 'Active',
        sku: 'FUTURE',
        retailPrice: 18.5,
        subDepartment: 'Dairy',
        creditScope: 'NO_CREDIT',
        creditScopeReason: 'NEEDS_BRAND',
        creditSupplierId: null,
        creditSupplierName: null,
      },
    ]);
    await expect(workersDb.getOverallExpiryReport(ORG).then(normalizeSummary)).resolves.toEqual({
      total_expiring: 12,
      expired_count: 1,
      markdown1_count: 2,
      markdown2_count: 1,
      markdown3_count: 6,
      total_markdown: 9,
      expiry_risk_count: 6,
      next_month_markdown_count: 1,
      active_expiry_stock_count: 11,
    });
    await expect(
      workersDb.getSellThroughByMarkdownLevel(ORG).then(normalizeSellThrough),
    ).resolves.toEqual([
      { markdownLevel: 1, soldCount: 1 },
      { markdownLevel: 2, soldCount: 1 },
      { markdownLevel: 3, soldCount: 2 },
      { markdownLevel: null, soldCount: 1 },
    ]);
  });

  it('returns the expected store-walk floor-progress coverage and row order', async () => {
    await seedWorkersStoreWalkFloorProgress(sql);
    const workersDb = createWorkersDatabase({ NEON_CONNECTION_STRING: 'postgres://test' } as Env);

    await expect(workersDb.getFloorProgress(ORG).then(normalizeFloorProgress)).resolves.toEqual({
      activeCycle: {
        id: 31,
        name: 'Morning walk',
        status: 'active',
        startedAt: '2026-07-09T08:00:00.000Z',
      },
      summary: {
        totalBays: 4,
        checkedBays: 1,
        notCheckedBays: 1,
        overdueBays: 2,
        coveragePercent: 25,
        uncheckedBays: 3,
      },
      departments: [
        {
          department: { id: 10, name: 'Bakery' },
          summary: {
            totalBays: 2,
            checkedBays: 0,
            notCheckedBays: 1,
            overdueBays: 1,
            coveragePercent: 0,
            departmentId: 10,
            departmentName: 'Bakery',
            uncheckedBays: 2,
          },
          bays: [
            {
              id: 11,
              name: 'Bakery Bay 1',
              parentId: 10,
              state: 'overdue',
              checkedAt: '2026-07-09T07:00:00.000Z',
              checkedBy: null,
            },
            {
              id: 12,
              name: 'Bakery Bay 2',
              parentId: 10,
              state: 'not_checked',
              checkedAt: null,
              checkedBy: null,
            },
          ],
        },
        {
          department: { id: 20, name: 'Dairy' },
          summary: {
            totalBays: 2,
            checkedBays: 1,
            notCheckedBays: 0,
            overdueBays: 1,
            coveragePercent: 50,
            departmentId: 20,
            departmentName: 'Dairy',
            uncheckedBays: 1,
          },
          bays: [
            {
              id: 21,
              name: 'Dairy Bay 1',
              parentId: 20,
              state: 'overdue',
              checkedAt: '2026-07-09T06:00:00.000Z',
              checkedBy: null,
            },
            {
              id: 22,
              name: 'Dairy Bay 2',
              parentId: 20,
              state: 'checked',
              checkedAt: '2026-07-09T10:00:00.000Z',
              checkedBy: { id: 7, name: 'Checker One' },
            },
          ],
        },
      ],
    });
  });

  it('returns the expected store-walk audit cycles, users, and flags', async () => {
    await seedWorkersStoreWalkAudit(sql);

    const workersDb = createWorkersDatabase({ NEON_CONNECTION_STRING: 'postgres://test' } as Env);
    const workersReport = await workersDb.getStoreWalkAuditReport(ORG);

    // Cycles order by started_at DESC: the active "Evening walk" precedes the
    // completed "Morning walk".
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
