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
import type { CreditType } from '../../shared/domain/supplier-policy';
import {
  buildCatalogueProvenanceResponse,
  type CatalogueProvenanceResponse,
} from '../../shared/domain/platform-catalogue';
import { resolveSupplierContext, type BrandSource } from '../../shared/domain/brand-supplier';
import type {
  Brand as SharedBrand,
  BrandReviewItem,
  BrandReviewOptions,
  BrandReviewPage,
} from '../../shared/domain/catalogue-review';
import {
  resolveMarkdownCreditContext,
  type MarkdownCreditContext,
} from '../../shared/domain/markdown-credit-context';
import {
  resolveBayState,
  rollupCoverage,
  type BayCheckForCycle,
  type CoverageSummary,
  type StoreWalkBay,
} from '../../shared/domain/store-walk-tracking';
import {
  buildStoreWalkAuditReport,
  type StoreWalkAuditCycle,
  type StoreWalkAuditCycleRow,
  type StoreWalkAuditUserRow,
} from '../../shared/domain/store-walk-audit';
import {
  rollupRecoveryReport,
  rollupClaimablePool,
  type ClaimablePoolGroup,
  type RecoveryClaimRow,
  type RecoveryReport,
} from '../../shared/domain/credit-claim';
import { createSupplierCreditDatabase } from './supplier-credit-database';

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
  getActiveExpiryEntries(organizationId: string): Promise<DetailedExpiryReportItem[]>;
  getDailyUsageReport(organizationId: string): Promise<DailyUsageReportItem[]>;
  getItemsByUserReport(
    organizationId: string,
    timeFrameDays?: string,
  ): Promise<ItemsByUserReportItem[]>;
  getItemsByDateReport(organizationId: string): Promise<ItemsByDateReportItem[]>;
  getStoreWalkAuditReport(organizationId: string): Promise<StoreWalkAuditCycle[]>;
  getLossBySkuReport(organizationId: string): Promise<LossBySkuReportItem[]>;
  getLossByDepartmentReport(organizationId: string): Promise<LossByDepartmentReportItem[]>;
  getExpiredLossBySku(organizationId: string): Promise<LossBySkuReportItem[]>;
  getExpiredLossByStoreArea(organizationId: string): Promise<ExpiredLossByStoreAreaItem[]>;
  getSellThroughByMarkdownLevel(organizationId: string): Promise<SellThroughByLevelItem[]>;

  // Supplier credit-claim queries
  listSuppliers(organizationId: string): Promise<Supplier[]>;
  findSupplier(organizationId: string, id: number): Promise<Supplier | null>;
  createSupplier(organizationId: string, data: SupplierWriteData): Promise<Supplier>;
  updateSupplier(
    organizationId: string,
    id: number,
    data: SupplierWriteData,
  ): Promise<Supplier | null>;
  clearSupplierPolicy(organizationId: string, id: number): Promise<Supplier | null>;
  listPolicyReview(
    organizationId: string,
    options: PolicyReviewOptions,
  ): Promise<PolicyReviewItem[]>;
  bulkAttachSupplier(
    organizationId: string,
    supplierId: number,
    brandIds: number[],
    createdByUserId: number,
  ): Promise<BulkAttachResult>;
  bulkLinkProducts(
    organizationId: string,
    target: { brandId?: number; brandName?: string },
    productIds: number[],
    createdByUserId: number,
  ): Promise<BulkLinkResult>;
  listBrands(organizationId: string): Promise<Brand[]>;
  reviewBrands(organizationId: string, options: BrandReviewOptions): Promise<BrandReviewPage>;
  addBrand(
    organizationId: string,
    userId: number,
    data: { productId: number; name: string; supplierId: number | null },
  ): Promise<Brand | null>;
  confirmBrandSupplier(
    organizationId: string,
    brandId: number,
    supplierId: number,
  ): Promise<Brand | null>;
  assignProductSupplier(
    organizationId: string,
    userId: number,
    productId: number,
    supplierId: number | null,
  ): Promise<boolean>;
  disposeClaimableWriteOff(
    organizationId: string,
    transactionId: number,
  ): Promise<'DISPOSED' | 'ALREADY_DISPOSED' | 'CLAIMED' | 'NOT_FOUND'>;
  listCatalogueCorrections(options: {
    status: string;
    cursor?: number;
    limit: number;
  }): Promise<{ items: CatalogueCorrection[]; nextCursor: number | null }>;
  getCatalogueProvenance(): Promise<CatalogueProvenanceResponse>;
  reviewCatalogueCorrection(
    id: number,
    status: 'ACCEPTED' | 'REJECTED',
  ): Promise<'UPDATED' | 'ALREADY_REVIEWED' | 'NOT_FOUND'>;
  getClaimablePool(organizationId: string): Promise<ClaimablePoolGroup[]>;
  getRecoveryReport(organizationId: string): Promise<RecoveryReport>;
  listCreditClaims(organizationId: string, statuses?: string[]): Promise<CreditClaim[]>;

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
    data: { name: string; subDepartment?: string | null; parentId?: number | null },
  ): Promise<StoreArea>;
  updateStoreArea(
    organizationId: string,
    id: number,
    data: { name?: string; subDepartment?: string | null; parentId?: number | null },
  ): Promise<StoreArea | null>;
  deleteStoreArea(organizationId: string, id: number): Promise<boolean>;

  // Store walk tracking
  listCheckCycles(organizationId: string): Promise<CheckCycle[]>;
  createCheckCycle(
    organizationId: string,
    data: { name: string; startedAt?: string },
  ): Promise<CheckCycle>;
  completeCheckCycle(organizationId: string, id: number): Promise<CheckCycle>;
  recordBayCheck(
    organizationId: string,
    userId: number,
    data: {
      storeAreaId: number;
      checkedAt?: string;
      itemsAddedCount?: number;
      notes?: string | null;
    },
  ): Promise<BayCheck>;
  getFloorProgress(organizationId: string): Promise<FloorProgress>;

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
export interface Product extends MarkdownCreditContext {
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
  parentId: number | null;
  lastChecked: Date | string | null;
  createdAt: Date;
  updatedAt: Date;
  description?: string | null;
}

export interface Supplier {
  id: number;
  name: string;
  creditType: CreditType;
  contactEmail: string | null;
  contactPhone: string | null;
  creditPolicyNote: string;
  policyWriteOffQty: number | null;
  policyCreditQty: number | null;
  followUpDays: number;
  representativeName: string | null;
  representativeEmail: string | null;
  policyUpdatedAt: Date | string | null;
}

export type SupplierWriteData = Omit<Supplier, 'id'>;

export interface PolicyReviewOptions {
  brand?: string;
  supplier?: string;
  status?: 'ATTACHED' | 'MISSING';
}

export interface PolicyReviewItem {
  brandId: number;
  brandName: string;
  supplier: Supplier | null;
  status: 'ATTACHED' | 'MISSING';
  policyUpdatedAt: Date | string | null;
  representativeName: string | null;
}

export type BulkAttachResult =
  | { kind: 'SUCCESS'; attached: number; unchanged: number; corrections: number }
  | { kind: 'SUPPLIER_NOT_FOUND' | 'SUPPLIER_POLICY_MISSING' | 'BRAND_NOT_FOUND' };

export type BulkLinkResult =
  | {
      kind: 'SUCCESS';
      brandId: number;
      linked: number;
      alreadyLinked: number;
      corrections: number;
    }
  | { kind: 'BRAND_NOT_FOUND' | 'PRODUCT_NOT_FOUND' | 'BRAND_CONFLICT' };

