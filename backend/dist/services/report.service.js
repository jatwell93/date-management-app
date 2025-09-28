"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReportService = void 0;
const database_1 = require("../database");
class ReportService {
    async getMonthlyExpiryReport() {
        const db = await (0, database_1.getDb)();
        // Get expiry reports grouped by month, showing products expiring soon and their status
        const report = await db.all(`SELECT
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
      LIMIT 12`);
        return report;
    }
    async getMonthlyMarkdownReport() {
        const db = await (0, database_1.getDb)();
        // This query aggregates markdown values and counts by month.
        const report = await db.all(`SELECT
        strftime('%Y-%m', created_at) as month,
        SUM(CASE WHEN status LIKE 'Markdown%' THEN 10.00 ELSE 0 END) as totalMarkdownValue,
        COUNT(*) as itemCount
      FROM inventory_items
      WHERE status LIKE 'Markdown%'
      GROUP BY month
      ORDER BY month DESC`);
        return report;
    }
    async getUsageReport() {
        const db = await (0, database_1.getDb)();
        // Aggregate user activity from audit logs
        const report = await db.all(`SELECT
        u.role as role,
        COUNT(al.id) as total_activities,
        COUNT(CASE WHEN al.change_description LIKE '%created%' THEN 1 END) as creations,
        COUNT(CASE WHEN al.change_description LIKE '%updated%' THEN 1 END) as updates,
        COUNT(CASE WHEN al.change_description LIKE '%deleted%' THEN 1 END) as deletions
      FROM audit_log al
      JOIN users u ON al.user_id = u.id
      GROUP BY u.role
      ORDER BY u.role`);
        return report;
    }
    async getDashboardAnalytics() {
        const db = await (0, database_1.getDb)();
        // Get overall inventory statistics
        const totalProducts = await db.get("SELECT COUNT(*) as count FROM products");
        const totalInventoryItems = await db.get("SELECT COUNT(*) as count FROM inventory_items");
        const activeItems = await db.get("SELECT COUNT(*) as count FROM inventory_items WHERE status != 'Expired'");
        const expiredItems = await db.get("SELECT COUNT(*) as count FROM inventory_items WHERE status = 'Expired'");
        const markdownItems = await db.get("SELECT COUNT(*) as count FROM inventory_items WHERE status LIKE 'Markdown%'");
        // Get upcoming expiry items that will expire within next 30 days
        const upcomingExpiry = await db.get(`SELECT COUNT(*) as count FROM inventory_items
       WHERE expiry_date >= date('now') AND expiry_date <= date('now', '+30 days')
       AND status != 'Expired'`);
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
exports.ReportService = ReportService;
