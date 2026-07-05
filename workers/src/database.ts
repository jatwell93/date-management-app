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
  EXPIRED_WORKLIST_STATUSES,
  SQLITE_PROCESSED_STATUS,
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
  getLastCatalogueUpload(organizationId: string): Promise<LastCatalogueUpload | null>;
  getExpiredItemsEnteredToday(organizationId: string): Promise<number>;
  getStockLossLast30Days(organizationId: string): Promise<number>;

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
  getExpiredLossBySku(organizationId: string): Promise<LossBySkuReportItem[]>;
  getExpiredLossByStoreArea(organizationId: string): Promise<ExpiredLossByStoreAreaItem[]>;
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
  expiredActionItems: number;
}

export interface LastCatalogueUpload {
  fileName: string;
  uploadedAt: string;
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

export interface ExpiredLossByStoreAreaItem {
  locationName: string;
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

type InventoryProcessContext = {
  productId: number;
  locationId: number | null;
  costPrice: number;
  financialLoss: number | null;
  daysToExpiry: number | null;
};

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

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function toNumberOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

async function getInventoryProcessContext(
  sql: NeonQueryFunction<false, false>,
  inventoryItemId: number,
  organizationId: string,
  unitsDiscarded?: number,
): Promise<InventoryProcessContext> {
  const itemRows = await sql`
    SELECT
      ii.product_id as "productId",
      ii.location_id as "locationId",
      COALESCE(p.cost_price, 0) as "costPrice",
      COALESCE(p.cost_price, 0) * ${unitsDiscarded ?? 0} as "financialLoss",
      (ii.expiry_date::date - CURRENT_DATE) as "daysToExpiry"
    FROM inventory_items ii
    JOIN products p ON ii.product_id = p.id
    WHERE ii.id = ${inventoryItemId} AND ii.organization_id = ${organizationId}
    LIMIT 1
  `;

  const row = itemRows[0];
  if (!row) {
    throw new Error(`Inventory item ${inventoryItemId} not found`);
  }

  return {
    productId: Number(row.productId),
    locationId: toNumberOrNull(row.locationId),
    costPrice: Number(row.costPrice),
    financialLoss: toNumberOrNull(row.financialLoss),
    daysToExpiry: toNumberOrNull(row.daysToExpiry),
  };
}

async function getMatchingExpiredItemIds(
  sql: NeonQueryFunction<false, false>,
  organizationId: string,
  context: InventoryProcessContext,
  unitsDiscarded: number,
): Promise<number[]> {
  const matchingRows = await sql`
    SELECT ii.id
    FROM inventory_items ii
    JOIN products p ON ii.product_id = p.id
    WHERE ii.organization_id = ${organizationId}
      AND ii.product_id = ${context.productId}
      AND ii.location_id IS NOT DISTINCT FROM ${context.locationId}
      -- COALESCE both sides so a legacy NULL cost_price (the worklist COALESCEs it
      -- to 0 for display) still matches. Comparing a raw NULL column against the
      -- COALESCE'd context value never matched, so the representative row failed to
      -- match even itself, yielding a spurious "no expired units available" 400. #268
      AND COALESCE(p.cost_price, 0) = ${context.costPrice}
      AND (ii.expiry_date < CURRENT_DATE OR ii.status = ANY(${[...EXPIRED_WORKLIST_STATUSES]}))
      -- Exclude every dispositioned status dynamically so adding one to the
      -- shared constant can't leak already-processed items back into the matcher.
      AND ii.status <> ALL(${[...DISPOSITIONED_STATUSES]})
    ORDER BY ii.expiry_date ASC, ii.id ASC
    LIMIT ${unitsDiscarded}
  `;

  return matchingRows.map((row) => Number(row.id));
}

async function getProcessedItemIds(
  sql: NeonQueryFunction<false, false>,
  organizationId: string,
  inventoryItemId: number,
  action: string,
  unitsDiscarded: number | undefined,
  context: InventoryProcessContext,
): Promise<number[]> {
  if (action !== 'expired') {
    return [inventoryItemId];
  }

  if (!isPositiveInteger(unitsDiscarded)) {
    throw new Error('Units discarded must be a positive number when marking as expired');
  }

  // The scan flow logs only a SKU + expiry marker, not real stock-on-hand, so a
  // worklist pool can represent more physical units than it has rows. The user
  // reconciles expired stock in the back office and enters the true count here,
  // which may exceed the row count. We therefore dispose whatever matching rows
  // exist (clearing the pool from the worklist) and let the ledger record the
  // full entered quantity as the loss — the ledger is the source of truth, not
  // the row count. Only reject when the pool is already empty (nothing to
  // process, e.g. the entry was dispositioned concurrently). See issue #268.
  const matchingIds = await getMatchingExpiredItemIds(sql, organizationId, context, unitsDiscarded);
  if (matchingIds.length === 0) {
    throw new Error(
      `Cannot discard ${unitsDiscarded} units; no expired units are available to process`,
    );
  }

  return matchingIds;
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
      // This app tracks expiry dates, not stock levels. `expiringItems` counts
      // near-expiry stock (0-30 days out, not yet expired — the deepest markdown
      // window) that has NOT already been marked down or dispositioned, i.e. stock
      // still needing a markdown decision. `expiredActionItems` counts the expired
      // worklist line items still awaiting a sold-through/expired decision, mirroring
      // the grouping used by getExpiredItems (product/location/cost_price) so the
      // dashboard figure matches the row count shown on the /expired-items page.
      // The two are kept mutually exclusive (worklist/dispositioned statuses are
      // excluded from `expiringItems`) so the "needs attention" headline that sums
      // them does not double-count an item that is both near-expiry and on the
      // worklist (e.g. a Markdown 3 row expiring within 30 days).
      const [products, inventory, expiring, expiredAction] = await Promise.all([
        sql`SELECT COUNT(*)::int as count FROM products WHERE organization_id = ${organizationId}`,
        sql`SELECT COUNT(*)::int as count FROM inventory_items WHERE organization_id = ${organizationId}`,
        sql`SELECT COUNT(*)::int as count FROM inventory_items
            WHERE expiry_date IS NOT NULL
              AND expiry_date >= CURRENT_DATE
              AND expiry_date <= CURRENT_DATE + INTERVAL '30 days'
              AND organization_id = ${organizationId}
              AND status <> ALL(${[...EXPIRED_WORKLIST_STATUSES]})
              AND status <> ALL(${[...DISPOSITIONED_STATUSES]})`,
        sql`SELECT COUNT(*)::int as count FROM (
              SELECT 1
              FROM inventory_items ii
              JOIN products p ON ii.product_id = p.id
              WHERE (ii.expiry_date < CURRENT_DATE
                  OR ii.status = ANY(${[...EXPIRED_WORKLIST_STATUSES]}))
                AND ii.organization_id = ${organizationId}
                AND ii.status <> ALL(${[...DISPOSITIONED_STATUSES]})
              GROUP BY ii.product_id, ii.location_id, p.cost_price
            ) worklist`,
      ]);

      return {
        totalProducts: products[0]?.count || 0,
        totalInventoryItems: inventory[0]?.count || 0,
        expiringItems: expiring[0]?.count || 0,
        expiredActionItems: expiredAction[0]?.count || 0,
      };
    },