export type Brand = SharedBrand<Supplier>;

function mapBrandReviewRows(rows: Array<Record<string, unknown>>): BrandReviewItem[] {
  return rows.map((row) => ({
    productId: Number(row.productId),
    sku: String(row.sku ?? ''),
    barcode: String(row.barcode ?? ''),
    productName: String(row.productName ?? ''),
    brand:
      row.brandId == null
        ? null
        : {
            id: Number(row.brandId),
            name: String(row.brandName),
            manufacturerName: (row.manufacturerName as string | null) ?? null,
            suggestedSupplierName: (row.suggestedSupplierName as string | null) ?? null,
            supplierId: row.brandSupplierId == null ? null : Number(row.brandSupplierId),
            source: String(row.brandSource) as BrandSource,
          },
  }));
}

export interface CatalogueCorrection {
  id: number;
  organizationId: string;
  productId: number | null;
  brandId: number | null;
  barcode: string | null;
  enteredBrandName: string | null;
  chosenSupplierId: number | null;
  chosenSupplier: { id: number; name: string } | null;
  kind: string;
  status: string;
  createdByUserId: number | null;
  createdAt: string;
  organization: { id: string; name: string };
}

export interface CreditClaimPhoto {
  id: number;
  fileName: string;
  sizeBytes: number;
}

export interface CreditClaimLine {
  id: number;
  expiredItemTransactionId: number;
  batchNumber: string | null;
  unitsClaimed: number;
  expectedCreditUnits: number | null;
  expectedCreditValue: number | null;
  photos: CreditClaimPhoto[];
}

export interface CreditClaimEvent {
  id: number;
  type: string;
  note: string | null;
  createdAt: string;
}

export interface CreditClaim {
  id: number;
  supplierId: number;
  status: string;
  contactEmailSnapshot: string | null;
  expectedCreditUnits: number | null;
  expectedCreditValue: number | null;
  creditedValue: number | null;
  sentAt: string | null;
  nextFollowUpAt: string | null;
  followUpCount: number;
  settledAt: string | null;
  supplier: Supplier;
  lines: CreditClaimLine[];
  events: CreditClaimEvent[];
}

