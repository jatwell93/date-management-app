import { getDb, releaseDb } from '../database';

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
    const db = getDb();

    try {
      const totalProductsResult = db.prepare('SELECT COUNT(*) as count FROM products').get() as {
        count: number;
      };

      // Count items that are expiring within 90 days (3 months) - matching the markdown logic
      const expiringSoonResult = db
        .prepare(
          `SELECT COUNT(*) as count FROM inventory_items WHERE expiry_date <= date('now', '+90 day') AND status = 'Normal'`,
        )
        .get() as { count: number };

      // Count items that have markdown status (any markdown level) - these already account for expiry-based statuses
      const markdownItemsResult = db
        .prepare(`SELECT COUNT(*) as count FROM inventory_items WHERE status LIKE 'Markdown%'`)
        .get() as { count: number };

      const recentActivityResult = db
        .prepare(
          'SELECT id, change_description as description, created_at as timestamp FROM audit_log ORDER BY created_at DESC LIMIT 5',
        )
        .all() as DashboardActivity[];

      return {
        totalProducts: totalProductsResult.count,
        expiringSoon: expiringSoonResult.count,
        markdownItems: markdownItemsResult.count,
        recentActivity: recentActivityResult,
      };
    } finally {
      releaseDb(db);
    }
  }
}