    // The latest catalogue upload timestamp lets users judge how stale their
    // product catalogue is. Only queued catalogue imports reliably persist an
    // `uploads` row (small synchronous/expiry-list uploads may not), which is fine
    // here since this signal is specifically about catalogue freshness.
    async getLastCatalogueUpload(
      organizationId: string,
    ): Promise<LastCatalogueUpload | null> {
      const rows = await sql`
        SELECT
          file_name as "fileName",
          -- Serialize as ISO 8601 (T separator) rather than the space-separated
          -- form ::text produces, so new Date() parses reliably across JS engines
          -- (Safari/JSC rejects the ::text form and would show "Time not available").
          to_json(COALESCE(completed_at, created_at)) #>> '{}' as "uploadedAt"
        FROM uploads
        WHERE organization_id = ${organizationId}
          AND status = 'completed'
        ORDER BY COALESCE(completed_at, created_at) DESC
        LIMIT 1
      `;
      const row = rows[0];
      if (!row) return null;
      return { fileName: row.fileName as string, uploadedAt: row.uploadedAt as string };
    },

    // Expired items that became actionable today: either an item whose expiry
    // passed such that today is its first actionable day, or an already-expired
    // item that was entered today. The "became actionable" day is the later of when
    // the row was created and the day after it expired. Scoped to genuinely
    // past-expiry, not-yet-dispositioned rows so that date is well defined.
    async getExpiredItemsEnteredToday(organizationId: string): Promise<number> {
      const rows = await sql`
        SELECT COUNT(*)::int as count
        FROM inventory_items ii
        WHERE ii.expiry_date < CURRENT_DATE
          AND ii.organization_id = ${organizationId}
          AND ii.status <> ALL(${[...DISPOSITIONED_STATUSES]})
          AND GREATEST(
                ii.created_at::date,
                (ii.expiry_date + INTERVAL '1 day')::date
              ) = CURRENT_DATE
      `;
      return (rows[0]?.count as number) || 0;
    },

