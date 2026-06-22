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
import {
  DISPOSITIONED_STATUSES,
  EXPIRED_STATUS,
  WORKERS_SOLD_THROUGH_STATUS,
} from '../../shared/domain/disposition';
import { getMarkdownLevelForDays, MARKDOWN_WINDOWS } from '../../shared/domain/markdown';

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
  getDashboardStats(organizationId: string): Promise<DashboardStats>;

  // Report queries
  getMonthlyExpiryReport(organizationId: string): Promise<MonthlyExpiryReport[]>;
  getOverallExpiryReport(organizationId: string): Promise<MonthlyExpiryReport>;
  getDetailedExpiryReport(organizationId: string): Promise<DetailedExpiryReportItem[]>;
  getDailyUsageReport(organizationId: string): Promise<DailyUsageReportItem[]>;
  getItemsByUserReport(
    organizationId: string,
    timeFrameDays?: string,
  ): Promise<ItemsByUserReportItem[]>;
  getItemsByDateReport(organizationId: string): Promise<ItemsByDateReportItem[]>;
  getLossBySkuReport(organizationId: string): Promise<LossBySkuReportItem[]>;
  getLossByDepartmentReport(organizationId: string): Promise<LossByDepartmentReportItem[]>;
  getSellThroughByMarkdownLevel(organizationId: string): Promise<SellThroughByLevelItem[]>;

  // Expired items queries
  getExpiredItems(organizationId: string): Promise<ExpiredItemRow[]>;
  processExpiredItem(
    inventoryItemId: number,
    userId: number,
    organizationId: string,
    action: string,
    unitsDiscarded?: number,
  ): Promise<ExpiredItemTransaction>;

  // Product CRUD (scan flow)
  findProductByBarcode(organizationId: string, barcode: string): Promise<Product | null>;
  findProductBySku(organizationId: string, sku: string): Promise<Product | null>;
  createProduct(
    organizationId: string,
    data: {
      barcode: string;
      sku?: string | null;
      name: string;
      costPrice?: number;
      notes?: string;
    },
  ): Promise<Product>;

  // Inventory CRUD
  findInventoryItemById(organizationId: string, id: number): Promise<InventoryItem | null>;
  findInventoryItemsByProductId(
    organizationId: string,
    productId: number,
  ): Promise<InventoryItem[]>;
  findRecentInventoryItemsByProductId(
    organizationId: string,
    productId: number,
    limit: number,
  ): Promise<RecentInventoryItem[]>;
  createInventoryItem(
    organizationId: string,
    userId: number,
    data: {
      productId: number;
      expiryDate: string;
      locationId: number;
      status?: string;
    },
  ): Promise<InventoryItem>;
  updateInventoryItem(
    organizationId: string,
    userId: number,
    id: number,
    data: { productId?: number; expiryDate?: string; locationId?: number; status?: string },
  ): Promise<InventoryItem | null>;
  deleteInventoryItem(organizationId: string, userId: number, id: number): Promise<boolean>;

  // Store area CRUD
  createStoreArea(
    organizationId: string,
    data: { name: string; subDepartment?: string | null },
  ): Promise<StoreArea>;
  updateStoreArea(
    organizationId: string,
    id: number,
    data: { name?: string; subDepartment?: string | null },
  ): Promise<StoreArea | null>;
  deleteStoreArea(organizationId: string, id: number): Promise<boolean>;

  // Users CRUD
  listUsers(organizationId: string): Promise<UserListItem[]>;
  updateUserRole(
    organizationId: string,
    userId: number,
    role: string,
  ): Promise<UserListItem | null>;
  softDeleteUser(organizationId: string, userId: number): Promise<boolean>;
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
  expiry_risk_count: number;
  next_month_markdown_count: number;
  active_expiry_stock_count: number;
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

export interface SellThroughByLevelItem {
  markdownLevel: number | null;
  soldCount: number;
}

export interface ExpiredItemRow {
  id: number;
  productId: number;
  productName: string;
  sku: string;
  expiryDate: string;
  status: string;
  costPrice: number;
  locationId: number;
  locationName: string;
  quantityAvailable: number;
}

