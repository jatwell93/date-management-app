/**
 * Workers Database Client
 *
 * Uses Neon's edge-native serverless driver for Cloudflare Workers.
 * This is purpose-built for edge environments - no Prisma, no native bindings.
 *
 * Uses Hyperdrive for edge-pooled connections to Neon PostgreSQL.
 */

import { neon, NeonQueryFunction } from '@neondatabase/serverless';
import type { Env } from './types/env';

// Note: fetchConnectionCache is now always true by default in @neondatabase/serverless

/**
 * Database wrapper providing typed query methods
 */
export interface Database {
  sql: NeonQueryFunction<false, false>;

  // User queries
  findUserByEmail(email: string): Promise<User | null>;
  findUserById(id: number): Promise<User | null>;
  createUser(data: CreateUserData): Promise<User>;

  // Product queries
  findProducts(options?: { limit?: number; offset?: number; search?: string }): Promise<Product[]>;
  findProductById(id: number): Promise<Product | null>;
  countProducts(search?: string): Promise<number>;

  // Inventory queries
  findInventoryItems(options?: { limit?: number; offset?: number }): Promise<InventoryItem[]>;
  countInventoryItems(): Promise<number>;

  // Store area queries
  findStoreAreas(): Promise<StoreArea[]>;

  // Dashboard queries
  getDashboardStats(): Promise<DashboardStats>;

  // Report queries
  getMonthlyExpiryReport(): Promise<MonthlyExpiryReport[]>;
  getOverallExpiryReport(): Promise<MonthlyExpiryReport>;
  getDetailedExpiryReport(): Promise<DetailedExpiryReportItem[]>;
  getDailyUsageReport(): Promise<DailyUsageReportItem[]>;
  getItemsByUserReport(timeFrameDays?: string): Promise<ItemsByUserReportItem[]>;
  getItemsByDateReport(): Promise<ItemsByDateReportItem[]>;
  getLossBySkuReport(): Promise<LossBySkuReportItem[]>;
  getLossByDepartmentReport(): Promise<LossByDepartmentReportItem[]>;
}