    // Realized cost-basis stock loss over the last 30 days, summed from the
    // expired write-off ledger (mirrors getExpiredLoss* which value expired='expired'
    // disposals rather than sold-through).
    async getStockLossLast30Days(organizationId: string): Promise<number> {
      const rows = await sql`
        SELECT COALESCE(SUM(financial_loss), 0)::float as "totalLoss"
        FROM expired_item_transactions
        WHERE action = 'expired'
          AND organization_id = ${organizationId}
          AND transaction_date >= CURRENT_DATE - INTERVAL '30 days'
      `;
      return (rows[0]?.totalLoss as number) || 0;
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

    // Standalone /api/reports/loss-by-* endpoints (ExpiredItemsPage charts). These
    // value the stock CURRENTLY sitting expired, mirroring the SQLite backend's
    // report.repository. Kept distinct from the write-off ledger reports below so
    // production (Workers) and dev (backend) stay in parity.
    //
    // "Currently expired" is defined by expiry_date, not a literal 'Expired' status:
    // the Workers scan path stores items as 'Normal' and never recomputes status,
    // so filtering on status = 'Expired' returned nothing on Neon (the SQLite
    // backend does set that status, hence the parity gap). We count anything past
    // its expiry date (or explicitly flagged 'Expired') that hasn't been
    // dispositioned — matching how the worklist itself decides an item is expired.
    async getLossBySkuReport(organizationId: string): Promise<LossBySkuReportItem[]> {
      return (await sql`
        SELECT
          COALESCE(p.sku, '') as sku,
          p.name as "productName",
          COALESCE(SUM(p.cost_price), 0) as "totalLoss",
          COUNT(*)::int as count
        FROM inventory_items ii
        JOIN products p ON ii.product_id = p.id
        WHERE (ii.expiry_date < CURRENT_DATE OR ii.status = ${EXPIRED_STATUS})
          AND ii.status <> ALL(${[...DISPOSITIONED_STATUSES]})
          AND ii.organization_id = ${organizationId}
        GROUP BY p.sku, p.name
        ORDER BY "totalLoss" DESC
        LIMIT 5
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
        WHERE (ii.expiry_date < CURRENT_DATE OR ii.status = ${EXPIRED_STATUS})
          AND sa.sub_department IS NOT NULL
          AND ii.status <> ALL(${[...DISPOSITIONED_STATUSES]})
          AND ii.organization_id = ${organizationId}
        GROUP BY sa.sub_department
        ORDER BY "totalLoss" DESC
        LIMIT 5
      `) as LossByDepartmentReportItem[];
    },

    // Write-off ledger reports for /api/expired-items/reports/expired-losses
    // (ExpiredLossReport). These sum REALIZED losses from expired_item_transactions,
    // mirroring the SQLite backend's expired-item.service getFinancialLosses* methods.
    async getExpiredLossBySku(organizationId: string): Promise<LossBySkuReportItem[]> {
      return (await sql`
        SELECT
          COALESCE(p.sku, '') as sku,
          p.name as "productName",
          COALESCE(SUM(eit.financial_loss), 0) as "totalLoss",
          COALESCE(SUM(eit.units_discarded), 0)::int as count
        FROM expired_item_transactions eit
        JOIN inventory_items ii ON eit.inventory_item_id = ii.id
        JOIN products p ON ii.product_id = p.id
        WHERE eit.action = 'expired'
          AND eit.organization_id = ${organizationId}
        GROUP BY p.sku, p.name
        ORDER BY "totalLoss" DESC
        LIMIT 10
      `) as LossBySkuReportItem[];
    },

    async getExpiredLossByStoreArea(
      organizationId: string,
    ): Promise<ExpiredLossByStoreAreaItem[]> {
      // Frontend reads `locationName`; group by store-area name to match the
      // SQLite backend's getFinancialLossesByStoreArea.
      return (await sql`
        SELECT
          sa.name as "locationName",
          COALESCE(SUM(eit.financial_loss), 0) as "totalLoss",
          COALESCE(SUM(eit.units_discarded), 0)::int as count
        FROM expired_item_transactions eit
        JOIN inventory_items ii ON eit.inventory_item_id = ii.id
        JOIN store_areas sa ON ii.location_id = sa.id
        WHERE eit.action = 'expired'
          AND eit.organization_id = ${organizationId}
        GROUP BY sa.id, sa.name
        ORDER BY "totalLoss" DESC
      `) as ExpiredLossByStoreAreaItem[];
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
          MIN(ii.id) as id,
          ii.product_id as "productId",
          p.name as "productName",
          COALESCE(p.sku, '') as sku,
          MIN(ii.expiry_date)::text as "expiryDate",
          -- The write-off matcher pools rows by product/location/cost_price (not status)
          -- and processes earliest-expiry first, so a row must represent that whole pool.
          -- Grouping by status here would split it and let the user act on a status that
          -- isn't the one actually processed. Show the earliest-expiry item's status.
          (array_agg(ii.status ORDER BY ii.expiry_date ASC, ii.id ASC))[1] as status,
          COALESCE(p.cost_price, 0) as "costPrice",
          ii.location_id as "locationId",
          sa.name as "locationName",
          COUNT(*)::int as "quantityAvailable"
        FROM inventory_items ii
        JOIN products p ON ii.product_id = p.id
        JOIN store_areas sa ON ii.location_id = sa.id
        WHERE (ii.expiry_date < CURRENT_DATE
          OR ii.status = ANY(${[...EXPIRED_WORKLIST_STATUSES]}))
          AND ii.organization_id = ${organizationId}
          AND ii.status <> ALL(${[...DISPOSITIONED_STATUSES]})
        GROUP BY ii.product_id, p.name, p.sku, p.cost_price, ii.location_id, sa.name
        ORDER BY MIN(ii.expiry_date) ASC
      `) as ExpiredItemRow[];
    },

    async processExpiredItem(
      inventoryItemId: number,
      userId: number,
      organizationId: string,
      action: string,
      unitsDiscarded?: number,
    ): Promise<ExpiredItemTransaction> {
      const context = await getInventoryProcessContext(
        sql,
        inventoryItemId,
        organizationId,
        action === 'expired' ? unitsDiscarded : undefined,
      );
      const markdownLevel = reportMarkdownLevel(context.daysToExpiry);
      const processedItemIds = await getProcessedItemIds(
        sql,
        organizationId,
        inventoryItemId,
        action,
        unitsDiscarded,
        context,
      );

      // Preserve the disposition's meaning on the inventory row: sold-through stays
      // 'Sold Through', expired write-offs become 'Processed' (matching the SQLite
      // backend). Both are excluded from the worklist; collapsing expired items to
      // 'Sold Through' would mislabel waste as a sale for any status-based consumer.
      const dispositionStatus =
        action === 'expired' ? SQLITE_PROCESSED_STATUS : WORKERS_SOLD_THROUGH_STATUS;

      // Disposition (status update) and ledger insert must be atomic: Neon's HTTP
      // driver autocommits each `sql` tag separately, so running them as two
      // statements can tear — the UPDATE commits, the INSERT fails, and the item
      // is silently removed from the worklist with no matching loss recorded.
      // A single data-modifying CTE runs both in one implicit transaction, so any
      // INSERT failure rolls the status change back with it. Postgres always runs
      // data-modifying WITH clauses to completion even when unreferenced. #268
      const rows = await sql`
        WITH disposed AS (
          UPDATE inventory_items
          SET status = ${dispositionStatus}, updated_at = NOW()
          WHERE id = ANY(${processedItemIds})
            AND organization_id = ${organizationId}
          RETURNING id
        )
        INSERT INTO expired_item_transactions
          (organization_id, inventory_item_id, user_id, action, units_discarded, financial_loss, markdown_level, transaction_date, created_at, updated_at)
        VALUES
          (${organizationId}, ${inventoryItemId}, ${userId}, ${action}, ${unitsDiscarded ?? null}, ${action === 'expired' ? context.financialLoss : null}, ${markdownLevel}, NOW(), NOW(), NOW())
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
