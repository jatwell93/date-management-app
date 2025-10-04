import { getDb } from "../database";

interface DashboardActivity {
  id: number;
  description: string;
  timestamp: string;
}

interface DashboardData {
  totalProducts: number;
  expiringSoon: number;
  markdownItems: number;
  recentActivity: DashboardActivity[];
}

export class DashboardService {
  async getDashboardData(): Promise<DashboardData> {
    const db = await getDb();

    const totalProductsResult = await db.get(
      "SELECT COUNT(*) as count FROM products",
    );
    
    // Count items that are expiring within 90 days (3 months) - matching the markdown logic
    const expiringSoonResult = await db.get(
      `SELECT COUNT(*) as count FROM inventory_items WHERE expiry_date <= date('now', '+90 day') AND status = 'Normal'`,
    );
    
    // Count items that have markdown status (any markdown level) - these already account for expiry-based statuses
    const markdownItemsResult = await db.get(
      `SELECT COUNT(*) as count FROM inventory_items WHERE status LIKE 'Markdown%'`,
    );
    
    const recentActivityResult = await db.all(
      "SELECT id, change_description as description, created_at as timestamp FROM audit_log ORDER BY created_at DESC LIMIT 5",
    );

    return {
      totalProducts: totalProductsResult.count,
      expiringSoon: expiringSoonResult.count,
      markdownItems: markdownItemsResult.count,
      recentActivity: recentActivityResult,
    };
  }
}