// Type definitions matching backend Prisma schema
export interface User {
  id: number;
  email: string;
  name: string | null;
  passwordHash: string;
  organizationId?: string;
  role: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserData {
  email: string;
  name?: string;
  passwordHash: string;
  role?: string;
}

// Field set kept aligned with the Prisma schema in
// backend/prisma/schema.prisma. Older `description`, `category`, `quantity`
// fields were removed when the schema migrated to sku/cost_price/notes and
// location_id/status. Optional flags exist purely so legacy frontend code
// that still reads those properties degrades to undefined instead of throwing.
export interface Product {
  id: number;
  name: string;
  barcode: string | null;
  sku: string | null;
  costPrice: number | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  description?: string | null;
  category?: string | null;
}

export interface InventoryItem {
  id: number;
  productId: number;
  expiryDate: Date | null;
  locationId: number | null;
  status: string | null;
  createdAt: Date;
  updatedAt: Date;
  product?: Product;
  storeArea?: StoreArea;
  storeAreaId?: number | null;
  quantity?: number;
}

export interface StoreArea {
  id: number;
  name: string;
  subDepartment: string | null;
  createdAt: Date;
  updatedAt: Date;
  description?: string | null;
}

export interface DashboardStats {
  totalProducts: number;
  totalInventoryItems: number;
  expiringItems: number;
  lowStockItems: number;
}

export interface MonthlyExpiryReport {
  month: string;
  total_expiring: number;
  expired_count: number;
  markdown1_count: number;
  markdown2_count: number;
  markdown3_count: number;
  total_markdown: number;
  latest_expiry_date: string;
}

export interface DailyUsageReportItem {
  date: string;
  user_id: number;
  user_role: string;
  creations: number;
  updates: number;
  deletions: number;
}

export interface ItemsByUserReportItem {
  userId: number;
  userName: string;
  itemCount: number;
}

export interface ItemsByDateReportItem {
  date: string;
  itemCount: number;
}

export interface DetailedExpiryReportItem {
  inventoryId: number;
  expiryDate: string;
  status: string;
  productId: number;
  productName: string;
  sku: string;
  costPrice: number;
  locationId: number;
  locationName: string;
  subDepartment: string | null;
}

export interface LossBySkuReportItem {
  sku: string;
  productName: string;
  totalLoss: number;
  count: number;
}

export interface LossByDepartmentReportItem {
  department: string;
  totalLoss: number;
  count: number;
}

/**
 * Create database connection for Workers environment
 * Uses Hyperdrive connection string from env bindings
 */
export function createWorkersDatabase(env: Env): Database {
  // Neon serverless driver is most reliable with direct Neon connection strings.
  // Keep Hyperdrive as an emergency fallback when secrets are missing.
  let connectionString = env.NEON_CONNECTION_STRING || env.DATABASE_URL;

  if (connectionString) {
    console.log('[Database] Connecting via Neon serverless driver (direct)');
  } else if (env.HYPERDRIVE?.connectionString) {
    console.warn(
      '[Database] Direct Neon connection not found, falling back to Hyperdrive connection string',
    );
    connectionString = env.HYPERDRIVE.connectionString;
  }

  if (!connectionString) {
    throw new Error(
      'No database connection string available. Configure NEON_CONNECTION_STRING, DATABASE_URL, or HYPERDRIVE.',
    );
  }

  // Create Neon SQL tagged template function
  const sql = neon(connectionString);

  return {
    sql,

    // User queries
    async findUserByEmail(email: string): Promise<User | null> {
      const rows = await sql`
        SELECT id,
               email,
               username as "name",
               ''::text as "passwordHash",
               organization_id as "organizationId",
               role,
               created_at as "createdAt",
               updated_at as "updatedAt"
        FROM users 
        WHERE LOWER(email) = LOWER(${email})
        LIMIT 1
      `;
      return (rows[0] as User) || null;
    },

    async findUserById(id: number): Promise<User | null> {
      const rows = await sql`
        SELECT id,
               email,
               username as "name",
               ''::text as "passwordHash",
               organization_id as "organizationId",
               role,
               created_at as "createdAt",
               updated_at as "updatedAt"
        FROM users 
        WHERE id = ${id}
        LIMIT 1
      `;
      return (rows[0] as User) || null;
    },

    async createUser(data: CreateUserData): Promise<User> {
      const rows = await sql`
        WITH sync_sequence AS (
          SELECT setval(
            pg_get_serial_sequence('users', 'id'),
            COALESCE((SELECT MAX(id) FROM users), 0) + 1,
            false
          )
        ),
        default_org AS (
          SELECT id
          FROM organizations
          ORDER BY created_at ASC
          LIMIT 1
        )
        INSERT INTO users (organization_id, email, username, role, created_at, updated_at)
        SELECT default_org.id,
               ${data.email.toLowerCase()},
               ${data.name || null},
               ${data.role || 'user'},
               NOW(),
               NOW()
        FROM default_org, sync_sequence
        RETURNING id,
                  email,
                  username as "name",
                  ''::text as "passwordHash",
                  organization_id as "organizationId",
                  role,
                  created_at as "createdAt",
                  updated_at as "updatedAt"
      `;

      if (!rows[0]) {
        throw new Error('No organization available for user provisioning');
      }

      return rows[0] as User;
    },

    // Product queries
    async findProducts(options?: {
      limit?: number;
      offset?: number;
      search?: string;
    }): Promise<Product[]> {
      const limit = options?.limit || 50;
      const offset = options?.offset || 0;
      const search = options?.search;

      if (search) {
        const searchPattern = `%${search}%`;
        return (await sql`
          SELECT id, name, barcode, sku,
                 cost_price as "costPrice", notes,
                 created_at as "createdAt", updated_at as "updatedAt"
          FROM products
          WHERE name ILIKE ${searchPattern}
             OR barcode ILIKE ${searchPattern}
             OR sku ILIKE ${searchPattern}
          ORDER BY name ASC
          LIMIT ${limit} OFFSET ${offset}
        `) as Product[];
      }

      return (await sql`
        SELECT id, name, barcode, sku,
               cost_price as "costPrice", notes,
               created_at as "createdAt", updated_at as "updatedAt"
        FROM products
        ORDER BY name ASC
        LIMIT ${limit} OFFSET ${offset}
      `) as Product[];
    },

    async findProductById(id: number): Promise<Product | null> {
      const rows = await sql`
        SELECT id, name, barcode, sku,
               cost_price as "costPrice", notes,
               created_at as "createdAt", updated_at as "updatedAt"
        FROM products
        WHERE id = ${id}
        LIMIT 1
      `;
      return (rows[0] as Product) || null;
    },

    async countProducts(search?: string): Promise<number> {
      if (search) {
        const searchPattern = `%${search}%`;
        const rows = await sql`
          SELECT COUNT(*)::int as count FROM products
          WHERE name ILIKE ${searchPattern}
             OR barcode ILIKE ${searchPattern}
             OR sku ILIKE ${searchPattern}
        `;
        return rows[0]?.count || 0;
      }
      const rows = await sql`SELECT COUNT(*)::int as count FROM products`;
      return rows[0]?.count || 0;
    },

    // Inventory queries
    async findInventoryItems(options?: {
      limit?: number;
      offset?: number;
    }): Promise<InventoryItem[]> {
      const limit = options?.limit || 50;
      const offset = options?.offset || 0;

      return (await sql`
        SELECT
          i.id, i.product_id as "productId",
          i.expiry_date as "expiryDate",
          i.location_id as "locationId",
          i.location_id as "storeAreaId",
          i.status,
          i.created_at as "createdAt", i.updated_at as "updatedAt",
          json_build_object(
            'id', p.id, 'name', p.name, 'barcode', p.barcode, 'sku', p.sku
          ) as product,
          CASE WHEN s.id IS NOT NULL THEN
            json_build_object('id', s.id, 'name', s.name, 'subDepartment', s.sub_department)
          ELSE NULL END as "storeArea"
        FROM inventory_items i
        LEFT JOIN products p ON i.product_id = p.id
        LEFT JOIN store_areas s ON i.location_id = s.id
        ORDER BY i.expiry_date ASC NULLS LAST
        LIMIT ${limit} OFFSET ${offset}
      `) as InventoryItem[];
    },

    async countInventoryItems(): Promise<number> {
      const rows = await sql`SELECT COUNT(*)::int as count FROM inventory_items`;
      return rows[0]?.count || 0;
    },

    // Store area queries
    async findStoreAreas(): Promise<StoreArea[]> {
      return (await sql`
        SELECT id, name,
               sub_department as "subDepartment",
               created_at as "createdAt", updated_at as "updatedAt"
        FROM store_areas
        ORDER BY name ASC
      `) as StoreArea[];
    },

    // Dashboard queries
    async getDashboardStats(): Promise<DashboardStats> {
      // The schema dropped the legacy `quantity` column in favour of a
      // `status` enum on inventory_items. The DashboardStats `lowStockItems`
      // counter now reflects items flagged as Critical/LowStock.
      const [products, inventory, expiring, lowStock] = await Promise.all([
        sql`SELECT COUNT(*)::int as count FROM products`,
        sql`SELECT COUNT(*)::int as count FROM inventory_items`,
        sql`SELECT COUNT(*)::int as count FROM inventory_items
            WHERE expiry_date IS NOT NULL AND expiry_date <= NOW() + INTERVAL '7 days'`,
        sql`SELECT COUNT(*)::int as count FROM inventory_items
            WHERE status IN ('Critical', 'LowStock', 'Low')`,
      ]);

      return {
        totalProducts: products[0]?.count || 0,
        totalInventoryItems: inventory[0]?.count || 0,
        expiringItems: expiring[0]?.count || 0,
        lowStockItems: lowStock[0]?.count || 0,
      };
    },

    // Report queries
    async getMonthlyExpiryReport(): Promise<MonthlyExpiryReport[]> {
      return (await sql`
        SELECT
          to_char(expiry_date, 'YYYY-MM') as month,
          COUNT(*)::int as total_expiring,
          SUM(CASE WHEN status = 'Expired' THEN 1 ELSE 0 END)::int as expired_count,
          SUM(CASE WHEN status = 'Markdown 1' THEN 1 ELSE 0 END)::int as markdown1_count,
          SUM(CASE WHEN status = 'Markdown 2' THEN 1 ELSE 0 END)::int as markdown2_count,
          SUM(CASE WHEN status = 'Markdown 3' THEN 1 ELSE 0 END)::int as markdown3_count,
          SUM(CASE WHEN status LIKE 'Markdown%' THEN 1 ELSE 0 END)::int as total_markdown,
          MAX(expiry_date)::text as latest_expiry_date
        FROM inventory_items
        WHERE expiry_date IS NOT NULL
        GROUP BY to_char(expiry_date, 'YYYY-MM')
        ORDER BY month DESC
        LIMIT 12
      `) as MonthlyExpiryReport[];
    },

    async getOverallExpiryReport(): Promise<MonthlyExpiryReport> {
      const rows = await sql`
        SELECT
          'Overall' as month,
          COUNT(*)::int as total_expiring,
          SUM(CASE WHEN status = 'Expired' THEN 1 ELSE 0 END)::int as expired_count,
          SUM(CASE WHEN status = 'Markdown 1' THEN 1 ELSE 0 END)::int as markdown1_count,
          SUM(CASE WHEN status = 'Markdown 2' THEN 1 ELSE 0 END)::int as markdown2_count,
          SUM(CASE WHEN status = 'Markdown 3' THEN 1 ELSE 0 END)::int as markdown3_count,
          SUM(CASE WHEN status LIKE 'Markdown%' THEN 1 ELSE 0 END)::int as total_markdown,
          MAX(expiry_date)::text as latest_expiry_date
        FROM inventory_items
        WHERE expiry_date IS NOT NULL
      `;
      return (rows[0] || {
        month: 'Overall',
        total_expiring: 0,
        expired_count: 0,
        markdown1_count: 0,
        markdown2_count: 0,
        markdown3_count: 0,
        total_markdown: 0,
        latest_expiry_date: null,
      }) as MonthlyExpiryReport;
    },

    async getDetailedExpiryReport(): Promise<DetailedExpiryReportItem[]> {
      return (await sql`
        SELECT
          ii.id as "inventoryId",
          ii.expiry_date::text as "expiryDate",
          ii.status,
          p.id as "productId",
          p.name as "productName",
          COALESCE(p.sku, '') as sku,
          COALESCE(p.cost_price, 0) as "costPrice",
          sa.id as "locationId",
          sa.name as "locationName",
          sa.sub_department as "subDepartment"
        FROM inventory_items ii
        JOIN products p ON ii.product_id = p.id
        JOIN store_areas sa ON ii.location_id = sa.id
        WHERE ii.expiry_date >= CURRENT_DATE
          AND ii.expiry_date <= CURRENT_DATE + INTERVAL '90 days'
        ORDER BY ii.expiry_date ASC
      `) as DetailedExpiryReportItem[];
    },

    async getDailyUsageReport(): Promise<DailyUsageReportItem[]> {
      return (await sql`
        SELECT
          al.created_at::date::text as date,
          COALESCE(u.id, al.user_id) as user_id,
          COALESCE(u.role, 'Unknown') as user_role,
          COUNT(CASE WHEN al.change_description LIKE '%created%' THEN 1 END)::int as creations,
          COUNT(CASE WHEN al.change_description LIKE '%updated%' THEN 1 END)::int as updates,
          COUNT(CASE WHEN al.change_description LIKE '%deleted%' THEN 1 END)::int as deletions
        FROM audit_log al
        LEFT JOIN users u ON al.user_id = u.id
        WHERE al.created_at::date >= CURRENT_DATE - INTERVAL '90 days'
        GROUP BY al.created_at::date, COALESCE(u.id, al.user_id), COALESCE(u.role, 'Unknown')
        ORDER BY al.created_at::date DESC
      `) as DailyUsageReportItem[];
    },

    async getItemsByUserReport(timeFrameDays?: string): Promise<ItemsByUserReportItem[]> {
      if (timeFrameDays && timeFrameDays !== 'all-time') {
        const days = parseInt(timeFrameDays, 10);
        if (!isNaN(days) && days > 0) {
          return (await sql`
            SELECT
              al.user_id as "userId",
              COALESCE(u.name, u.email, 'Unknown') as "userName",
              COUNT(*)::int as "itemCount"
            FROM audit_log al
            LEFT JOIN users u ON al.user_id = u.id
            WHERE al.change_description LIKE '%created%'
              AND al.created_at >= CURRENT_DATE - make_interval(days => ${days})
            GROUP BY al.user_id, COALESCE(u.name, u.email, 'Unknown')
            ORDER BY "itemCount" DESC
            LIMIT 10
          `) as ItemsByUserReportItem[];
        }
      }

      return (await sql`
        SELECT
          al.user_id as "userId",
          COALESCE(u.name, u.email, 'Unknown') as "userName",
          COUNT(*)::int as "itemCount"
        FROM audit_log al
        LEFT JOIN users u ON al.user_id = u.id
        WHERE al.change_description LIKE '%created%'
        GROUP BY al.user_id, COALESCE(u.name, u.email, 'Unknown')
        ORDER BY "itemCount" DESC
        LIMIT 10
      `) as ItemsByUserReportItem[];
    },

    async getItemsByDateReport(): Promise<ItemsByDateReportItem[]> {
      return (await sql`
        SELECT
          al.created_at::date::text as date,
          COUNT(*)::int as "itemCount"
        FROM audit_log al
        WHERE al.change_description LIKE '%created%'
        GROUP BY al.created_at::date
        ORDER BY date DESC
        LIMIT 30
      `) as ItemsByDateReportItem[];
    },

    async getLossBySkuReport(): Promise<LossBySkuReportItem[]> {
      return (await sql`
        SELECT
          COALESCE(p.sku, '') as sku,
          p.name as "productName",
          COALESCE(SUM(p.cost_price), 0) as "totalLoss",
          COUNT(*)::int as count
        FROM inventory_items ii
        JOIN products p ON ii.product_id = p.id
        WHERE ii.status = 'Expired'
        GROUP BY p.sku, p.name
        ORDER BY "totalLoss" DESC
        LIMIT 10
      `) as LossBySkuReportItem[];
    },

    async getLossByDepartmentReport(): Promise<LossByDepartmentReportItem[]> {
      return (await sql`
        SELECT
          sa.sub_department as department,
          COALESCE(SUM(p.cost_price), 0) as "totalLoss",
          COUNT(*)::int as count
        FROM inventory_items ii
        JOIN products p ON ii.product_id = p.id
        JOIN store_areas sa ON ii.location_id = sa.id
        WHERE ii.status = 'Expired' AND sa.sub_department IS NOT NULL
        GROUP BY sa.sub_department
        ORDER BY "totalLoss" DESC
      `) as LossByDepartmentReportItem[];
    },
  };
}
