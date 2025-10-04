"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DashboardService = void 0;
const database_1 = require("../database");
class DashboardService {
    async getDashboardData() {
        const db = await (0, database_1.getDb)();
        const totalProductsResult = await db.get("SELECT COUNT(*) as count FROM products");
        // Count items that are expiring within 90 days (3 months) - matching the markdown logic
        const expiringSoonResult = await db.get(`SELECT COUNT(*) as count FROM inventory_items WHERE expiry_date <= date('now', '+90 day') AND status = 'Normal'`);
        // Count items that have markdown status (any markdown level) - these already account for expiry-based statuses
        const markdownItemsResult = await db.get(`SELECT COUNT(*) as count FROM inventory_items WHERE status LIKE 'Markdown%'`);
        const recentActivityResult = await db.all("SELECT id, change_description as description, created_at as timestamp FROM audit_log ORDER BY created_at DESC LIMIT 5");
        return {
            totalProducts: totalProductsResult.count,
            expiringSoon: expiringSoonResult.count,
            markdownItems: markdownItemsResult.count,
            recentActivity: recentActivityResult,
        };
    }
}
exports.DashboardService = DashboardService;
