import { getDb } from '../database';
import { SchedulerService } from './scheduler.service';

interface MonthlyExpiryReport {
  month: string;
  total_expiring: number;
  expired_count: number;
  markdown1_count: number;
  markdown2_count: number;
  markdown3_count: number;
  total_markdown: number;
  latest_expiry_date: string;
}

interface MonthlyMarkdownReport {
  month: string;
  totalMarkdownValue: number;
  itemCount: number;
}

interface UsageReport {
  role: string;
  total_activities: number;
  creations: number;
  updates: number;
  deletions: number;
}

interface DailyUsageReportItem {
  date: string; // YYYY-MM-DD
  user_id: number;
  user_role: string;
  creations: number;
  updates: number;
  deletions: number;
}

interface LossBySkuReportItem {
  sku: string;
  productName: string;
  totalLoss: number;
  count: number;
}

interface LossByDepartmentReportItem {
  department: string;
  totalLoss: number;
  count: number;
}

interface ItemsByUserReportItem {
  userId: number;
  userName: string;
  itemCount: number;
}

interface ItemsByDateReportItem {
  date: string; // YYYY-MM-DD
  itemCount: number;
}

interface DashboardAnalytics {
  totalProducts: number;
  totalInventoryItems: number;
  activeItems: number;
  expiredItems: number;
  markdownItems: number;
  upcomingExpiry: number;
}

export class ReportService {
  async getMonthlyExpiryReport(): Promise<MonthlyExpiryReport[]> {
    const db = await getDb();

    // Get expiry reports grouped by month, showing products expiring soon and their status
    const stmt = db.prepare(
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

  async getOverallExpiryReport(): Promise<MonthlyExpiryReport> {
    const db = await getDb();

    // Get overall expiry report showing total counts across all months
    const stmt = db.prepare(
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

  async getDetailedExpiryReport(): Promise<any[]> {
    const db = await getDb();

    // Get detailed expiry information for the next 90 days, including cost price
    const stmt = db.prepare(
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

  async getMonthlyMarkdownReport(): Promise<MonthlyMarkdownReport[]> {
    const db = await getDb();
    // This query aggregates markdown values and counts by month.
    const stmt = db.prepare(
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

  async getUsageReport(): Promise<UsageReport[]> {
    const db = await getDb();
    // Aggregate user activity from audit logs
    const stmt = db.prepare(
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

  async getDailyUsageReport(): Promise<DailyUsageReportItem[]> {
    const db = await getDb();
    // Get daily usage report for the past 90 days
    const stmt = db.prepare(
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

  async getDashboardAnalytics(): Promise<DashboardAnalytics> {
    const db = await getDb();

    // Get overall inventory statistics
    const totalProducts = db.prepare('SELECT COUNT(*) as count FROM products').get() as {
      count: number;
    };
    const totalInventoryItems = db
      .prepare('SELECT COUNT(*) as count FROM inventory_items')
      .get() as { count: number };
    const activeItems = db
      .prepare("SELECT COUNT(*) as count FROM inventory_items WHERE status != 'Expired'")
      .get() as { count: number };
    const expiredItems = db
      .prepare("SELECT COUNT(*) as count FROM inventory_items WHERE status = 'Expired'")
      .get() as { count: number };
    const markdownItems = db
      .prepare("SELECT COUNT(*) as count FROM inventory_items WHERE status LIKE 'Markdown%'")
      .get() as { count: number };

    // Get upcoming expiry items that will expire within next 30 days
    const upcomingExpiry = db
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

  async updateAllMarkdownStatuses(): Promise<void> {
    return SchedulerService.updateAllInventoryMarkdownStatuses();
  }

  async getLossBySkuReport(): Promise<LossBySkuReportItem[]> {
    const db = await getDb();

    // Get total loss by SKU (for expired items)
    const stmt = db.prepare(`
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

  async getLossByDepartmentReport(): Promise<LossByDepartmentReportItem[]> {
    const db = await getDb();

    // Get total loss by department (for expired items)
    const stmt = db.prepare(`
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

  async getItemsByUserReport(timeFrame?: string): Promise<ItemsByUserReportItem[]> {
    const db = await getDb();

    let whereClause = "WHERE al.change_description LIKE '%created%'";
    const params: any[] = [];

    if (timeFrame && timeFrame !== 'all-time') {
      whereClause += ` AND al.created_at >= date('now', '-' || ? || ' days')`;
      params.push(timeFrame);
    }

    // Get items added by user (from audit logs)
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

    const stmt = db.prepare(query);
    return stmt.all(...params) as ItemsByUserReportItem[];
  }

  async getItemsByDateReport(): Promise<ItemsByDateReportItem[]> {
    const db = await getDb();

    // Get items added by date (from audit logs)
    const stmt = db.prepare(`
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