export interface RecentInventoryItem {
  id: number;
  productId: number;
  expiryDate: string | null;
  locationId: number | null;
  locationName: string | null;
  status: string | null;
  createdAt: string;
}

export interface UserListItem {
  id: number;
  email: string | null;
  username: string | null;
  role: string;
  clerkUserId: string | null;
  createdAt: string;
}

export interface ExpiredItemTransaction {
  id: number;
  inventoryItemId: number;
  action: string;
  userId: number | null;
  unitsDiscarded: number | null;
  financialLoss: number | null;
  markdownLevel: number | null;
  transactionDate: string;
}

/**
 * Markdown level snapshot aligned with the expiry report windows
 * (Markdown 1 = 61-90 days, Markdown 2 = 31-60, Markdown 3 = 0-30 days to expiry).
 * Returns null when the item is not within a markdown window (already expired or
 * more than 90 days out). Kept consistent with getMonthlyExpiryReport's buckets so
 * sell-through reporting lines up with the on-screen markdown levels.
 */
export function reportMarkdownLevel(daysToExpiry: number | null): number | null {
  return getMarkdownLevelForDays(daysToExpiry);
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
    async getDashboardStats(organizationId: string): Promise<DashboardStats> {
      // The schema dropped the legacy `quantity` column in favour of a
      // `status` enum on inventory_items. The DashboardStats `lowStockItems`
      // counter now reflects items flagged as Critical/LowStock.
      const [products, inventory, expiring, lowStock] = await Promise.all([
        sql`SELECT COUNT(*)::int as count FROM products WHERE organization_id = ${organizationId}`,
        sql`SELECT COUNT(*)::int as count FROM inventory_items WHERE organization_id = ${organizationId}`,
        sql`SELECT COUNT(*)::int as count FROM inventory_items
            WHERE expiry_date IS NOT NULL AND expiry_date <= NOW() + INTERVAL '7 days'
              AND organization_id = ${organizationId}`,
        sql`SELECT COUNT(*)::int as count FROM inventory_items
            WHERE status IN ('Critical', 'LowStock', 'Low')
              AND organization_id = ${organizationId}`,
      ]);

      return {
        totalProducts: products[0]?.count || 0,
        totalInventoryItems: inventory[0]?.count || 0,
        expiringItems: expiring[0]?.count || 0,
        lowStockItems: lowStock[0]?.count || 0,
      };
    },

    // Report queries
    async getMonthlyExpiryReport(organizationId: string): Promise<MonthlyExpiryReport[]> {
      return (await sql`
        WITH expiry_rows AS (
          SELECT
            expiry_date,
            expiry_date::date - CURRENT_DATE AS days_to_expiry
          FROM inventory_items
          WHERE expiry_date IS NOT NULL AND organization_id = ${organizationId}
        )
        SELECT
          to_char(expiry_date, 'YYYY-MM') as month,
          COUNT(*)::int as total_expiring,
          (COUNT(*) FILTER (WHERE days_to_expiry < 0))::int as expired_count,
          (COUNT(*) FILTER (WHERE days_to_expiry BETWEEN ${MARKDOWN_WINDOWS.markdown1.minDays} AND ${MARKDOWN_WINDOWS.markdown1.maxDays}))::int as markdown1_count,
          (COUNT(*) FILTER (WHERE days_to_expiry BETWEEN ${MARKDOWN_WINDOWS.markdown2.minDays} AND ${MARKDOWN_WINDOWS.markdown2.maxDays}))::int as markdown2_count,
          (COUNT(*) FILTER (WHERE days_to_expiry BETWEEN ${MARKDOWN_WINDOWS.markdown3.minDays} AND ${MARKDOWN_WINDOWS.markdown3.maxDays}))::int as markdown3_count,
          (COUNT(*) FILTER (WHERE days_to_expiry BETWEEN ${MARKDOWN_WINDOWS.totalMarkdown.minDays} AND ${MARKDOWN_WINDOWS.totalMarkdown.maxDays}))::int as total_markdown,
          (COUNT(*) FILTER (WHERE days_to_expiry BETWEEN ${MARKDOWN_WINDOWS.markdown3.minDays} AND ${MARKDOWN_WINDOWS.markdown3.maxDays}))::int as expiry_risk_count,
          (COUNT(*) FILTER (WHERE days_to_expiry BETWEEN ${MARKDOWN_WINDOWS.nextMonthMarkdown.minDays} AND ${MARKDOWN_WINDOWS.nextMonthMarkdown.maxDays}))::int as next_month_markdown_count,
          (COUNT(*) FILTER (WHERE days_to_expiry >= ${MARKDOWN_WINDOWS.activeExpiryStock.minDays}))::int as active_expiry_stock_count,
          MAX(expiry_date)::text as latest_expiry_date
        FROM expiry_rows
        GROUP BY to_char(expiry_date, 'YYYY-MM')
        ORDER BY month DESC
        LIMIT 12
      `) as MonthlyExpiryReport[];
    },

    async getOverallExpiryReport(organizationId: string): Promise<MonthlyExpiryReport> {
      const rows = await sql`
        WITH expiry_rows AS (
          SELECT
            expiry_date,
            expiry_date::date - CURRENT_DATE AS days_to_expiry
          FROM inventory_items
          WHERE expiry_date IS NOT NULL AND organization_id = ${organizationId}
        )
        SELECT
          'Overall' as month,
          COUNT(*)::int as total_expiring,
          (COUNT(*) FILTER (WHERE days_to_expiry < 0))::int as expired_count,
          (COUNT(*) FILTER (WHERE days_to_expiry BETWEEN ${MARKDOWN_WINDOWS.markdown1.minDays} AND ${MARKDOWN_WINDOWS.markdown1.maxDays}))::int as markdown1_count,
          (COUNT(*) FILTER (WHERE days_to_expiry BETWEEN ${MARKDOWN_WINDOWS.markdown2.minDays} AND ${MARKDOWN_WINDOWS.markdown2.maxDays}))::int as markdown2_count,
          (COUNT(*) FILTER (WHERE days_to_expiry BETWEEN ${MARKDOWN_WINDOWS.markdown3.minDays} AND ${MARKDOWN_WINDOWS.markdown3.maxDays}))::int as markdown3_count,
          (COUNT(*) FILTER (WHERE days_to_expiry BETWEEN ${MARKDOWN_WINDOWS.totalMarkdown.minDays} AND ${MARKDOWN_WINDOWS.totalMarkdown.maxDays}))::int as total_markdown,
          (COUNT(*) FILTER (WHERE days_to_expiry BETWEEN ${MARKDOWN_WINDOWS.markdown3.minDays} AND ${MARKDOWN_WINDOWS.markdown3.maxDays}))::int as expiry_risk_count,
          (COUNT(*) FILTER (WHERE days_to_expiry BETWEEN ${MARKDOWN_WINDOWS.nextMonthMarkdown.minDays} AND ${MARKDOWN_WINDOWS.nextMonthMarkdown.maxDays}))::int as next_month_markdown_count,
          (COUNT(*) FILTER (WHERE days_to_expiry >= ${MARKDOWN_WINDOWS.activeExpiryStock.minDays}))::int as active_expiry_stock_count,
          MAX(expiry_date)::text as latest_expiry_date
        FROM expiry_rows
      `;
      return (rows[0] || {
        month: 'Overall',
        total_expiring: 0,
        expired_count: 0,
        markdown1_count: 0,
        markdown2_count: 0,
        markdown3_count: 0,
        total_markdown: 0,
        expiry_risk_count: 0,
        next_month_markdown_count: 0,
        active_expiry_stock_count: 0,
        latest_expiry_date: null,
      }) as MonthlyExpiryReport;
    },

    async getDetailedExpiryReport(organizationId: string): Promise<DetailedExpiryReportItem[]> {
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
          AND ii.organization_id = ${organizationId}
          -- Exclude items already dispositioned via sold-through so they do not
          -- reappear in the worklist after refresh. 'Sold Through' is the workers
          -- marker; 'Processed' is the SQLite backend marker. 'Expired' is
          -- intentionally NOT excluded: a day-0 item is the most urgent worklist
          -- entry, and write-offs are already excluded by the date window.
          AND ii.status <> ALL(${[...DISPOSITIONED_STATUSES]})
        -- ii.id tiebreaker keeps ordering deterministic across engines when two
        -- items share an expiry_date; without it Postgres and SQLite can break
        -- the tie differently and the conformance test would drift.
        ORDER BY ii.expiry_date ASC, ii.id ASC
      `) as DetailedExpiryReportItem[];
    },

    async getDailyUsageReport(organizationId: string): Promise<DailyUsageReportItem[]> {
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
          AND al.organization_id = ${organizationId}
        GROUP BY al.created_at::date, COALESCE(u.id, al.user_id), COALESCE(u.role, 'Unknown')
        ORDER BY al.created_at::date DESC
      `) as DailyUsageReportItem[];
    },

    async getItemsByUserReport(
      organizationId: string,
      timeFrameDays?: string,
    ): Promise<ItemsByUserReportItem[]> {
      if (timeFrameDays && timeFrameDays !== 'all-time') {
        const days = parseInt(timeFrameDays, 10);
        if (!isNaN(days) && days > 0) {
          return (await sql`
            SELECT
              al.user_id as "userId",
              COALESCE(u.username, u.email, 'Unknown') as "userName",
              COUNT(*)::int as "itemCount"
            FROM audit_log al
            LEFT JOIN users u ON al.user_id = u.id
            WHERE al.change_description LIKE '%created%'
              AND al.created_at >= CURRENT_DATE - make_interval(days => ${days})
              AND al.organization_id = ${organizationId}
            GROUP BY al.user_id, COALESCE(u.username, u.email, 'Unknown')
            ORDER BY "itemCount" DESC
            LIMIT 10
          `) as ItemsByUserReportItem[];
        }
      }

      return (await sql`
        SELECT
          al.user_id as "userId",
          COALESCE(u.username, u.email, 'Unknown') as "userName",
          COUNT(*)::int as "itemCount"
        FROM audit_log al
        LEFT JOIN users u ON al.user_id = u.id
        WHERE al.change_description LIKE '%created%'
          AND al.organization_id = ${organizationId}
        GROUP BY al.user_id, COALESCE(u.username, u.email, 'Unknown')
        ORDER BY "itemCount" DESC
        LIMIT 10
      `) as ItemsByUserReportItem[];
    },

    async getItemsByDateReport(organizationId: string): Promise<ItemsByDateReportItem[]> {
      return (await sql`
        SELECT
          al.created_at::date::text as date,
          COUNT(*)::int as "itemCount"
        FROM audit_log al
        WHERE al.change_description LIKE '%created%'
          AND al.organization_id = ${organizationId}
        GROUP BY al.created_at::date
        ORDER BY date DESC
        LIMIT 30
      `) as ItemsByDateReportItem[];
    },

    async getLossBySkuReport(organizationId: string): Promise<LossBySkuReportItem[]> {
      return (await sql`
        SELECT
          COALESCE(p.sku, '') as sku,
          p.name as "productName",
          COALESCE(SUM(p.cost_price), 0) as "totalLoss",
          COUNT(*)::int as count
        FROM inventory_items ii
        JOIN products p ON ii.product_id = p.id
        WHERE ii.status = 'Expired'
          AND ii.organization_id = ${organizationId}
        GROUP BY p.sku, p.name
        ORDER BY "totalLoss" DESC
        LIMIT 10
      `) as LossBySkuReportItem[];
    },

    async getLossByDepartmentReport(organizationId: string): Promise<LossByDepartmentReportItem[]> {
      return (await sql`
        SELECT
          sa.sub_department as department,
          COALESCE(SUM(p.cost_price), 0) as "totalLoss",
          COUNT(*)::int as count
        FROM inventory_items ii
        JOIN products p ON ii.product_id = p.id
        JOIN store_areas sa ON ii.location_id = sa.id
        WHERE ii.status = 'Expired' AND sa.sub_department IS NOT NULL
          AND ii.organization_id = ${organizationId}
        GROUP BY sa.sub_department
        ORDER BY "totalLoss" DESC
      `) as LossByDepartmentReportItem[];
    },

    async getSellThroughByMarkdownLevel(organizationId: string): Promise<SellThroughByLevelItem[]> {
      // How many items sold through at each markdown depth (null = sold before
      // reaching a markdown window). Surfaces stock that only moves when reduced.
      return (await sql`
        SELECT
          markdown_level as "markdownLevel",
          COUNT(*)::int as "soldCount"
        FROM expired_item_transactions
        WHERE action = 'sold_through' AND organization_id = ${organizationId}
        GROUP BY markdown_level
        ORDER BY markdown_level ASC NULLS LAST
      `) as SellThroughByLevelItem[];
    },

    // Expired items queries
    async getExpiredItems(organizationId: string): Promise<ExpiredItemRow[]> {
      return (await sql`
        SELECT
          ii.id,
          ii.product_id as "productId",
          p.name as "productName",
          COALESCE(p.sku, '') as sku,
          ii.expiry_date::text as "expiryDate",
          ii.status,
          COALESCE(p.cost_price, 0) as "costPrice",
          ii.location_id as "locationId",
          sa.name as "locationName",
          1::int as "quantityAvailable"
        FROM inventory_items ii
        JOIN products p ON ii.product_id = p.id
        JOIN store_areas sa ON ii.location_id = sa.id
        WHERE (ii.expiry_date < CURRENT_DATE
          OR ii.status IN ('Expired', 'Markdown 1', 'Markdown 2', 'Markdown 3'))
          AND ii.organization_id = ${organizationId}
        ORDER BY ii.expiry_date ASC
      `) as ExpiredItemRow[];
    },

    async processExpiredItem(
      inventoryItemId: number,
      userId: number,
      organizationId: string,
      action: string,
      unitsDiscarded?: number,
    ): Promise<ExpiredItemTransaction> {
      const newStatus = action === 'sold_through' ? WORKERS_SOLD_THROUGH_STATUS : EXPIRED_STATUS;
      const itemRows = await sql`
        SELECT
          COALESCE(p.cost_price, 0) * ${action === 'expired' ? (unitsDiscarded ?? 0) : 0} as "financialLoss",
          (ii.expiry_date::date - CURRENT_DATE) as "daysToExpiry"
        FROM inventory_items ii
        JOIN products p ON ii.product_id = p.id
        WHERE ii.id = ${inventoryItemId}
        LIMIT 1
      `;

      if (!itemRows[0]) {
        throw new Error(`Inventory item ${inventoryItemId} not found`);
      }

      const daysToExpiry =
        itemRows[0].daysToExpiry === null ? null : Number(itemRows[0].daysToExpiry);
      const markdownLevel = reportMarkdownLevel(daysToExpiry);

      await sql`
        UPDATE inventory_items
        SET status = ${newStatus}, updated_at = NOW()
        WHERE id = ${inventoryItemId}
      `;

      const rows = await sql`
        INSERT INTO expired_item_transactions
          (organization_id, inventory_item_id, user_id, action, units_discarded, financial_loss, markdown_level, transaction_date, created_at, updated_at)
        VALUES
          (${organizationId}, ${inventoryItemId}, ${userId}, ${action}, ${unitsDiscarded ?? null}, ${Number(itemRows[0].financialLoss) || null}, ${markdownLevel}, NOW(), NOW(), NOW())
        RETURNING
          id,
          inventory_item_id as "inventoryItemId",
          user_id as "userId",
          action,
          units_discarded as "unitsDiscarded",
          financial_loss as "financialLoss",
          markdown_level as "markdownLevel",
          transaction_date::text as "transactionDate"
      `;

      return rows[0] as ExpiredItemTransaction;
    },

    // ---- Product CRUD (scan flow) ----
    async findProductByBarcode(organizationId: string, barcode: string): Promise<Product | null> {
      const rows = await sql`
        SELECT id, name, barcode, sku,
               cost_price as "costPrice", notes,
               created_at as "createdAt", updated_at as "updatedAt"
        FROM products
        WHERE organization_id = ${organizationId} AND barcode = ${barcode}
        LIMIT 1
      `;
      return (rows[0] as Product) || null;
    },

    async findProductBySku(organizationId: string, sku: string): Promise<Product | null> {
      const rows = await sql`
        SELECT id, name, barcode, sku,
               cost_price as "costPrice", notes,
               created_at as "createdAt", updated_at as "updatedAt"
        FROM products
        WHERE organization_id = ${organizationId} AND sku = ${sku}
        LIMIT 1
      `;
      return (rows[0] as Product) || null;
    },

    async createProduct(
      organizationId: string,
      data: {
        barcode: string;
        sku?: string | null;
        name: string;
        costPrice?: number;
        notes?: string;
      },
    ): Promise<Product> {
      const rows = await sql`
        INSERT INTO products (organization_id, barcode, sku, name, cost_price, notes, created_at, updated_at)
        VALUES (
          ${organizationId},
          ${data.barcode},
          ${data.sku ?? data.barcode},
          ${data.name},
          ${data.costPrice ?? 0},
          ${data.notes ?? ''},
          NOW(),
          NOW()
        )
        RETURNING id, name, barcode, sku,
                  cost_price as "costPrice", notes,
                  created_at as "createdAt", updated_at as "updatedAt"
      `;
      return rows[0] as Product;
    },

    // ---- Inventory CRUD ----
    async findInventoryItemById(organizationId: string, id: number): Promise<InventoryItem | null> {
      const rows = await sql`
        SELECT
          i.id, i.product_id as "productId",
          i.expiry_date as "expiryDate",
          i.location_id as "locationId",
          i.location_id as "storeAreaId",
          i.status,
          i.created_at as "createdAt", i.updated_at as "updatedAt"
        FROM inventory_items i
        WHERE i.id = ${id} AND i.organization_id = ${organizationId}
        LIMIT 1
      `;
      return (rows[0] as InventoryItem) || null;
    },

    async findInventoryItemsByProductId(
      organizationId: string,
      productId: number,
    ): Promise<InventoryItem[]> {
      return (await sql`
        SELECT
          i.id, i.product_id as "productId",
          i.expiry_date as "expiryDate",
          i.location_id as "locationId",
          i.location_id as "storeAreaId",
          i.status,
          i.created_at as "createdAt", i.updated_at as "updatedAt",
          CASE WHEN s.id IS NOT NULL THEN
            json_build_object('id', s.id, 'name', s.name, 'subDepartment', s.sub_department)
          ELSE NULL END as "storeArea"
        FROM inventory_items i
        LEFT JOIN store_areas s ON i.location_id = s.id
        WHERE i.organization_id = ${organizationId} AND i.product_id = ${productId}
        ORDER BY i.expiry_date ASC NULLS LAST
      `) as InventoryItem[];
    },

    async findRecentInventoryItemsByProductId(
      organizationId: string,
      productId: number,
      limit: number,
    ): Promise<RecentInventoryItem[]> {
      return (await sql`
        SELECT
          i.id,
          i.product_id as "productId",
          i.expiry_date::text as "expiryDate",
          i.location_id as "locationId",
          s.name as "locationName",
          i.status,
          i.created_at::text as "createdAt"
        FROM inventory_items i
        LEFT JOIN store_areas s ON i.location_id = s.id
        WHERE i.organization_id = ${organizationId} AND i.product_id = ${productId}
        ORDER BY i.created_at DESC
        LIMIT ${limit}
      `) as RecentInventoryItem[];
    },

    async createInventoryItem(
      organizationId: string,
      userId: number,
      data: {
        productId: number;
        expiryDate: string;
        locationId: number;
        status?: string;
      },
    ): Promise<InventoryItem> {
      // Validate product + location belong to the same org
      const productRows = await sql`
        SELECT id FROM products
        WHERE id = ${data.productId} AND organization_id = ${organizationId}
        LIMIT 1
      `;
      if (!productRows[0]) {
        throw new Error('Product does not exist');
      }

      const locationRows = await sql`
        SELECT id FROM store_areas
        WHERE id = ${data.locationId} AND organization_id = ${organizationId}
        LIMIT 1
      `;
      if (!locationRows[0]) {
        throw new Error('Location does not exist');
      }

      // Atomic insert + audit via CTE so we never end up with an inventory
      // item lacking an audit row (or vice versa) on partial failure.
      const rows = await sql`
        WITH inserted AS (
          INSERT INTO inventory_items
            (organization_id, product_id, expiry_date, location_id, status, created_at, updated_at)
          VALUES
            (${organizationId}, ${data.productId}, ${data.expiryDate}, ${data.locationId},
             ${data.status ?? 'Normal'}, NOW(), NOW())
          RETURNING id, product_id, expiry_date, location_id, status, created_at, updated_at
        ), audited AS (
          INSERT INTO audit_log
            (organization_id, user_id, inventory_item_id, action, change_description, created_at)
          SELECT ${organizationId}, ${userId}, id, 'create', 'inventory item created', NOW()
          FROM inserted
        )
        SELECT id,
               product_id as "productId",
               expiry_date as "expiryDate",
               location_id as "locationId",
               location_id as "storeAreaId",
               status,
               created_at as "createdAt",
               updated_at as "updatedAt"
        FROM inserted
      `;

      return rows[0] as InventoryItem;
    },

    async updateInventoryItem(
      organizationId: string,
      userId: number,
      id: number,
      data: { productId?: number; expiryDate?: string; locationId?: number; status?: string },
    ): Promise<InventoryItem | null> {
      // Verify ownership
      const existing = await sql`
        SELECT id FROM inventory_items
        WHERE id = ${id} AND organization_id = ${organizationId}
        LIMIT 1
      `;
      if (!existing[0]) {
        return null;
      }

      // If locationId provided, verify it belongs to the org
      if (data.locationId !== undefined) {
        const locationRows = await sql`
          SELECT id FROM store_areas
          WHERE id = ${data.locationId} AND organization_id = ${organizationId}
          LIMIT 1
        `;
        if (!locationRows[0]) {
          throw new Error('Location does not exist');
        }
      }

      // Atomic update + audit via CTE.
      const rows = await sql`
        WITH updated AS (
          UPDATE inventory_items
          SET
            product_id = COALESCE(${data.productId ?? null}, product_id),
            expiry_date = COALESCE(${data.expiryDate ?? null}, expiry_date),
            location_id = COALESCE(${data.locationId ?? null}, location_id),
            status = COALESCE(${data.status ?? null}, status),
            updated_at = NOW()
          WHERE id = ${id} AND organization_id = ${organizationId}
          RETURNING id, product_id, expiry_date, location_id, status, created_at, updated_at
        ), audited AS (
          INSERT INTO audit_log
            (organization_id, user_id, inventory_item_id, action, change_description, created_at)
          SELECT ${organizationId}, ${userId}, id, 'update', 'inventory item updated', NOW()
          FROM updated
        )
        SELECT id,
               product_id as "productId",
               expiry_date as "expiryDate",
               location_id as "locationId",
               location_id as "storeAreaId",
               status,
               created_at as "createdAt",
               updated_at as "updatedAt"
        FROM updated
      `;

      return (rows[0] as InventoryItem) || null;
    },

    async deleteInventoryItem(
      organizationId: string,
      userId: number,
      id: number,
    ): Promise<boolean> {
      // Atomic delete + audit via CTE. The audit row is only inserted if the
      // delete actually removed a row owned by this org, so we never log a
      // phantom delete and never delete without an audit trail.
      //
      // Note: audit_log.inventory_item_id may have a FK to inventory_items.
      // Postgres CTEs evaluate to a consistent snapshot for the duration of
      // the statement, so the FK is satisfied at constraint-check time. If a
      // future migration adds a deferrable FK or removes it entirely, this
      // pattern still works.
      const rows = await sql`
        WITH deleted AS (
          DELETE FROM inventory_items
          WHERE id = ${id} AND organization_id = ${organizationId}
          RETURNING id
        ), audited AS (
          INSERT INTO audit_log
            (organization_id, user_id, inventory_item_id, action, change_description, created_at)
          SELECT ${organizationId}, ${userId}, id, 'delete', 'inventory item deleted', NOW()
          FROM deleted
        )
        SELECT id FROM deleted
      `;
      return !!rows[0];
    },

    // ---- Store area CRUD ----
    async createStoreArea(
      organizationId: string,
      data: { name: string; subDepartment?: string | null },
    ): Promise<StoreArea> {
      const rows = await sql`
        INSERT INTO store_areas (organization_id, name, sub_department, created_at, updated_at)
        VALUES (${organizationId}, ${data.name}, ${data.subDepartment ?? null}, NOW(), NOW())
        RETURNING id, name,
                  sub_department as "subDepartment",
                  created_at as "createdAt", updated_at as "updatedAt"
      `;
      return rows[0] as StoreArea;
    },

    async updateStoreArea(
      organizationId: string,
      id: number,
      data: { name?: string; subDepartment?: string | null },
    ): Promise<StoreArea | null> {
      const existing = await sql`
        SELECT id FROM store_areas
        WHERE id = ${id} AND organization_id = ${organizationId}
        LIMIT 1
      `;
      if (!existing[0]) {
        return null;
      }

      const rows = await sql`
        UPDATE store_areas
        SET
          name = COALESCE(${data.name ?? null}, name),
          sub_department = CASE
            WHEN ${data.subDepartment === undefined} THEN sub_department
            ELSE ${data.subDepartment ?? null}
          END,
          updated_at = NOW()
        WHERE id = ${id} AND organization_id = ${organizationId}
        RETURNING id, name,
                  sub_department as "subDepartment",
                  created_at as "createdAt", updated_at as "updatedAt"
      `;
      return (rows[0] as StoreArea) || null;
    },

    async deleteStoreArea(organizationId: string, id: number): Promise<boolean> {
      const inUse = await sql`
        SELECT 1 FROM inventory_items
        WHERE location_id = ${id} AND organization_id = ${organizationId}
        LIMIT 1
      `;
      if (inUse[0]) {
        throw new Error('Store area is in use by inventory items');
      }

      const rows = await sql`
        DELETE FROM store_areas
        WHERE id = ${id} AND organization_id = ${organizationId}
        RETURNING id
      `;
      return !!rows[0];
    },

    // ---- Users CRUD ----
    async listUsers(organizationId: string): Promise<UserListItem[]> {
      return (await sql`
        SELECT
          id, email, username, role,
          clerk_user_id as "clerkUserId",
          created_at::text as "createdAt"
        FROM users
        WHERE organization_id = ${organizationId}
          AND deleted_at IS NULL
        ORDER BY created_at ASC
      `) as UserListItem[];
    },

    async updateUserRole(
      organizationId: string,
      userId: number,
      role: string,
    ): Promise<UserListItem | null> {
      const rows = await sql`
        UPDATE users
        SET role = ${role}, updated_at = NOW()
        WHERE id = ${userId}
          AND organization_id = ${organizationId}
          AND deleted_at IS NULL
        RETURNING id, email, username, role,
                  clerk_user_id as "clerkUserId",
                  created_at::text as "createdAt"
      `;
      return (rows[0] as UserListItem) || null;
    },

    async softDeleteUser(organizationId: string, userId: number): Promise<boolean> {
      const rows = await sql`
        UPDATE users
        SET deleted_at = NOW(), updated_at = NOW()
        WHERE id = ${userId}
          AND organization_id = ${organizationId}
          AND deleted_at IS NULL
        RETURNING id
      `;
      return !!rows[0];
    },
  };
}
