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
        name TEXT NOT NULL DEFAULT 'Test product',
        sku TEXT,
        cost_price REAL
      );
      CREATE TABLE store_areas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL DEFAULT 'Aisle',
        sub_department TEXT
      );
      INSERT INTO products (id, name, sku, cost_price) VALUES (1, 'Test product', 'SKU1', 10);
      INSERT INTO store_areas (id, name, sub_department) VALUES (1, 'Aisle 1', 'Dairy');
    `);
  });

  afterEach(() => {
    db.close();
  });

  it('returns dashboard summary data from the expected query sequence', () => {
    const totalProductsStatement = { get: jest.fn().mockReturnValue({ count: 100 }) };
    const expiringSoonStatement = { get: jest.fn().mockReturnValue({ count: 10 }) };
    const markdownItemsStatement = { get: jest.fn().mockReturnValue({ count: 5 }) };
    const recentActivity = [
      { id: 1, description: 'Created product', timestamp: '2026-05-01T00:00:00.000Z' },
    ];
    const recentActivityStatement = { all: jest.fn().mockReturnValue(recentActivity) };
    const db = {
      prepare: jest
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
  });
});
