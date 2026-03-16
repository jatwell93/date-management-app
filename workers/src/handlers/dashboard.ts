/**
 * Dashboard Handler - Multi-Tenant Safe
 * 
 * Aggregates organization-scoped metrics 
 * All queries filter by organizationId to ensure data isolation.
 * 
 * All database operations include automatic retry logic for transient failures.
 */

import { neon } from '@neondatabase/serverless';
import type { Env } from '../types/env';
import { withNeonRetry } from '../utils/db-retry';

export interface DashboardData {
  totalProducts: number;
  totalInventoryItems: number;
  expiringItems: number;
  expiredItems: number;
}

export async function getDashboardData(
  env: Env,
  organizationId: string
): Promise<DashboardData> {
  return withNeonRetry(async () => {
    const sql = neon(getConnectionString(env));
    
    // All queries include organizationId filter for isolation
    const [productsRes, inventoryRes, expiringRes, expiredRes] = await Promise.all([
      sql`SELECT COUNT(*) as count FROM products WHERE organization_id = ${organizationId}`,
      sql`
        SELECT COUNT(*) as count FROM inventory_items i
        JOIN products p ON i.product_id = p.id
        WHERE p.organization_id = ${organizationId}
      `,
      sql`
        SELECT COUNT(*) as count FROM inventory_items i
        JOIN products p ON i.product_id = p.id
        WHERE p.organization_id = ${organizationId}
          AND i.expiry_date IS NOT NULL
          AND i.expiry_date <= CURRENT_DATE + INTERVAL '90 days'
          AND i.expiry_date > CURRENT_DATE
      `,
      sql`
        SELECT COUNT(*) as count FROM inventory_items i
        JOIN products p ON i.product_id = p.id
        WHERE p.organization_id = ${organizationId}
          AND i.expiry_date IS NOT NULL
          AND i.expiry_date <= CURRENT_DATE
      `
    ]);
    
    return {
      totalProducts: ((productsRes[0] as any).count as number) ?? 0,
      totalInventoryItems: ((inventoryRes[0] as any).count as number) ?? 0,
      expiringItems: ((expiringRes[0] as any).count as number) ?? 0,
      expiredItems: ((expiredRes[0] as any).count as number) ?? 0
    };
  });
}

function getConnectionString(env: Env): string {
  return env.HYPERDRIVE?.connectionString || env.NEON_CONNECTION_STRING || '';
}
