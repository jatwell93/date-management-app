/**
 * Report Repository
 *
 * Data access layer for report generation.
 * Handles all database queries for reports and dashboard analytics.
 *
 * Task 8.5: Create report repository with dependency injection
 */

import Database from 'better-sqlite3';

type DB = InstanceType<typeof Database>;

// Report interfaces
export interface MonthlyExpiryReport {
  month: string;
  total_expiring: number;
  expired_count: number;
  markdown1_count: number;
  markdown2_count: number;
  markdown3_count: number;
  total_markdown: number;
  latest_expiry_date: string;
}

export interface MonthlyMarkdownReport {
  month: string;
  totalMarkdownValue: number;
  itemCount: number;
}

export interface UsageReport {
  role: string;
  total_activities: number;
  creations: number;
  updates: number;
  deletions: number;
}

export interface DailyUsageReportItem {
  date: string;
  user_id: number;
  user_role: string;
  creations: number;
  updates: number;
  deletions: number;
}

export interface LossBySkuReportItem {
  sku: string;
  productName: string;
  totalLoss: number;
  count: number;
}

export interface LossByDepartmentReportItem {
  department: string;
  totalLoss: number;
  count: number;
}

export interface ItemsByUserReportItem {
  userId: number;
  userName: string;
  itemCount: number;
}

export interface ItemsByDateReportItem {
  date: string;
  itemCount: number;
}

export interface DashboardAnalytics {
  totalProducts: number;
  totalInventoryItems: number;
  activeItems: number;
  expiredItems: number;
  markdownItems: number;
  upcomingExpiry: number;
}

export class ReportRepository {
  constructor(private db: DB) {}

  /**
   * Get monthly expiry report
   */
  getMonthlyExpiryReport(): MonthlyExpiryReport[] {
    const stmt = this.db.prepare(
      `SELECT
        strftime('%Y-%m', expiry_date) as month,
        COUNT(*) as total_expiring,
        SUM(CASE WHEN status = 'Expired' THEN 1 ELSE 0 END) as expired_count,
        SUM(CASE WHEN status = 'Markdown 1' THEN 1 ELSE 0 END) as markdown1_count,
        SUM(CASE WHEN status = 'Markdown 2' THEN 1 ELSE 0 END) as markdown2_count,
        SUM(CASE WHEN status = 'Markdown 3' THEN 1 ELSE 0 END) as markdown3_count,
        SUM(CASE WHEN status LIKE 'Markdown%' THEN 1 ELSE 0 END) as total_markdown,
        MAX(expiry_date) as latest_expiry_date
      FROM inventory_items
      WHERE expiry_date IS NOT NULL AND expiry_date != ''
      GROUP BY month
      ORDER BY month DESC
      LIMIT 12`,
    );
    return stmt.all() as MonthlyExpiryReport[];
  }

  /**
   * Get overall expiry report
   */
  getOverallExpiryReport(): MonthlyExpiryReport {
    const stmt = this.db.prepare(
      `SELECT
        'Overall' as month,
        COUNT(*) as total_expiring,
        SUM(CASE WHEN status = 'Expired' THEN 1 ELSE 0 END) as expired_count,
        SUM(CASE WHEN status = 'Markdown 1' THEN 1 ELSE 0 END) as markdown1_count,
        SUM(CASE WHEN status = 'Markdown 2' THEN 1 ELSE 0 END) as markdown2_count,
        SUM(CASE WHEN status = 'Markdown 3' THEN 1 ELSE 0 END) as markdown3_count,
        SUM(CASE WHEN status LIKE 'Markdown%' THEN 1 ELSE 0 END) as total_markdown,
        MAX(expiry_date) as latest_expiry_date
      FROM inventory_items
      WHERE expiry_date IS NOT NULL AND expiry_date != ''`,
    );
    return stmt.get() as MonthlyExpiryReport;
  }

  /**
   * Get detailed expiry report (next 90 days)
   */
  getDetailedExpiryReport(): any[] {
    const stmt = this.db.prepare(
      `SELECT 
        ii.id as inventoryId,
        ii.expiry_date as expiryDate,
        ii.status as status,
        p.id as productId,
        p.name as productName,
        p.sku as sku,
        p.cost_price as costPrice,
        sa.id as locationId,
        sa.name as locationName,
        sa.sub_department as subDepartment
      FROM inventory_items ii
      JOIN products p ON ii.product_id = p.id
      JOIN store_areas sa ON ii.location_id = sa.id
      WHERE ii.expiry_date >= date('now') 
        AND ii.expiry_date <= date('now', '+90 days')
      ORDER BY ii.expiry_date ASC`,
    );
    return stmt.all();
  }

  /**
   * Get monthly markdown report
   */
  getMonthlyMarkdownReport(): MonthlyMarkdownReport[] {
    const stmt = this.db.prepare(
      `SELECT
        strftime('%Y-%m', created_at) as month,
        SUM(CASE WHEN status LIKE 'Markdown%' THEN 10.00 ELSE 0 END) as totalMarkdownValue,
        COUNT(*) as itemCount
      FROM inventory_items
      WHERE status LIKE 'Markdown%'
      GROUP BY month
      ORDER BY month DESC`,
    );
    return stmt.all() as MonthlyMarkdownReport[];
  }

