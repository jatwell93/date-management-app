"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DashboardService = void 0;
const database_1 = require("../database");
class DashboardService {
    async getDashboardData() {
        const db = (0, database_1.getDb)();
        try {
            const totalProductsResult = db.prepare("SELECT COUNT(*) as count FROM products").get();
            // Count items that are expiring within 90 days (3 months) - matching the markdown logic
            const expiringSoonResult = db.prepare(`SELECT COUNT(*) as count FROM inventory_items WHERE expiry_date <= date('now', '+90 day') AND status = 'Normal'`).get();
            // Count items that have markdown status (any markdown level) - these already account for expiry-based statuses
            const markdownItemsResult = db.prepare(`SELECT COUNT(*) as count FROM inventory_items WHERE status LIKE 'Markdown%'`).get();
            const recentActivityResult = db.prepare("SELECT id, change_description as description, created_at as timestamp FROM audit_log ORDER BY created_at DESC LIMIT 5").all();
            return {
                totalProducts: totalProductsResult.count,
                expiringSoon: expiringSoonResult.count,
                markdownItems: markdownItemsResult.count,
                recentActivity: recentActivityResult,
            };
        }
        finally {
            (0, database_1.releaseDb)(db);
        }
    }
}
exports.DashboardService = DashboardService;
