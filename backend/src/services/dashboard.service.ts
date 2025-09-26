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
    const expiringSoonResult = await db.get(
      `SELECT COUNT(*) as count FROM inventory_items WHERE expiry_date <= date('now', '+7 day') AND status = 'Normal'`,
    );
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
