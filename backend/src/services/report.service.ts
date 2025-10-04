import { getDb } from "../database";

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
    const report = await db.all(
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
    return report;
  }

  async getDetailedExpiryReport(): Promise<any[]> {
    const db = await getDb();
    
    // Get detailed expiry information for the next 90 days
    const report = await db.all(
      `SELECT 
        ii.id as inventoryId,
        ii.expiry_date as expiryDate,
        ii.status as status,
        p.id as productId,
        p.name as productName,
        p.sku as sku,
        sa.id as locationId,
        sa.name as locationName,
        sa.sub_department as subDepartment
      FROM inventory_items ii
      JOIN products p ON ii.product_id = p.id
      JOIN store_areas sa ON ii.location_id = sa.id
      WHERE ii.expiry_date >= date('now') 
        AND ii.expiry_date <= date('now', '+90 days')
      ORDER BY ii.expiry_date ASC`
    );
    return report;
  }

  async getMonthlyMarkdownReport(): Promise<MonthlyMarkdownReport[]> {
    const db = await getDb();
    // This query aggregates markdown values and counts by month.
    const report = await db.all(
      `SELECT
        strftime('%Y-%m', created_at) as month,
        SUM(CASE WHEN status LIKE 'Markdown%' THEN 10.00 ELSE 0 END) as totalMarkdownValue,
        COUNT(*) as itemCount
      FROM inventory_items
      WHERE status LIKE 'Markdown%'
      GROUP BY month
      ORDER BY month DESC`,
    );
    return report;
  }

  async getUsageReport(): Promise<UsageReport[]> {
    const db = await getDb();
    // Aggregate user activity from audit logs
    const report = await db.all(
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
    return report;
  }

  async getDailyUsageReport(): Promise<DailyUsageReportItem[]> {
    const db = await getDb();
    // Get daily usage report for the past 90 days
    const report = await db.all(
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
    return report;
  }

  async getDashboardAnalytics(): Promise<DashboardAnalytics> {
    const db = await getDb();

    // Get overall inventory statistics
    const totalProducts = await db.get(
      "SELECT COUNT(*) as count FROM products",
    );
    const totalInventoryItems = await db.get(
      "SELECT COUNT(*) as count FROM inventory_items",
    );
    const activeItems = await db.get(
      "SELECT COUNT(*) as count FROM inventory_items WHERE status != 'Expired'",
    );
    const expiredItems = await db.get(
      "SELECT COUNT(*) as count FROM inventory_items WHERE status = 'Expired'",
    );
    const markdownItems = await db.get(
      "SELECT COUNT(*) as count FROM inventory_items WHERE status LIKE 'Markdown%'",
    );

    // Get upcoming expiry items that will expire within next 30 days
    const upcomingExpiry = await db.get(
      `SELECT COUNT(*) as count FROM inventory_items
       WHERE expiry_date >= date('now') AND expiry_date <= date('now', '+30 days')
       AND status != 'Expired'`,
    );

    return {
      totalProducts: totalProducts.count,
      totalInventoryItems: totalInventoryItems.count,
      activeItems: activeItems.count,
      expiredItems: expiredItems.count,
      markdownItems: markdownItems.count,
      upcomingExpiry: upcomingExpiry.count,
    };
  }
}