  /**
   * Get usage report by role
   */
  getUsageReport(): UsageReport[] {
    const stmt = this.db.prepare(
      `SELECT
        COALESCE(u.role, 'Unknown') as role,
        COUNT(al.id) as total_activities,
        COUNT(CASE WHEN al.change_description LIKE '%created%' THEN 1 END) as creations,
        COUNT(CASE WHEN al.change_description LIKE '%updated%' THEN 1 END) as updates,
        COUNT(CASE WHEN al.change_description LIKE '%deleted%' THEN 1 END) as deletions
      FROM audit_log al
      LEFT JOIN users u ON al.user_id = u.id
      GROUP BY COALESCE(u.role, 'Unknown')
      ORDER BY COALESCE(u.role, 'Unknown')`,
    );
    return stmt.all() as UsageReport[];
  }

  /**
   * Get daily usage report (past 90 days)
   */
  getDailyUsageReport(): DailyUsageReportItem[] {
    const stmt = this.db.prepare(
      `SELECT
        date(al.created_at) as date,
        COALESCE(u.id, al.user_id) as user_id,
        COALESCE(u.role, 'Unknown') as user_role,
        COUNT(CASE WHEN al.change_description LIKE '%created%' THEN 1 END) as creations,
        COUNT(CASE WHEN al.change_description LIKE '%updated%' THEN 1 END) as updates,
        COUNT(CASE WHEN al.change_description LIKE '%deleted%' THEN 1 END) as deletions
      FROM audit_log al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE date(al.created_at) >= date('now', '-90 days')
      GROUP BY date(al.created_at), COALESCE(u.id, al.user_id)
      ORDER BY date(al.created_at) DESC`,
    );
    return stmt.all() as DailyUsageReportItem[];
  }

  /**
   * Get dashboard analytics summary
   */
  getDashboardAnalytics(): DashboardAnalytics {
    const totalProducts = this.db.prepare('SELECT COUNT(*) as count FROM products').get() as {
      count: number;
    };
    const totalInventoryItems = this.db
      .prepare('SELECT COUNT(*) as count FROM inventory_items')
      .get() as { count: number };
    const activeItems = this.db
      .prepare("SELECT COUNT(*) as count FROM inventory_items WHERE status != 'Expired'")
      .get() as { count: number };
    const expiredItems = this.db
      .prepare("SELECT COUNT(*) as count FROM inventory_items WHERE status = 'Expired'")
      .get() as { count: number };
    const markdownItems = this.db
      .prepare("SELECT COUNT(*) as count FROM inventory_items WHERE status LIKE 'Markdown%'")
      .get() as { count: number };

    // Get upcoming expiry items (next 30 days)
    const upcomingExpiry = this.db
      .prepare(
        `SELECT COUNT(*) as count FROM inventory_items
       WHERE expiry_date >= date('now') AND expiry_date <= date('now', '+30 days')
       AND status != 'Expired'`,
      )
      .get() as { count: number };

    return {
      totalProducts: totalProducts.count,
      totalInventoryItems: totalInventoryItems.count,
      activeItems: activeItems.count,
      expiredItems: expiredItems.count,
      markdownItems: markdownItems.count,
      upcomingExpiry: upcomingExpiry.count,
    };
  }

  /**
   * Get loss by SKU report (top 10 expired items)
   */
  getLossBySkuReport(): LossBySkuReportItem[] {
    const stmt = this.db.prepare(`
      SELECT 
        p.sku as sku,
        p.name as productName,
        SUM(p.cost_price) as totalLoss,
        COUNT(*) as count
      FROM inventory_items ii
      JOIN products p ON ii.product_id = p.id
      WHERE ii.status = 'Expired'
      GROUP BY p.sku, p.name
      ORDER BY totalLoss DESC
      LIMIT 10
    `);
    return stmt.all() as LossBySkuReportItem[];
  }

  /**
   * Get loss by department report
   */
  getLossByDepartmentReport(): LossByDepartmentReportItem[] {
    const stmt = this.db.prepare(`
      SELECT 
        sa.sub_department as department,
        SUM(p.cost_price) as totalLoss,
        COUNT(*) as count
      FROM inventory_items ii
      JOIN products p ON ii.product_id = p.id
      JOIN store_areas sa ON ii.location_id = sa.id
      WHERE ii.status = 'Expired' AND sa.sub_department IS NOT NULL
      GROUP BY sa.sub_department
      ORDER BY totalLoss DESC
    `);
    return stmt.all() as LossByDepartmentReportItem[];
  }

  /**
   * Get items by user report
   */
  getItemsByUserReport(timeFrameDays?: string): ItemsByUserReportItem[] {
    let whereClause = "WHERE al.change_description LIKE '%created%'";
    const params: any[] = [];

    if (timeFrameDays && timeFrameDays !== 'all-time') {
      whereClause += ` AND al.created_at >= date('now', '-' || ? || ' days')`;
      params.push(timeFrameDays);
    }

    const query = `
      SELECT 
        al.user_id as userId,
        COALESCE(u.pin, 'Unknown') as userName,
        COUNT(*) as itemCount
      FROM audit_log al
      LEFT JOIN users u ON al.user_id = u.id
      ${whereClause}
      GROUP BY al.user_id, u.pin
      ORDER BY itemCount DESC
      LIMIT 10
    `;

    const stmt = this.db.prepare(query);
    return stmt.all(...params) as ItemsByUserReportItem[];
  }

  /**
   * Get items by date report (past 30 days)
   */
  getItemsByDateReport(): ItemsByDateReportItem[] {
    const stmt = this.db.prepare(`
      SELECT 
        date(al.created_at) as date,
        COUNT(*) as itemCount
      FROM audit_log al
      WHERE al.change_description LIKE '%created%'
      GROUP BY date(al.created_at)
      ORDER BY date DESC
      LIMIT 30
    `);
    return stmt.all() as ItemsByDateReportItem[];
  }
}
