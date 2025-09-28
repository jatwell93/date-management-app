"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DashboardService = void 0;
const database_1 = require("../database");
class DashboardService {
    async getDashboardData() {
        const db = await (0, database_1.getDb)();
        const totalProductsResult = await db.get("SELECT COUNT(*) as count FROM products");
        const expiringSoonResult = await db.get(`SELECT COUNT(*) as count FROM inventory_items WHERE expiry_date <= date('now', '+7 day') AND status = 'Normal'`);
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
