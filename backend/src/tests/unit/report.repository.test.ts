import { ReportRepository } from '../../repositories/report.repository';
import Database from 'better-sqlite3';

describe('ReportRepository', () => {
  let db: Database.Database;

  const sqliteDate = (modifier: string): string => {
    const row = db.prepare("SELECT date('now', ?) as value").get(modifier) as { value: string };
    return row.value;
  };

  const insertInventoryItem = (expiryDate: string, status = 'Normal') => {
    db.prepare(
      'INSERT INTO inventory_items (product_id, expiry_date, location_id, status, organization_id) VALUES (1, ?, 1, ?, ?)',
    ).run(expiryDate, status, 'test-org');
  };

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE inventory_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        expiry_date TEXT,
        location_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'Normal',
        organization_id TEXT NOT NULL DEFAULT 'test-org',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE expired_item_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        organization_id TEXT NOT NULL DEFAULT 'test-org',
        inventory_item_id INTEGER NOT NULL,
        user_id INTEGER,
        action TEXT NOT NULL,
        units_discarded INTEGER,
        financial_loss REAL,
        markdown_level INTEGER,
        transaction_date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        organization_id TEXT NOT NULL DEFAULT 'test-org',
        name TEXT NOT NULL DEFAULT 'Test product',
        sku TEXT,
        cost_price REAL,
        retail_price REAL,
        supplier_id INTEGER,
        brand_id INTEGER
      );
      CREATE TABLE suppliers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        organization_id TEXT NOT NULL,
        name TEXT NOT NULL,
        credit_policy_note TEXT NOT NULL DEFAULT '',
        credit_type TEXT NOT NULL DEFAULT 'NONE'
      );
      CREATE TABLE brands (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        organization_id TEXT NOT NULL,
        name TEXT NOT NULL,
        source TEXT NOT NULL,
        suggested_supplier_name TEXT,
        supplier_id INTEGER
      );
      CREATE TABLE store_areas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL DEFAULT 'Aisle',
        sub_department TEXT
      );
      INSERT INTO products (id, name, sku, cost_price, retail_price) VALUES (1, 'Test product', 'SKU1', 10, 25);
      INSERT INTO store_areas (id, name, sub_department) VALUES (1, 'Aisle 1', 'Dairy');
    `);
  });

  it('projects credit context for direct and reference-brand suppliers without changing row order', () => {
    db.exec(`
      INSERT INTO suppliers (id, organization_id, name, credit_policy_note, credit_type)
        VALUES (10, 'test-org', 'Direct Full', 'Return monthly', 'FULL_CREDIT'),
               (20, 'test-org', 'Suggested Full', 'Return monthly', 'FULL_CREDIT'),
               (30, 'other-org', 'Cross Tenant', 'Return monthly', 'FULL_CREDIT');
      INSERT INTO brands (id, organization_id, name, source, supplier_id)
        VALUES (1, 'test-org', 'Reference Brand', 'REFERENCE', 20);
      UPDATE products SET supplier_id = 10 WHERE id = 1;
      INSERT INTO products
        (id, organization_id, name, sku, cost_price, retail_price, supplier_id, brand_id)
        VALUES (2, 'test-org', 'Reference Product', 'SKU2', 10, 20, NULL, 1),
               (3, 'test-org', 'Malformed Product', 'SKU3', 10, 20, 30, NULL);
      INSERT INTO inventory_items
        (product_id, expiry_date, location_id, status, organization_id)
        VALUES (1, date('now', '+10 days'), 1, 'Normal', 'test-org'),
               (2, date('now', '+11 days'), 1, 'Normal', 'test-org'),
               (3, date('now', '+12 days'), 1, 'Normal', 'test-org');
    `);

    const rows = new ReportRepository(db, 'test-org').getDetailedExpiryReport();

    expect(rows.map((row) => row.productId)).toEqual([1, 2, 3]);
    expect(rows[0]).toMatchObject({
      creditScope: 'FULL_CREDIT',
      creditScopeReason: 'FULL_CREDIT',
      creditSupplierId: 10,
      creditSupplierName: 'Direct Full',
    });
    expect(rows[1]).toMatchObject({
      creditScope: 'NO_CREDIT',
      creditScopeReason: 'PENDING_CONFIRMATION',
      creditSupplierId: 20,
    });
    expect(rows[2]).toMatchObject({
      creditScope: 'NO_CREDIT',
      creditScopeReason: 'NEEDS_BRAND',
      creditSupplierId: null,
    });
  });

  afterEach(() => {
    db.close();
  });

  it('returns dashboard summary data from the expected query sequence', () => {
    const totalProductsStatement = { get: vi.fn().mockReturnValue({ count: 100 }) };
    const expiringSoonStatement = { get: vi.fn().mockReturnValue({ count: 10 }) };
    const markdownItemsStatement = { get: vi.fn().mockReturnValue({ count: 5 }) };
    const recentActivity = [
      { id: 1, description: 'Created product', timestamp: '2026-05-01T00:00:00.000Z' },
    ];
    const recentActivityStatement = { all: vi.fn().mockReturnValue(recentActivity) };
    const db = {
      prepare: vi
        .fn()
        .mockReturnValueOnce(totalProductsStatement)
        .mockReturnValueOnce(expiringSoonStatement)
        .mockReturnValueOnce(markdownItemsStatement)
        .mockReturnValueOnce(recentActivityStatement),
    };

    const repository = new ReportRepository(db as never, 'test-org');

    expect(repository.getDashboardData()).toEqual({
      totalProducts: 100,
      expiringSoon: 10,
      markdownItems: 5,
      recentActivity,
    });
    expect(db.prepare).toHaveBeenCalledTimes(4);
    expect(totalProductsStatement.get).toHaveBeenCalledTimes(1);
    expect(expiringSoonStatement.get).toHaveBeenCalledTimes(1);
    expect(markdownItemsStatement.get).toHaveBeenCalledTimes(1);
    expect(recentActivityStatement.all).toHaveBeenCalledTimes(1);
  });

  it('calculates monthly markdown buckets from expiry date windows instead of stored status', () => {
    const repository = new ReportRepository(db, 'test-org');

    insertInventoryItem(sqliteDate('-1 day'), 'Markdown 1');
    insertInventoryItem(sqliteDate('+10 days'), 'Normal');
    insertInventoryItem(sqliteDate('+45 days'), 'Normal');
    insertInventoryItem(sqliteDate('+75 days'), 'Expired');
    insertInventoryItem(sqliteDate('+100 days'), 'Markdown 3');
    insertInventoryItem(sqliteDate('+140 days'), 'Markdown 2');

    const report = repository.getMonthlyExpiryReport();

    const tenDayMonth = sqliteDate('+10 days').slice(0, 7);
    const fortyFiveDayMonth = sqliteDate('+45 days').slice(0, 7);
    const seventyFiveDayMonth = sqliteDate('+75 days').slice(0, 7);
    const monthWithTenDayItem = report.find((row) => row.month === tenDayMonth);
    const monthWithFortyFiveDayItem = report.find((row) => row.month === fortyFiveDayMonth);
    const monthWithSeventyFiveDayItem = report.find((row) => row.month === seventyFiveDayMonth);

    expect(monthWithTenDayItem?.markdown3_count).toBeGreaterThanOrEqual(1);
    expect(monthWithFortyFiveDayItem?.markdown2_count).toBeGreaterThanOrEqual(1);
    expect(monthWithSeventyFiveDayItem?.markdown1_count).toBeGreaterThanOrEqual(1);
    expect(report.reduce((sum, row) => sum + row.total_markdown, 0)).toBe(3);
  });

  it('returns expiry action summary counts for future stock and next-month markdown review', () => {
    const repository = new ReportRepository(db, 'test-org');

    insertInventoryItem(sqliteDate('-1 day'), 'Normal');
    insertInventoryItem(sqliteDate('+10 days'), 'Expired');
    insertInventoryItem(sqliteDate('+45 days'), 'Normal');
    insertInventoryItem(sqliteDate('+75 days'), 'Normal');
    insertInventoryItem(sqliteDate('+100 days'), 'Normal');
    insertInventoryItem(sqliteDate('+120 days'), 'Normal');
    insertInventoryItem(sqliteDate('+121 days'), 'Normal');
    insertInventoryItem(sqliteDate('+140 days'), 'Normal');

    const report = repository.getOverallExpiryReport();

    expect(report.expired_count).toBe(1);
    expect(report.expiry_risk_count).toBe(1);
    expect(report.next_month_markdown_count).toBe(2);
    expect(report.active_expiry_stock_count).toBe(7);
  });

  it('aggregates sell-through counts by markdown level for the organization', () => {
    const repository = new ReportRepository(db, 'test-org');

    const insertSoldThrough = (markdownLevel: number | null, org = 'test-org') => {
      db.prepare(
        "INSERT INTO expired_item_transactions (organization_id, inventory_item_id, action, markdown_level) VALUES (?, 1, 'sold_through', ?)",
      ).run(org, markdownLevel);
    };

    insertSoldThrough(3);
    insertSoldThrough(3);
    insertSoldThrough(2);
    insertSoldThrough(1);
    insertSoldThrough(3, 'other-org'); // excluded by org scoping
    // A write-off must not be counted as sell-through.
    db.prepare(
      "INSERT INTO expired_item_transactions (organization_id, inventory_item_id, action, markdown_level) VALUES ('test-org', 1, 'expired', NULL)",
    ).run();

    const rows = repository.getSellThroughByMarkdownLevel();
    const byLevel = new Map(rows.map((row) => [row.markdownLevel, row.soldCount]));

    expect(byLevel.get(3)).toBe(2);
    expect(byLevel.get(2)).toBe(1);
    expect(byLevel.get(1)).toBe(1);
    expect(rows.reduce((sum, row) => sum + row.soldCount, 0)).toBe(4);
  });

  it('excludes sold-through stock from the detailed worklist but keeps urgent day-0 items', () => {
    const repository = new ReportRepository(db, 'test-org');

    // Active item within the worklist window — should appear.
    insertInventoryItem(sqliteDate('+20 days'), 'Normal');
    // Same window but already sold through (SQLite backend marks status 'Processed') —
    // must NOT reappear after refresh.
    insertInventoryItem(sqliteDate('+20 days'), 'Processed');
    // Defensive: the workers backend marks sold-through as 'Sold Through'.
    insertInventoryItem(sqliteDate('+20 days'), 'Sold Through');
    // A day-0 item carrying computed 'Expired' status is the most urgent worklist
    // entry and must still be surfaced (not treated as a write-off).
    insertInventoryItem(sqliteDate('+0 days'), 'Expired');

    const report = repository.getDetailedExpiryReport();
    const statuses = report.map((row) => row.status);

    expect(report).toHaveLength(2);
    expect(statuses).toContain('Normal');
    expect(statuses).toContain('Expired');
    expect(statuses).not.toContain('Processed');
    expect(statuses).not.toContain('Sold Through');
    // Retail price travels with each row so retail-basis markdown bands (#338) can
    // price the item client-side without a second product lookup.
    expect(report.every((row) => row.retailPrice === 25)).toBe(true);
  });

  it('returns all active entries beyond 90 days but excludes past-expiry and dispositioned stock', () => {
    const repository = new ReportRepository(db, 'test-org');

    // Within the 90-day worklist window.
    insertInventoryItem(sqliteDate('+20 days'), 'Normal');
    // Far-future item — invisible to the 90-day worklist, but the whole point of
    // this view (e.g. a fat-finger year like 2666).
    insertInventoryItem(sqliteDate('+400 days'), 'Normal');
    // Excluded: already dispositioned.
    insertInventoryItem(sqliteDate('+30 days'), 'Processed');
    insertInventoryItem(sqliteDate('+30 days'), 'Sold Through');
    // Excluded: already past expiry (belongs on the Expired Items page).
    insertInventoryItem(sqliteDate('-1 day'), 'Normal');

    const worklist = repository.getDetailedExpiryReport();
    const active = repository.getActiveExpiryEntries();

    // The 90-day worklist only sees the +20d item; the active view also sees +400d.
    expect(worklist).toHaveLength(1);
    expect(active).toHaveLength(2);
    expect(active.map((row) => row.status)).not.toContain('Processed');
    expect(active.map((row) => row.status)).not.toContain('Sold Through');
  });

  it('values past-expiry stock by date (not just Expired status) for loss-by-sku/department', () => {
    const repository = new ReportRepository(db, 'test-org');

    // Counted: an explicitly-'Expired' unit and a past-expiry 'Normal' unit. The
    // 'Normal' case is the one that previously went uncounted — the Workers scan
    // path stores items as 'Normal' and never recomputes status, so a status-only
    // filter left the loss graphs empty on Neon. See #268.
    insertInventoryItem(sqliteDate('-1 day'), 'Expired');
    insertInventoryItem(sqliteDate('-1 day'), 'Normal');
    // Excluded: already dispositioned, and a future-dated (not yet expired) unit.
    insertInventoryItem(sqliteDate('-1 day'), 'Processed');
    insertInventoryItem(sqliteDate('+5 days'), 'Normal');

    // Two units of SKU1 @ cost 10 in the Dairy sub-department.
    expect(repository.getLossBySkuReport()).toEqual([
      { sku: 'SKU1', productName: 'Test product', totalLoss: 20, count: 2 },
    ]);
    expect(repository.getLossByDepartmentReport()).toEqual([
      { department: 'Dairy', totalLoss: 20, count: 2 },
    ]);
  });

  it('caps loss-by-sku/department at the top 5 sources of loss, ordered by value', () => {
    const repository = new ReportRepository(db, 'test-org');
    const yesterday = sqliteDate('-1 day');

    // Six distinct SKUs, each in its own sub-department, with ascending cost so
    // the ranking is unambiguous. The cheapest (SKU_1 / Dept_1) must be dropped
    // once we cap at five.
    for (let i = 1; i <= 6; i++) {
      db.prepare('INSERT INTO products (id, name, sku, cost_price) VALUES (?, ?, ?, ?)').run(
        100 + i,
        `Product ${i}`,
        `SKU_${i}`,
        i,
      );
      db.prepare('INSERT INTO store_areas (id, name, sub_department) VALUES (?, ?, ?)').run(
        100 + i,
        `Aisle ${i}`,
        `Dept_${i}`,
      );
      db.prepare(
        'INSERT INTO inventory_items (product_id, expiry_date, location_id, status, organization_id) VALUES (?, ?, ?, ?, ?)',
      ).run(100 + i, yesterday, 100 + i, 'Normal', 'test-org');
    }

    const skuReport = repository.getLossBySkuReport();
    expect(skuReport).toHaveLength(5);
    expect(skuReport.map((row) => row.sku)).toEqual(['SKU_6', 'SKU_5', 'SKU_4', 'SKU_3', 'SKU_2']);

    const deptReport = repository.getLossByDepartmentReport();
    expect(deptReport).toHaveLength(5);
    expect(deptReport.map((row) => row.department)).toEqual([
      'Dept_6',
      'Dept_5',
      'Dept_4',
      'Dept_3',
      'Dept_2',
    ]);
  });
});