export interface CheckCycle {
  id: number;
  organizationId: string;
  name: string;
  status: 'active' | 'completed';
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BayCheck {
  id: number;
  organizationId: string;
  cycleId: number;
  storeAreaId: number;
  userId: number | null;
  checkedAt: string;
  itemsAddedCount: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FloorProgressBay {
  id: number;
  name: string;
  parentId: number | null;
  state: 'checked' | 'not_checked' | 'overdue';
  checkedAt: string | null;
  checkedBy: { id: number; name: string | null } | null;
}

export interface FloorProgressSummary extends CoverageSummary {
  uncheckedBays: number;
}

export interface FloorProgressDepartment {
  department: { id: number | null; name: string };
  summary: FloorProgressSummary;
  bays: FloorProgressBay[];
}

export interface FloorProgress {
  activeCycle: CheckCycle | null;
  summary: FloorProgressSummary;
  departments: FloorProgressDepartment[];
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

export type {
  StoreWalkAuditCycle,
  StoreWalkAuditFlag,
  StoreWalkAuditUser,
} from '../../shared/domain/store-walk-audit';

export interface DetailedExpiryReportItem extends MarkdownCreditContext {
  inventoryId: number;
  expiryDate: string;
  status: string;
  productId: number;
  productName: string;
  sku: string;
  costPrice: number;
  retailPrice: number | null;
  locationId: number;
  locationName: string;
  subDepartment: string | null;
}

function mapCreditContext(row: Record<string, unknown>): MarkdownCreditContext {
  const supplier = (prefix: 'productSupplier' | 'brandSupplier') =>
    row[`${prefix}Id`] == null
      ? null
      : {
          id: Number(row[`${prefix}Id`]),
          name: (row[`${prefix}Name`] as string | null) ?? null,
          hasPolicy: Boolean(String(row[`${prefix}PolicyNote`] ?? '').trim()),
          creditType: row[`${prefix}CreditType`] === 'FULL_CREDIT' ? 'FULL_CREDIT' : 'NONE',
        };
  return resolveMarkdownCreditContext(
    resolveSupplierContext({
      productSupplier: supplier('productSupplier'),
      brand:
        row.brandId == null
          ? null
          : {
              id: Number(row.brandId),
              name: (row.brandName as string | null) ?? null,
              source: (row.brandSource as string | null) ?? null,
              suggestedSupplierName: (row.suggestedSupplierName as string | null) ?? null,
              supplier: supplier('brandSupplier'),
            },
    }),
  );
}

function mapCreditContextRow<T>(row: Record<string, unknown>): T & MarkdownCreditContext {
  return { ...(row as T), ...mapCreditContext(row) };
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

function toIsoStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toFloorProgressSummary(summary: CoverageSummary): FloorProgressSummary {
  return {
    ...summary,
    uncheckedBays: summary.notCheckedBays + summary.overdueBays,
  };
}

function toCheckCycle(row: Record<string, unknown>): CheckCycle {
  return {
    id: Number(row.id),
    organizationId: String(row.organizationId),
    name: String(row.name),
    status: row.status as CheckCycle['status'],
    startedAt: toIsoStringOrNull(row.startedAt) ?? '',
    completedAt: toIsoStringOrNull(row.completedAt),
    createdAt: toIsoStringOrNull(row.createdAt) ?? '',
    updatedAt: toIsoStringOrNull(row.updatedAt) ?? '',
  };
}

function toBayCheck(row: Record<string, unknown>): BayCheck {
  return {
    id: Number(row.id),
    organizationId: String(row.organizationId),
    cycleId: Number(row.cycleId),
    storeAreaId: Number(row.storeAreaId),
    userId: toNumberOrNull(row.userId),
    checkedAt: toIsoStringOrNull(row.checkedAt) ?? '',
    itemsAddedCount: Number(row.itemsAddedCount),
    notes: row.notes === null || row.notes === undefined ? null : String(row.notes),
    createdAt: toIsoStringOrNull(row.createdAt) ?? '',
    updatedAt: toIsoStringOrNull(row.updatedAt) ?? '',
  };
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
    ...createSupplierCreditDatabase(sql),

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
               parent_id as "parentId",
               sub_department as "subDepartment",
               last_checked as "lastChecked",
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
    async getLastCatalogueUpload(organizationId: string): Promise<LastCatalogueUpload | null> {
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
      return (
        (await sql`
        SELECT
          ii.id as "inventoryId",
          ii.expiry_date::text as "expiryDate",
          ii.status,
          p.id as "productId",
          p.name as "productName",
          COALESCE(p.sku, '') as sku,
          COALESCE(p.cost_price, 0) as "costPrice",
          p.retail_price as "retailPrice",
          ps.id AS "productSupplierId",
          ps.name AS "productSupplierName", ps.credit_policy_note AS "productSupplierPolicyNote",
          ps.credit_type AS "productSupplierCreditType",
          b.id AS "brandId", b.name AS "brandName", b.source AS "brandSource",
          b.suggested_supplier_name AS "suggestedSupplierName",
          bs.id AS "brandSupplierId", bs.name AS "brandSupplierName",
          bs.credit_policy_note AS "brandSupplierPolicyNote",
          bs.credit_type AS "brandSupplierCreditType",
          sa.id as "locationId",
          sa.name as "locationName",
          sa.sub_department as "subDepartment"
        FROM inventory_items ii
        JOIN products p ON ii.product_id = p.id AND p.organization_id = ii.organization_id
        LEFT JOIN suppliers ps ON ps.id = p.supplier_id AND ps.organization_id = p.organization_id
        LEFT JOIN brands b ON b.id = p.brand_id AND b.organization_id = p.organization_id
        LEFT JOIN suppliers bs ON bs.id = b.supplier_id AND bs.organization_id = b.organization_id
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
      `) as Array<Record<string, unknown>>
      ).map((row) => mapCreditContextRow<DetailedExpiryReportItem>(row));
    },

    async getActiveExpiryEntries(organizationId: string): Promise<DetailedExpiryReportItem[]> {
      return (
        (await sql`
        SELECT
          ii.id as "inventoryId",
          ii.expiry_date::text as "expiryDate",
          ii.status,
          p.id as "productId",
          p.name as "productName",
          COALESCE(p.sku, '') as sku,
          COALESCE(p.cost_price, 0) as "costPrice",
          p.retail_price as "retailPrice",
          ps.id AS "productSupplierId",
          ps.name AS "productSupplierName", ps.credit_policy_note AS "productSupplierPolicyNote",
          ps.credit_type AS "productSupplierCreditType",
          b.id AS "brandId", b.name AS "brandName", b.source AS "brandSource",
          b.suggested_supplier_name AS "suggestedSupplierName",
          bs.id AS "brandSupplierId", bs.name AS "brandSupplierName",
          bs.credit_policy_note AS "brandSupplierPolicyNote",
          bs.credit_type AS "brandSupplierCreditType",
          sa.id as "locationId",
          sa.name as "locationName",
          sa.sub_department as "subDepartment"
        FROM inventory_items ii
        JOIN products p ON ii.product_id = p.id AND p.organization_id = ii.organization_id
        LEFT JOIN suppliers ps ON ps.id = p.supplier_id AND ps.organization_id = p.organization_id
        LEFT JOIN brands b ON b.id = p.brand_id AND b.organization_id = p.organization_id
        LEFT JOIN suppliers bs ON bs.id = b.supplier_id AND bs.organization_id = b.organization_id
        JOIN store_areas sa ON ii.location_id = sa.id
        WHERE ii.expiry_date >= CURRENT_DATE
          AND ii.organization_id = ${organizationId}
          -- Exclude items already dispositioned via sold-through so they do not
          -- reappear after refresh. 'Sold Through' is the workers marker;
          -- 'Processed' is the SQLite backend marker.
          AND ii.status <> ALL(${[...DISPOSITIONED_STATUSES]})
        -- ii.id tiebreaker keeps ordering deterministic across engines, matching
        -- getDetailedExpiryReport.
        ORDER BY ii.expiry_date ASC, ii.id ASC
      `) as Array<Record<string, unknown>>
      ).map((row) => mapCreditContextRow<DetailedExpiryReportItem>(row));
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
        if (!Number.isNaN(days) && days > 0) {
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

    async getStoreWalkAuditReport(organizationId: string): Promise<StoreWalkAuditCycle[]> {
      const totalBayRows = (await sql`
        SELECT COUNT(*)::int as count
        FROM store_areas
        WHERE organization_id = ${organizationId}
          AND parent_id IS NOT NULL
      `) as Array<{ count: number }>;
      const totalBays = Number(totalBayRows[0]?.count ?? 0);

      const cycleRows = (await sql`
        SELECT id as "cycleId",
               name as "cycleName",
               status,
               CASE
                 WHEN completed_at IS NULL THEN NULL
                 ELSE ROUND(EXTRACT(EPOCH FROM (completed_at - started_at)) / 60)::int
               END as "completionMinutes"
        FROM check_cycles
        WHERE organization_id = ${organizationId}
        ORDER BY started_at DESC, id DESC
        LIMIT 12
      `) as Array<{
        cycleId: number;
        cycleName: string;
        status: string;
        completionMinutes: number | null;
      }>;

      const userRows = (await sql`
        SELECT bc.cycle_id as "cycleId",
               COALESCE(u.id, bc.user_id, 0) as "userId",
               COALESCE(u.username, u.email, 'Unknown user') as "userName",
               COUNT(DISTINCT bc.store_area_id)::int as "baysChecked",
               GREATEST(
                 EXTRACT(EPOCH FROM (MAX(bc.checked_at) - MIN(bc.checked_at))) / 3600,
                 1.0 / 60.0
               ) as "elapsedHours",
               SUM(CASE WHEN bc.items_added_count = 0 THEN 1 ELSE 0 END)::int as "zeroFindingChecks"
        FROM bay_checks bc
        LEFT JOIN users u ON bc.user_id = u.id
        WHERE bc.organization_id = ${organizationId}
        GROUP BY bc.cycle_id, COALESCE(u.id, bc.user_id, 0), COALESCE(u.username, u.email, 'Unknown user')
        ORDER BY bc.cycle_id DESC, "baysChecked" DESC
      `) as Array<{
        cycleId: number;
        userId: number;
        userName: string;
        baysChecked: number;
        elapsedHours: number | string;
        zeroFindingChecks: number;
      }>;

      // Postgres already computed completionMinutes and elapsedHours in SQL; the
      // shared rollup only needs elapsedHours coerced to a number (the numeric
      // GREATEST(...) can arrive as a string over the wire).
      const auditUserRows: StoreWalkAuditUserRow[] = userRows.map((row) => ({
        cycleId: row.cycleId,
        userId: row.userId,
        userName: row.userName,
        baysChecked: row.baysChecked,
        elapsedHours: Number(row.elapsedHours),
        zeroFindingChecks: row.zeroFindingChecks,
      }));

      return buildStoreWalkAuditReport(cycleRows, auditUserRows, totalBays);
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

    async getExpiredLossByStoreArea(organizationId: string): Promise<ExpiredLossByStoreAreaItem[]> {
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

    async listBrands(organizationId: string): Promise<Brand[]> {
      const rows = (await sql`
        SELECT b.id, b.name,
               b.manufacturer_name AS "manufacturerName",
               b.suggested_supplier_name AS "suggestedSupplierName",
               b.supplier_id AS "supplierId", b.source,
               COUNT(p.id)::int AS "productCount"
        FROM brands b
        LEFT JOIN products p ON p.brand_id = b.id AND p.organization_id = b.organization_id
        WHERE b.organization_id = ${organizationId}
        GROUP BY b.id
        ORDER BY b.suggested_supplier_name ASC NULLS LAST, b.name ASC, b.id ASC
      `) as Array<Record<string, unknown>>;
      return rows.map((row) => ({
        id: Number(row.id),
        name: String(row.name),
        manufacturerName: (row.manufacturerName as string | null) ?? null,
        suggestedSupplierName: (row.suggestedSupplierName as string | null) ?? null,
        supplierId: row.supplierId == null ? null : Number(row.supplierId),
        source: String(row.source) as BrandSource,
        productCount: Number(row.productCount ?? 0),
      }));
    },

    async reviewBrands(organizationId, options): Promise<BrandReviewPage> {
      const state = options.state ?? null;
      const group = options.group ?? null;
      if (options.page != null) {
        const page = options.page;
        const pageSize = options.pageSize ?? 50;
        const title = options.title ?? null;
        const titleMatch = options.titleMatch ?? 'contains';
        const sort = options.sort ?? 'titleAsc';
        const counts = await sql`
          SELECT COUNT(*) AS "totalItems"
          FROM products p
          LEFT JOIN brands b ON b.id = p.brand_id AND b.organization_id = p.organization_id
          WHERE p.organization_id = ${organizationId}
            AND (${state}::text IS NULL
              OR (${state} = 'NEEDS_BRAND' AND p.brand_id IS NULL)
              OR (${state} = 'PENDING_CONFIRMATION' AND b.source = 'REFERENCE')
              OR (${state} = 'CONFIRMED' AND b.source IN ('USER_ADDED', 'CONFIRMED') AND b.supplier_id IS NOT NULL))
            AND (${group}::text IS NULL OR b.suggested_supplier_name = ${group})
            AND (${title}::text IS NULL
              OR (${titleMatch} = 'startsWith' AND p.name ILIKE ${title} || '%')
              OR (${titleMatch} = 'contains' AND p.name ILIKE '%' || ${title} || '%'))
        `;
        const rows = (await sql`
          SELECT p.id AS "productId", p.sku, p.barcode, p.name AS "productName",
                 b.id AS "brandId", b.name AS "brandName",
                 b.manufacturer_name AS "manufacturerName",
                 b.suggested_supplier_name AS "suggestedSupplierName",
                 b.supplier_id AS "brandSupplierId", b.source AS "brandSource"
          FROM products p
          LEFT JOIN brands b ON b.id = p.brand_id AND b.organization_id = p.organization_id
          WHERE p.organization_id = ${organizationId}
            AND (${state}::text IS NULL
              OR (${state} = 'NEEDS_BRAND' AND p.brand_id IS NULL)
              OR (${state} = 'PENDING_CONFIRMATION' AND b.source = 'REFERENCE')
              OR (${state} = 'CONFIRMED' AND b.source IN ('USER_ADDED', 'CONFIRMED') AND b.supplier_id IS NOT NULL))
            AND (${group}::text IS NULL OR b.suggested_supplier_name = ${group})
            AND (${title}::text IS NULL
              OR (${titleMatch} = 'startsWith' AND p.name ILIKE ${title} || '%')
              OR (${titleMatch} = 'contains' AND p.name ILIKE '%' || ${title} || '%'))
          ORDER BY
            CASE WHEN ${sort} = 'titleAsc' THEN LOWER(p.name) END ASC,
            CASE WHEN ${sort} = 'titleDesc' THEN LOWER(p.name) END DESC,
            p.id ASC
          LIMIT ${pageSize}
          OFFSET ${(page - 1) * pageSize}
        `) as Array<Record<string, unknown>>;
        const totalItems = Number(counts[0]?.totalItems ?? 0);
        return {
          items: mapBrandReviewRows(rows),
          page,
          pageSize,
          totalItems,
          totalPages: Math.ceil(totalItems / pageSize),
          nextCursor: null,
        };
      }

      const cursor = options.cursor ?? 0;
      const limit = options.limit ?? 50;
      const rows = (await sql`
        SELECT p.id AS "productId", p.sku, p.barcode, p.name AS "productName",
               b.id AS "brandId", b.name AS "brandName",
               b.manufacturer_name AS "manufacturerName",
               b.suggested_supplier_name AS "suggestedSupplierName",
               b.supplier_id AS "brandSupplierId", b.source AS "brandSource"
        FROM products p
        LEFT JOIN brands b ON b.id = p.brand_id AND b.organization_id = p.organization_id
        WHERE p.organization_id = ${organizationId}
          AND p.id > ${cursor}
          AND (${state}::text IS NULL
            OR (${state} = 'NEEDS_BRAND' AND p.brand_id IS NULL)
            OR (${state} = 'PENDING_CONFIRMATION' AND b.source = 'REFERENCE')
            OR (${state} = 'CONFIRMED' AND b.source IN ('USER_ADDED', 'CONFIRMED') AND b.supplier_id IS NOT NULL))
          AND (${group}::text IS NULL OR b.suggested_supplier_name = ${group})
        ORDER BY p.id ASC
        LIMIT ${limit + 1}
      `) as Array<Record<string, unknown>>;
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      return {
        items: mapBrandReviewRows(page),
        nextCursor: hasMore ? Number(page[page.length - 1]?.productId) : null,
      };
    },

    async addBrand(organizationId, userId, data): Promise<Brand | null> {
      const rows = (await sql`
        WITH product_target AS (
          SELECT id, barcode FROM products
          WHERE id = ${data.productId} AND organization_id = ${organizationId}
        ), valid_supplier AS (
          SELECT id FROM suppliers
          WHERE id = ${data.supplierId}::integer AND organization_id = ${organizationId}
        ), brand_row AS (
          INSERT INTO brands (
            organization_id, name, supplier_id, source, created_at, updated_at
          )
          SELECT ${organizationId}, ${data.name}, ${data.supplierId}::integer,
                 'USER_ADDED', NOW(), NOW()
          FROM product_target
          WHERE ${data.supplierId}::integer IS NULL OR EXISTS (SELECT 1 FROM valid_supplier)
          ON CONFLICT (organization_id, name) DO UPDATE SET
            supplier_id = EXCLUDED.supplier_id, source = 'USER_ADDED', updated_at = NOW()
          RETURNING id, name, manufacturer_name, suggested_supplier_name, supplier_id, source
        ), attached AS (
          UPDATE products p SET brand_id = b.id, updated_at = NOW()
          FROM brand_row b, product_target pt
          WHERE p.id = pt.id AND p.organization_id = ${organizationId}
          RETURNING p.id, p.barcode
        ), correction AS (
          INSERT INTO catalogue_corrections (
            organization_id, product_id, brand_id, barcode, entered_brand_name,
            chosen_supplier_id, kind, status, created_by_user_id, created_at, updated_at
          )
          SELECT ${organizationId}, a.id, b.id, NULLIF(BTRIM(a.barcode), ''), b.name,
                 ${data.supplierId}::integer, 'BRAND_ADDED', 'PENDING', ${userId}, NOW(), NOW()
          FROM attached a CROSS JOIN brand_row b
          RETURNING id
        )
        SELECT id, name, manufacturer_name AS "manufacturerName",
               suggested_supplier_name AS "suggestedSupplierName",
               supplier_id AS "supplierId", source
        FROM brand_row
      `) as Array<Record<string, unknown>>;
      const row = rows[0];
      return row
        ? {
            id: Number(row.id),
            name: String(row.name),
            manufacturerName: (row.manufacturerName as string | null) ?? null,
            suggestedSupplierName: (row.suggestedSupplierName as string | null) ?? null,
            supplierId: row.supplierId == null ? null : Number(row.supplierId),
            source: String(row.source) as BrandSource,
          }
        : null;
    },

    async confirmBrandSupplier(organizationId, brandId, supplierId): Promise<Brand | null> {
      const rows = (await sql`
        UPDATE brands b SET supplier_id = s.id, source = 'CONFIRMED', updated_at = NOW()
        FROM suppliers s
        WHERE b.id = ${brandId} AND b.organization_id = ${organizationId}
          AND s.id = ${supplierId} AND s.organization_id = ${organizationId}
        RETURNING b.id, b.name, b.manufacturer_name AS "manufacturerName",
                  b.suggested_supplier_name AS "suggestedSupplierName",
                  b.supplier_id AS "supplierId", b.source
      `) as Array<Record<string, unknown>>;
      const row = rows[0];
      return row
        ? {
            id: Number(row.id),
            name: String(row.name),
            manufacturerName: (row.manufacturerName as string | null) ?? null,
            suggestedSupplierName: (row.suggestedSupplierName as string | null) ?? null,
            supplierId: Number(row.supplierId),
            source: String(row.source) as BrandSource,
          }
        : null;
    },

    async assignProductSupplier(organizationId, userId, productId, supplierId): Promise<boolean> {
      const rows = await sql`
        WITH valid_supplier AS (
          SELECT id FROM suppliers
          WHERE id = ${supplierId}::integer AND organization_id = ${organizationId}
        ), updated AS (
          UPDATE products p SET supplier_id = ${supplierId}::integer, updated_at = NOW()
          WHERE p.id = ${productId} AND p.organization_id = ${organizationId}
            AND (${supplierId}::integer IS NULL OR EXISTS (SELECT 1 FROM valid_supplier))
          RETURNING p.id, p.barcode, p.brand_id
        ), correction AS (
          INSERT INTO catalogue_corrections (
            organization_id, product_id, brand_id, barcode, chosen_supplier_id,
            kind, status, created_by_user_id, created_at, updated_at
          )
          SELECT ${organizationId}, u.id, u.brand_id, NULLIF(BTRIM(u.barcode), ''),
                 ${supplierId}::integer, 'SUPPLIER_OVERRIDE', 'PENDING', ${userId}, NOW(), NOW()
          FROM updated u WHERE ${supplierId}::integer IS NOT NULL
          RETURNING id
        )
        SELECT id FROM updated
      `;
      return rows.length > 0;
    },

    async disposeClaimableWriteOff(organizationId, transactionId) {
      const rows = (await sql`
        WITH target AS (
          SELECT eit.id, eit.credit_disposition,
                 EXISTS (SELECT 1 FROM credit_claim_lines ccl
                         WHERE ccl.expired_item_transaction_id = eit.id) AS claimed
          FROM expired_item_transactions eit
          WHERE eit.id = ${transactionId} AND eit.organization_id = ${organizationId}
            AND eit.action = 'expired'
        ), updated AS (
          UPDATE expired_item_transactions eit SET credit_disposition = 'DISPOSED', updated_at = NOW()
          FROM target t
          WHERE eit.id = t.id AND NOT t.claimed AND t.credit_disposition <> 'DISPOSED'
          RETURNING eit.id
        )
        SELECT CASE
          WHEN NOT EXISTS (SELECT 1 FROM target) THEN 'NOT_FOUND'
          WHEN (SELECT claimed FROM target) THEN 'CLAIMED'
          WHEN EXISTS (SELECT 1 FROM updated) THEN 'DISPOSED'
          ELSE 'ALREADY_DISPOSED'
        END AS result
      `) as Array<{ result: 'DISPOSED' | 'ALREADY_DISPOSED' | 'CLAIMED' | 'NOT_FOUND' }>;
      return rows[0]?.result ?? 'NOT_FOUND';
    },

    async listCatalogueCorrections(options) {
      const cursor = options.cursor ?? 0;
      const rows = (await sql`
        SELECT cc.id, cc.organization_id AS "organizationId", cc.product_id AS "productId",
               cc.brand_id AS "brandId", cc.barcode,
               cc.entered_brand_name AS "enteredBrandName",
               cc.chosen_supplier_id AS "chosenSupplierId", cc.kind, cc.status,
               cc.created_by_user_id AS "createdByUserId", cc.created_at AS "createdAt",
               o.name AS "organizationName",
               s.id AS "chosenSupplierRecordId", s.name AS "chosenSupplierName"
        FROM catalogue_corrections cc
        JOIN organizations o ON o.id = cc.organization_id
        LEFT JOIN suppliers s ON s.id = cc.chosen_supplier_id
        WHERE cc.status = ${options.status} AND cc.id > ${cursor}
        ORDER BY cc.id ASC LIMIT ${options.limit + 1}
      `) as Array<Record<string, unknown>>;
      const hasMore = rows.length > options.limit;
      const page = hasMore ? rows.slice(0, options.limit) : rows;
      return {
        items: page.map((row) => ({
          id: Number(row.id),
          organizationId: String(row.organizationId),
          productId: row.productId == null ? null : Number(row.productId),
          brandId: row.brandId == null ? null : Number(row.brandId),
          barcode: (row.barcode as string | null) ?? null,
          enteredBrandName: (row.enteredBrandName as string | null) ?? null,
          chosenSupplierId: row.chosenSupplierId == null ? null : Number(row.chosenSupplierId),
          chosenSupplier:
            row.chosenSupplierRecordId == null
              ? null
              : {
                  id: Number(row.chosenSupplierRecordId),
                  name: String(row.chosenSupplierName),
                },
          kind: String(row.kind),
          status: String(row.status),
          createdByUserId: row.createdByUserId == null ? null : Number(row.createdByUserId),
          createdAt: String(row.createdAt),
          organization: {
            id: String(row.organizationId),
            name: String(row.organizationName),
          },
        })),
        nextCursor: hasMore ? Number(page[page.length - 1]?.id) : null,
      };
    },

    async getCatalogueProvenance() {
      const rows = (await sql`
        SELECT id, version, seeded_at AS "seededAt",
               source_file_name AS "sourceFileName",
               inserted, updated, unchanged, retired, reinstated,
               error_count AS "errorCount"
        FROM catalogue_seed_runs
        ORDER BY version DESC
        LIMIT 21
      `) as Array<{
        id: number | string;
        version: number | string;
        seededAt: Date | string;
        sourceFileName: string;
        inserted: number | string;
        updated: number | string;
        unchanged: number | string;
        retired: number | string;
        reinstated: number | string;
        errorCount: number | string;
      }>;
      return buildCatalogueProvenanceResponse(rows);
    },

    async reviewCatalogueCorrection(id, status) {
      const rows = (await sql`
        WITH updated AS (
          UPDATE catalogue_corrections SET status = ${status}, updated_at = NOW()
          WHERE id = ${id} AND status = 'PENDING'
          RETURNING id
        )
        SELECT CASE
          WHEN EXISTS (SELECT 1 FROM updated) THEN 'UPDATED'
          WHEN EXISTS (SELECT 1 FROM catalogue_corrections WHERE id = ${id})
            THEN 'ALREADY_REVIEWED'
          ELSE 'NOT_FOUND'
        END AS result
      `) as Array<{ result: 'UPDATED' | 'ALREADY_REVIEWED' | 'NOT_FOUND' }>;
      return rows[0]?.result ?? 'NOT_FOUND';
    },

    async getClaimablePool(organizationId: string): Promise<ClaimablePoolGroup[]> {
      // Expired write-offs not yet on a claim line, joined to product + supplier.
      // The shared rollup groups them (identically to the SQLite/Prisma backend).
      const rows = (await sql`
        SELECT eit.id AS "transactionId",
               s.id AS "supplierId",
               s.name AS "supplierName",
               s.policy_write_off_qty AS "policyWriteOffQty",
               s.policy_credit_qty AS "policyCreditQty",
               s.credit_policy_note AS "creditPolicyNote",
               b.id AS "brandId", b.name AS "brandName", b.source AS "brandSource",
               b.suggested_supplier_name AS "suggestedSupplierName",
               bs.id AS "brandSupplierId", bs.name AS "brandSupplierName",
               bs.policy_write_off_qty AS "brandPolicyWriteOffQty",
               bs.policy_credit_qty AS "brandPolicyCreditQty",
               bs.credit_policy_note AS "brandCreditPolicyNote",
               p.id AS "productId",
               COALESCE(p.sku, '') AS "sku",
               p.name AS "productName",
               COALESCE(eit.units_discarded, 0) AS "unitsDiscarded",
               COALESCE(p.cost_price, 0) AS "costPrice"
        FROM expired_item_transactions eit
        JOIN inventory_items ii ON ii.id = eit.inventory_item_id
        JOIN products p ON p.id = ii.product_id
        LEFT JOIN suppliers s ON s.id = p.supplier_id
        LEFT JOIN brands b ON b.id = p.brand_id AND b.organization_id = p.organization_id
        LEFT JOIN suppliers bs ON bs.id = b.supplier_id
        LEFT JOIN credit_claim_lines ccl ON ccl.expired_item_transaction_id = eit.id
        WHERE eit.organization_id = ${organizationId}
          AND eit.action = 'expired'
          AND eit.credit_disposition <> 'DISPOSED'
          AND ccl.id IS NULL
        ORDER BY eit.id ASC
      `) as Array<Record<string, unknown>>;

      return rollupClaimablePool(
        rows.map((row) => ({
          transactionId: Number(row.transactionId),
          supplierId: row.supplierId == null ? null : Number(row.supplierId),
          supplierName: (row.supplierName as string | null) ?? null,
          policyWriteOffQty: row.policyWriteOffQty == null ? null : Number(row.policyWriteOffQty),
          policyCreditQty: row.policyCreditQty == null ? null : Number(row.policyCreditQty),
          creditPolicyNote: (row.creditPolicyNote as string | null) ?? null,
          brandId: row.brandId == null ? null : Number(row.brandId),
          brandName: (row.brandName as string | null) ?? null,
          brandSource: (row.brandSource as string | null) ?? null,
          suggestedSupplierName: (row.suggestedSupplierName as string | null) ?? null,
          brandSupplierId: row.brandSupplierId == null ? null : Number(row.brandSupplierId),
          brandSupplierName: (row.brandSupplierName as string | null) ?? null,
          brandPolicyWriteOffQty:
            row.brandPolicyWriteOffQty == null ? null : Number(row.brandPolicyWriteOffQty),
          brandPolicyCreditQty:
            row.brandPolicyCreditQty == null ? null : Number(row.brandPolicyCreditQty),
          brandCreditPolicyNote: (row.brandCreditPolicyNote as string | null) ?? null,
          productId: Number(row.productId),
          sku: String(row.sku ?? ''),
          productName: String(row.productName ?? ''),
          unitsDiscarded: Number(row.unitsDiscarded),
          costPrice: Number(row.costPrice),
        })),
      );
    },

    async getRecoveryReport(organizationId: string): Promise<RecoveryReport> {
      const [claims, pool] = await Promise.all([
        sql`
          SELECT cc.supplier_id AS "supplierId",
                 s.name AS "supplierName",
                 cc.status,
                 cc.expected_credit_value AS "expectedCreditValue",
                 cc.credited_value AS "creditedValue"
          FROM credit_claims cc
          JOIN suppliers s ON s.id = cc.supplier_id
          WHERE cc.organization_id = ${organizationId}
            AND cc.sent_at IS NOT NULL
        `,
        this.getClaimablePool(organizationId),
      ]);

      const unclaimedValue = pool
        .filter((group) => group.supplierId != null)
        .reduce((sum, group) => sum + group.expectedCreditValueTotal, 0);

      return rollupRecoveryReport(
        (claims as Array<Record<string, unknown>>).map((row) => ({
          supplierId: Number(row.supplierId),
          supplierName: String(row.supplierName),
          status: String(row.status),
          expectedCreditValue:
            row.expectedCreditValue == null ? null : Number(row.expectedCreditValue),
          creditedValue: row.creditedValue == null ? null : Number(row.creditedValue),
        })) satisfies RecoveryClaimRow[],
        unclaimedValue,
      );
    },

    async listCreditClaims(organizationId: string, statuses?: string[]): Promise<CreditClaim[]> {
      const claimRows = (await sql`
        SELECT cc.id,
               cc.supplier_id AS "supplierId",
               cc.status,
               cc.contact_email_snapshot AS "contactEmailSnapshot",
               cc.expected_credit_units AS "expectedCreditUnits",
               cc.expected_credit_value AS "expectedCreditValue",
               cc.credited_value AS "creditedValue",
               cc.sent_at::text AS "sentAt",
               cc.next_follow_up_at::text AS "nextFollowUpAt",
               cc.follow_up_count AS "followUpCount",
               cc.settled_at::text AS "settledAt",
               s.id AS "supplier_id",
               s.name AS "supplier_name",
               s.credit_type AS "supplier_credit_type",
               s.contact_email AS "supplier_contact_email",
               s.contact_phone AS "supplier_contact_phone",
               s.credit_policy_note AS "supplier_credit_policy_note",
               s.policy_write_off_qty AS "supplier_policy_write_off_qty",
               s.policy_credit_qty AS "supplier_policy_credit_qty",
               s.follow_up_days AS "supplier_follow_up_days",
               s.representative_name AS "supplier_representative_name",
               s.representative_email AS "supplier_representative_email",
               s.policy_updated_at::text AS "supplier_policy_updated_at"
        FROM credit_claims cc
        JOIN suppliers s ON s.id = cc.supplier_id
        WHERE cc.organization_id = ${organizationId}
          AND (${statuses == null} OR cc.status = ANY(${statuses ?? []}))
        ORDER BY cc.id DESC
      `) as Array<Record<string, unknown>>;

      if (claimRows.length === 0) {
        return [];
      }

      const claimIds = claimRows.map((row) => Number(row.id));
      const [lineRows, photoRows, eventRows] = await Promise.all([
        sql`
          SELECT id,
                 claim_id AS "claimId",
                 expired_item_transaction_id AS "expiredItemTransactionId",
                 batch_number AS "batchNumber",
                 units_claimed AS "unitsClaimed",
                 expected_credit_units AS "expectedCreditUnits",
                 expected_credit_value AS "expectedCreditValue"
          FROM credit_claim_lines
          WHERE organization_id = ${organizationId}
            AND claim_id = ANY(${claimIds})
          ORDER BY id ASC
        `,
        sql`
          SELECT ccp.id,
                 ccl.claim_id AS "claimId",
                 ccp.claim_line_id AS "claimLineId",
                 ccp.file_name AS "fileName",
                 ccp.size_bytes AS "sizeBytes"
          FROM credit_claim_photos ccp
          JOIN credit_claim_lines ccl ON ccl.id = ccp.claim_line_id
          WHERE ccp.organization_id = ${organizationId}
            AND ccl.claim_id = ANY(${claimIds})
          ORDER BY ccp.id ASC
        `,
        sql`
          SELECT id,
                 claim_id AS "claimId",
                 type,
                 note,
                 created_at::text AS "createdAt"
          FROM credit_claim_events
          WHERE organization_id = ${organizationId}
            AND claim_id = ANY(${claimIds})
          ORDER BY id ASC
        `,
      ]);

      const photosByLine = new Map<number, CreditClaimPhoto[]>();
      for (const row of photoRows as Array<Record<string, unknown>>) {
        const lineId = Number(row.claimLineId);
        const photos = photosByLine.get(lineId) ?? [];
        photos.push({
          id: Number(row.id),
          fileName: String(row.fileName),
          sizeBytes: Number(row.sizeBytes),
        });
        photosByLine.set(lineId, photos);
      }

      const linesByClaim = new Map<number, CreditClaimLine[]>();
      for (const row of lineRows as Array<Record<string, unknown>>) {
        const claimId = Number(row.claimId);
        const lineId = Number(row.id);
        const lines = linesByClaim.get(claimId) ?? [];
        lines.push({
          id: lineId,
          expiredItemTransactionId: Number(row.expiredItemTransactionId),
          batchNumber: (row.batchNumber as string | null) ?? null,
          unitsClaimed: Number(row.unitsClaimed),
          expectedCreditUnits:
            row.expectedCreditUnits == null ? null : Number(row.expectedCreditUnits),
          expectedCreditValue:
            row.expectedCreditValue == null ? null : Number(row.expectedCreditValue),
          photos: photosByLine.get(lineId) ?? [],
        });
        linesByClaim.set(claimId, lines);
      }

      const eventsByClaim = new Map<number, CreditClaimEvent[]>();
      for (const row of eventRows as Array<Record<string, unknown>>) {
        const claimId = Number(row.claimId);
        const events = eventsByClaim.get(claimId) ?? [];
        events.push({
          id: Number(row.id),
          type: String(row.type),
          note: (row.note as string | null) ?? null,
          createdAt: String(row.createdAt),
        });
        eventsByClaim.set(claimId, events);
      }

      return claimRows.map((row) => {
        const claimId = Number(row.id);
        return {
          id: claimId,
          supplierId: Number(row.supplierId),
          status: String(row.status),
          contactEmailSnapshot: (row.contactEmailSnapshot as string | null) ?? null,
          expectedCreditUnits:
            row.expectedCreditUnits == null ? null : Number(row.expectedCreditUnits),
          expectedCreditValue:
            row.expectedCreditValue == null ? null : Number(row.expectedCreditValue),
          creditedValue: row.creditedValue == null ? null : Number(row.creditedValue),
          sentAt: (row.sentAt as string | null) ?? null,
          nextFollowUpAt: (row.nextFollowUpAt as string | null) ?? null,
          followUpCount: row.followUpCount == null ? 0 : Number(row.followUpCount),
          settledAt: (row.settledAt as string | null) ?? null,
          supplier: {
            id: Number(row.supplier_id),
            name: String(row.supplier_name),
            creditType: row.supplier_credit_type === 'FULL_CREDIT' ? 'FULL_CREDIT' : 'NONE',
            contactEmail: (row.supplier_contact_email as string | null) ?? null,
            contactPhone: (row.supplier_contact_phone as string | null) ?? null,
            creditPolicyNote: String(row.supplier_credit_policy_note ?? ''),
            policyWriteOffQty:
              row.supplier_policy_write_off_qty == null
                ? null
                : Number(row.supplier_policy_write_off_qty),
            policyCreditQty:
              row.supplier_policy_credit_qty == null
                ? null
                : Number(row.supplier_policy_credit_qty),
            followUpDays:
              row.supplier_follow_up_days == null ? 7 : Number(row.supplier_follow_up_days),
            representativeName: (row.supplier_representative_name as string | null) ?? null,
            representativeEmail: (row.supplier_representative_email as string | null) ?? null,
            policyUpdatedAt: (row.supplier_policy_updated_at as string | null) ?? null,
          },
          lines: linesByClaim.get(claimId) ?? [],
          events: eventsByClaim.get(claimId) ?? [],
        };
      });
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
        SELECT p.id, p.name, p.barcode, p.sku,
               p.cost_price as "costPrice", p.retail_price as "retailPrice", p.notes,
               p.created_at as "createdAt", p.updated_at as "updatedAt",
               ps.id AS "productSupplierId",
               ps.name AS "productSupplierName", ps.credit_policy_note AS "productSupplierPolicyNote",
               ps.credit_type AS "productSupplierCreditType",
               b.id AS "brandId", b.name AS "brandName", b.source AS "brandSource",
               b.suggested_supplier_name AS "suggestedSupplierName",
               bs.id AS "brandSupplierId", bs.name AS "brandSupplierName",
               bs.credit_policy_note AS "brandSupplierPolicyNote",
               bs.credit_type AS "brandSupplierCreditType"
        FROM products p
        LEFT JOIN suppliers ps ON ps.id = p.supplier_id AND ps.organization_id = p.organization_id
        LEFT JOIN brands b ON b.id = p.brand_id AND b.organization_id = p.organization_id
        LEFT JOIN suppliers bs ON bs.id = b.supplier_id AND bs.organization_id = b.organization_id
        WHERE p.organization_id = ${organizationId} AND p.barcode = ${barcode}
        LIMIT 1
      `;
      return rows[0] ? mapCreditContextRow<Product>(rows[0] as Record<string, unknown>) : null;
    },

    async findProductBySku(organizationId: string, sku: string): Promise<Product | null> {
      const rows = await sql`
        SELECT p.id, p.name, p.barcode, p.sku,
               p.cost_price as "costPrice", p.retail_price as "retailPrice", p.notes,
               p.created_at as "createdAt", p.updated_at as "updatedAt",
               ps.id AS "productSupplierId",
               ps.name AS "productSupplierName", ps.credit_policy_note AS "productSupplierPolicyNote",
               ps.credit_type AS "productSupplierCreditType",
               b.id AS "brandId", b.name AS "brandName", b.source AS "brandSource",
               b.suggested_supplier_name AS "suggestedSupplierName",
               bs.id AS "brandSupplierId", bs.name AS "brandSupplierName",
               bs.credit_policy_note AS "brandSupplierPolicyNote",
               bs.credit_type AS "brandSupplierCreditType"
        FROM products p
        LEFT JOIN suppliers ps ON ps.id = p.supplier_id AND ps.organization_id = p.organization_id
        LEFT JOIN brands b ON b.id = p.brand_id AND b.organization_id = p.organization_id
        LEFT JOIN suppliers bs ON bs.id = b.supplier_id AND bs.organization_id = b.organization_id
        WHERE p.organization_id = ${organizationId} AND p.sku = ${sku}
        LIMIT 1
      `;
      return rows[0] ? mapCreditContextRow<Product>(rows[0] as Record<string, unknown>) : null;
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
      data: { name: string; subDepartment?: string | null; parentId?: number | null },
    ): Promise<StoreArea> {
      const rows = await sql`
        INSERT INTO store_areas (
          organization_id,
          name,
          sub_department,
          parent_id,
          created_at,
          updated_at
        )
        VALUES (
          ${organizationId},
          ${data.name},
          ${data.subDepartment ?? null},
          ${data.parentId ?? null},
          NOW(),
          NOW()
        )
        RETURNING id, name,
                  parent_id as "parentId",
                  sub_department as "subDepartment",
                  last_checked as "lastChecked",
                  created_at as "createdAt", updated_at as "updatedAt"
      `;
      return rows[0] as StoreArea;
    },

    async updateStoreArea(
      organizationId: string,
      id: number,
      data: { name?: string; subDepartment?: string | null; parentId?: number | null },
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
          parent_id = CASE
            WHEN ${data.parentId === undefined} THEN parent_id
            ELSE ${data.parentId ?? null}
          END,
          updated_at = NOW()
        WHERE id = ${id} AND organization_id = ${organizationId}
        RETURNING id, name,
                  parent_id as "parentId",
                  sub_department as "subDepartment",
                  last_checked as "lastChecked",
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

    // ---- Store walk tracking ----
    async listCheckCycles(organizationId: string): Promise<CheckCycle[]> {
      const rows = await sql`
        SELECT id,
               organization_id as "organizationId",
               name,
               status,
               started_at as "startedAt",
               completed_at as "completedAt",
               created_at as "createdAt",
               updated_at as "updatedAt"
        FROM check_cycles
        WHERE organization_id = ${organizationId}
        ORDER BY started_at DESC, id DESC
      `;
      return rows.map((row) => toCheckCycle(row as Record<string, unknown>));
    },

    async createCheckCycle(
      organizationId: string,
      data: { name: string; startedAt?: string },
    ): Promise<CheckCycle> {
      const activeRows = await sql`
        SELECT id
        FROM check_cycles
        WHERE organization_id = ${organizationId} AND status = 'active'
        LIMIT 1
      `;
      if (activeRows[0]) {
        throw new Error('Active check cycle already exists');
      }

      const rows = await sql`
        INSERT INTO check_cycles (
          organization_id, name, status, started_at, created_at, updated_at
        )
        VALUES (
          ${organizationId},
          ${data.name},
          'active',
          COALESCE(${data.startedAt ?? null}::timestamptz, NOW()),
          NOW(),
          NOW()
        )
        RETURNING id,
                  organization_id as "organizationId",
                  name,
                  status,
                  started_at as "startedAt",
                  completed_at as "completedAt",
                  created_at as "createdAt",
                  updated_at as "updatedAt"
      `;
      return toCheckCycle(rows[0] as Record<string, unknown>);
    },

    async completeCheckCycle(organizationId: string, id: number): Promise<CheckCycle> {
      const rows = await sql`
        UPDATE check_cycles
        SET status = 'completed',
            completed_at = NOW(),
            updated_at = NOW()
        WHERE id = ${id}
          AND organization_id = ${organizationId}
          AND status = 'active'
        RETURNING id,
                  organization_id as "organizationId",
                  name,
                  status,
                  started_at as "startedAt",
                  completed_at as "completedAt",
                  created_at as "createdAt",
                  updated_at as "updatedAt"
      `;
      if (!rows[0]) {
        throw new Error('Active check cycle not found');
      }
      return toCheckCycle(rows[0] as Record<string, unknown>);
    },

    async recordBayCheck(
      organizationId: string,
      userId: number,
      data: {
        storeAreaId: number;
        checkedAt?: string;
        itemsAddedCount?: number;
        notes?: string | null;
      },
    ): Promise<BayCheck> {
      const activeRows = await sql`
        SELECT id
        FROM check_cycles
        WHERE organization_id = ${organizationId} AND status = 'active'
        ORDER BY started_at DESC, id DESC
        LIMIT 1
      `;
      const activeCycleId = activeRows[0]?.id;
      if (!activeCycleId) {
        throw new Error('Active check cycle is required');
      }

      const bayRows = await sql`
        SELECT id
        FROM store_areas
        WHERE id = ${data.storeAreaId}
          AND organization_id = ${organizationId}
          AND parent_id IS NOT NULL
        LIMIT 1
      `;
      if (!bayRows[0]) {
        throw new Error('Bay check must target a leaf bay');
      }

      const rows = await sql`
        WITH inserted AS (
          INSERT INTO bay_checks (
            organization_id,
            cycle_id,
            store_area_id,
            user_id,
            checked_at,
            items_added_count,
            notes,
            created_at,
            updated_at
          )
          VALUES (
            ${organizationId},
            ${Number(activeCycleId)},
            ${data.storeAreaId},
            ${userId},
            COALESCE(${data.checkedAt ?? null}::timestamptz, NOW()),
            ${data.itemsAddedCount ?? 0},
            ${data.notes ?? null},
            NOW(),
            NOW()
          )
          RETURNING id,
                    organization_id,
                    cycle_id,
                    store_area_id,
                    user_id,
                    checked_at,
                    items_added_count,
                    notes,
                    created_at,
                    updated_at
        ), updated_area AS (
          UPDATE store_areas
          SET last_checked = (SELECT checked_at FROM inserted),
              updated_at = NOW()
          WHERE id = ${data.storeAreaId}
            AND organization_id = ${organizationId}
        )
        SELECT id,
               organization_id as "organizationId",
               cycle_id as "cycleId",
               store_area_id as "storeAreaId",
               user_id as "userId",
               checked_at as "checkedAt",
               items_added_count as "itemsAddedCount",
               notes,
               created_at as "createdAt",
               updated_at as "updatedAt"
        FROM inserted
      `;
      return toBayCheck(rows[0] as Record<string, unknown>);
    },

    async getFloorProgress(organizationId: string): Promise<FloorProgress> {
      const cycleRows = await sql`
        SELECT id,
               organization_id as "organizationId",
               name,
               status,
               started_at as "startedAt",
               completed_at as "completedAt",
               created_at as "createdAt",
               updated_at as "updatedAt"
        FROM check_cycles
        WHERE organization_id = ${organizationId} AND status = 'active'
        ORDER BY started_at DESC, id DESC
        LIMIT 1
      `;
      const activeCycle = cycleRows[0]
        ? toCheckCycle(cycleRows[0] as Record<string, unknown>)
        : null;

      const bayRows = await sql`
        SELECT bay.id,
               bay.name,
               bay.parent_id as "parentId",
               department.name as "parentName",
               bay.last_checked as "lastChecked"
        FROM store_areas bay
        LEFT JOIN store_areas department ON bay.parent_id = department.id
        WHERE bay.organization_id = ${organizationId}
          AND bay.parent_id IS NOT NULL
        ORDER BY department.name ASC NULLS LAST, bay.name ASC, bay.id ASC
      `;
      const bays = bayRows.map((row) => ({
        id: Number(row.id),
        name: String(row.name),
        parentId: toNumberOrNull(row.parentId),
        parentName:
          row.parentName === null || row.parentName === undefined ? null : String(row.parentName),
        lastChecked:
          row.lastChecked === null || row.lastChecked === undefined
            ? null
            : String(row.lastChecked),
      })) satisfies StoreWalkBay[];

      if (!activeCycle) {
        return {
          activeCycle: null,
          summary: toFloorProgressSummary({
            totalBays: bays.length,
            checkedBays: 0,
            notCheckedBays: bays.length,
            overdueBays: 0,
            coveragePercent: 0,
          }),
          departments: [],
        };
      }

      const checkRows = await sql`
        SELECT bc.store_area_id as "storeAreaId",
               bc.checked_at as "checkedAt",
               bc.user_id as "userId",
               users.username as "checkerName"
        FROM bay_checks bc
        LEFT JOIN users ON bc.user_id = users.id
        WHERE bc.organization_id = ${organizationId}
          AND bc.cycle_id = ${activeCycle.id}
        ORDER BY bc.checked_at DESC, bc.id DESC
      `;
      const checksForCycle = checkRows.map((row) => ({
        storeAreaId: Number(row.storeAreaId),
        checkedAt: String(row.checkedAt),
        userId: toNumberOrNull(row.userId),
        checkerName:
          row.checkerName === null || row.checkerName === undefined
            ? null
            : String(row.checkerName),
      })) satisfies BayCheckForCycle[];
      const rollup = rollupCoverage(bays, checksForCycle, activeCycle.startedAt);

      return {
        activeCycle,
        summary: toFloorProgressSummary(rollup.store),
        departments: rollup.departments.map((department) => ({
          department: {
            id: department.departmentId,
            name: department.departmentName,
          },
          summary: toFloorProgressSummary(department),
          bays: bays
            .filter((bay) => bay.parentId === department.departmentId)
            .map((bay) => {
              const state = resolveBayState(bay, checksForCycle, activeCycle.startedAt);
              return {
                id: bay.id,
                name: bay.name,
                parentId: bay.parentId,
                state: state.state,
                checkedAt: state.checkedAt?.toISOString() ?? null,
                checkedBy:
                  state.userId === null ? null : { id: state.userId, name: state.checkerName },
              };
            }),
        })),
      };
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
