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
import { ORG_AUDIT_EVENT_TYPES, ORG_AUDIT_TRIGGERS } from '../../shared/domain/org-audit';
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
import {
  createCreditClaimDatabase,
  type BuildClaimInput,
  type ClaimOutcome,
  type ClaimPhotoRow,
  type ClaimWriteResult,
} from './credit-claim-database';
import { assertReferencesBelongToOrganization } from './tenant-references';

// Note: fetchConnectionCache is now always true by default in @neondatabase/serverless

/**
 * Statuses that take an inventory item out of the "active expiry" population.
 *
 * Mirrors `countActiveExpiryItems`
 * (backend/src/repositories/subscription.repository.ts:149) so the Worker
 * counts the population Express counted.
 *
 * **Shared by the cap check and the usage count on purpose.** They were two
 * hardcoded copies; if a new terminal status reached only one of them, the
 * dashboard's "{current} / {limit}" bar would disagree with what creates are
 * actually refused against, with no error to notice -- the reading and the
 * enforcing would just quietly describe different populations.
 */
const TERMINAL_INVENTORY_STATUSES = [
  'Processed',
  'Completed',
  'Discarded',
  'Archived',
  'Sold Through',
];

/**
 * Database wrapper providing typed query methods
 */
export interface Database {
  sql: NeonQueryFunction<false, false>;

  // User queries
  findUserByEmail(email: string): Promise<User | null>;
  findUserById(id: number): Promise<User | null>;
  createUser(data: CreateUserData): Promise<User>;

  // Product queries.
  //
  // `organizationId` is the FIRST parameter on every one of these, and is
  // required rather than optional, so that a call site which forgets it fails
  // to compile. These six methods previously took no organization at all and
  // their queries had no `organization_id` predicate, which made four live
  // authenticated routes return every tenant's rows to any signed-in user.
  // Matching the shape of the already-scoped queries below (getDashboardStats,
  // findProductByBarcode) keeps the convention uniform: if it reads tenant
  // data, the organization comes first.
  findProducts(
    organizationId: string,
    options?: { limit?: number; offset?: number; search?: string },
  ): Promise<Product[]>;
  findProductById(organizationId: string, id: number): Promise<Product | null>;
  countProducts(organizationId: string, search?: string): Promise<number>;
  findExcessProducts(organizationId: string, maxSkus: number): Promise<ExcessProduct[]>;
  deleteProduct(organizationId: string, id: number): Promise<DeleteProductResult>;

  // Inventory queries
  findInventoryItems(
    organizationId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<InventoryItem[]>;
  countInventoryItems(organizationId: string): Promise<number>;

  // Store area queries
  findStoreAreas(organizationId: string): Promise<StoreArea[]>;
  findStoreAreaById(organizationId: string, id: number): Promise<StoreArea | null>;

  // Dashboard queries
  getDashboardStats(organizationId: string): Promise<DashboardStats>;
  /** Counters behind GET /api/reports/analytics. */
  getDashboardAnalytics(organizationId: string): Promise<DashboardAnalytics>;
  /** Audit activity grouped by role, behind GET /api/reports/usage. */
  getUsageReport(organizationId: string): Promise<UsageReportRow[]>;
  /** Idempotently seed demo store areas, products and inventory items. */
  seedDemoData(organizationId: string): Promise<SeedDemoDataResult>;
  /** Live counts backing GET /api/organization/usage. */
  getUsageCounts(organizationId: string): Promise<UsageCounts>;
  /**
   * Bytes currently recorded against the organization's storage quota.
   * Undercounts synchronous uploads by design -- see the implementation.
   */
  getStorageUsedBytes(organizationId: string): Promise<number>;
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
  findCreditClaim(organizationId: string, id: number): Promise<CreditClaim | null>;
  /**
   * `createdByUserId` is deliberately a separate argument rather than a field of
   * `input`: the creator must come from the verified token and never from the request
   * body, matching `backend/src/controllers/credit-claim.controller.ts:44`.
   */
  buildCreditClaim(
    organizationId: string,
    input: BuildClaimInput,
    createdByUserId: number | null,
  ): Promise<ClaimWriteResult<CreditClaim>>;
  addCreditClaimPhoto(
    organizationId: string,
    claimId: number,
    lineId: number,
    file: { storageKey: string; fileName: string; sizeBytes: number },
  ): Promise<ClaimWriteResult<CreditClaimPhoto>>;
  reserveClaimForSending(organizationId: string, id: number): Promise<boolean>;
  finalizeSentClaim(
    organizationId: string,
    id: number,
    data: { contactEmail: string; sentAt: Date; nextFollowUpAt: Date },
  ): Promise<void>;
  revertClaimToDraft(organizationId: string, id: number): Promise<void>;
  reserveFollowUp(
    organizationId: string,
    id: number,
    expectedCount: number,
    next: { followUpCount: number; nextFollowUpAt: Date },
  ): Promise<boolean>;
  restoreFollowUpSchedule(
    organizationId: string,
    id: number,
    previous: { followUpCount: number; nextFollowUpAt: string | null },
  ): Promise<void>;
  recordClaimOutcome(
    organizationId: string,
    id: number,
    outcome: ClaimOutcome,
    creditedValue: number | null,
    note: string | null,
    settledAt: Date,
    deleteAfter: Date,
  ): Promise<boolean>;
  addCreditClaimEvent(
    organizationId: string,
    claimId: number,
    type: string,
    note: string | null,
  ): Promise<void>;
  listClaimPhotoKeys(organizationId: string, claimId: number): Promise<ClaimPhotoRow[]>;

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
  /**
   * Creates a product unless the organization is at its tier SKU cap, in which
   * case it resolves to `null` without inserting. The cap is checked inside the
   * INSERT (see the implementation), so `null` is authoritative rather than
   * advisory.
   */
  createProduct(
    organizationId: string,
    data: {
      barcode: string;
      sku?: string | null;
      name: string;
      costPrice?: number;
      notes?: string;
    },
    maxSkus: number,
  ): Promise<Product | null>;
  updateProduct(
    organizationId: string,
    id: number,
    data: {
      barcode?: string;
      sku?: string;
      name?: string;
      costPrice?: number;
      notes?: string;
    },
  ): Promise<Product | null>;

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
  /**
   * Creates an inventory item unless the organization is at its tier
   * active-expiry cap, in which case it resolves to `null` without inserting
   * and without writing an audit row.
   */
  createInventoryItem(
    organizationId: string,
    userId: number,
    data: {
      productId: number;
      expiryDate: string;
      locationId: number;
      status?: string;
    },
    maxActiveExpiries: number,
  ): Promise<InventoryItem | null>;
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
  createOrganizationUser(
    organizationId: string,
    data: { username: string | null; role: string; seatCap: number; actor: RoleChangeActor },
  ): Promise<UserListItem | null>;
  updateUserRole(
    organizationId: string,
    userId: number,
    role: string,
    actor: RoleChangeActor,
  ): Promise<UserRoleChange | null>;
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

/**
 * The six counters behind `GET /api/reports/analytics`, ported from Express's
 * `ReportRepository.getDashboardAnalytics` (`backend/src/repositories/report.repository.ts:405`).
 *
 * Overlaps `DashboardStats` on its first two fields on purpose: Express served
 * two separate endpoints with two separate shapes, and the frontend reads
 * neither of these four extra counters today.
 */
export interface DashboardAnalytics {
  totalProducts: number;
  totalInventoryItems: number;
  activeItems: number;
  expiredItems: number;
  markdownItems: number;
  upcomingExpiry: number;
}

/** One row of `GET /api/reports/usage`: audit activity grouped by user role. */
export interface UsageReportRow {
  role: string;
  totalActivities: number;
  creations: number;
  updates: number;
  deletions: number;
}

/** What `seedDemoData` created. Counts are of rows actually inserted. */
export interface SeedDemoDataResult {
  success: true;
  productsCreated: number;
  areasCreated: number;
  inventoryItemsCreated: number;
}

export interface LastCatalogueUpload {
  fileName: string;
  uploadedAt: string;
}

/** Live resource counts for an organization, used for usage reporting. */
export interface UsageCounts {
  skus: number;
  users: number;
  activeExpiries: number;
}

/**
 * One row of `GET /api/products/export-excess`. Mirrors the field set Express
 * exported (`product.controller.ts` `sendExcessProductsCsv`) because the CSV
 * header row is published in `docs/tier-downgrade-guide.md` and customers have
 * been told what the file contains.
 */
export interface ExcessProduct {
  id: number;
  sku: string | null;
  name: string;
  barcode: string | null;
  costPrice: number;
  createdAt: string;
  inventoryCount: number;
}

/**
 * Why this is a three-way outcome rather than a boolean.
 *
 * `inventory_items_product_id_fkey` is `ON DELETE RESTRICT`, so a product
 * referenced by any inventory item cannot be deleted. Express discovered that
 * by letting the constraint fire: `ProductService.deleteProduct` catches only
 * Prisma's P2025 (not-found), so the P2003 fell through to `next(error)` and
 * the customer got a 500 with no indication of what was wrong -- on the exact
 * products `export-excess` had just listed for them, since that export carries
 * an `inventoryCount` column.
 *
 * The blocker is therefore counted explicitly rather than inferred from a
 * raised constraint, which also makes it testable: the pglite harness declares
 * `inventory_items.product_id` with no foreign key at all, so a "refuses when
 * inventory exists" test resting on a raised FK would be green because the
 * harness cannot turn red.
 */
export type DeleteProductResult =
  | { outcome: 'deleted' }
  | { outcome: 'not_found' }
  | { outcome: 'blocked'; inventoryCount: number };

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

/**
 * Change a user's role and record it in `org_audit_log` in **one statement**.
 *
 * The audit row is a data-modifying CTE rather than a follow-up INSERT because
 * Neon's HTTP driver has no transaction: two statements would allow the role to
 * change while the audit write fails, and for the one event with a real
 * compliance argument — an admin deliberately promoting another user — a
 * silently missing row is worse than a failed request. Postgres executes a
 * data-modifying CTE exactly once and to completion whether or not the primary
 * query reads its output, so `audited` runs even though nothing selects from it.
 *
 * **`prev` locks the row with `FOR UPDATE`, and the `UPDATE` repeats `prev`'s
 * predicates.** Both are concurrency fixes, and both were missing in review:
 *
 *   * Without the lock, `prev` reads the statement's snapshot. Under READ
 *     COMMITTED a second request could materialise a stale `prev.role`, wait for
 *     another update to commit, and then record that stale value as `old_role` —
 *     or suppress a real change as a no-op, since the suppression compares
 *     against `prev.role`. `FOR UPDATE` blocks until the other writer commits and
 *     then re-reads the committed row, so old/new and the no-op test are based on
 *     the predecessor that actually existed.
 *   * Without the repeated predicates, the `UPDATE`'s only qualifier was
 *     `users.id = prev.id`. Postgres re-evaluates an `UPDATE`'s own qualifiers
 *     against the updated row version (EvalPlanQual), so a membership move or
 *     soft-delete committing in the window would still match on id alone and let
 *     the caller mutate a now-foreign or deleted user. Carrying
 *     `organization_id` and `deleted_at IS NULL` on the `UPDATE` makes that
 *     re-check meaningful. The original pre-audit statement had them there;
 *     moving them into `prev` quietly weakened the guard.
 *
 * The race itself is not reproducible under pglite, which serialises these
 * tests on one connection — so this is reasoned, not test-proven, and the tests
 * cover only the non-concurrent behaviour.
 */
async function applyUserRoleChange(
  sql: NeonQueryFunction<false, false>,
  args: {
    organizationId: string;
    userId: number;
    role: string;
    actor: RoleChangeActor;
  },
): Promise<UserRoleChange | null> {
  const { organizationId, userId, role, actor } = args;
  const metadata = JSON.stringify({ trigger: ORG_AUDIT_TRIGGERS.ADMIN_UPDATE });
  const rows = await sql`
    WITH prev AS (
      SELECT id, role
      FROM users
      WHERE id = ${userId}
        AND organization_id = ${organizationId}
        AND deleted_at IS NULL
      FOR UPDATE
    ),
    updated AS (
      UPDATE users
      SET role = ${role}, updated_at = NOW()
      FROM prev
      WHERE users.id = prev.id
        AND users.organization_id = ${organizationId}
        AND users.deleted_at IS NULL
      RETURNING users.id,
                users.email,
                users.username,
                users.role,
                users.clerk_user_id,
                users.created_at,
                prev.role AS previous_role
    ),
    audited AS (
      INSERT INTO org_audit_log (
        organization_id,
        event_type,
        actor_user_id,
        actor_organization_id,
        target_user_id,
        target_organization_id,
        old_role,
        new_role,
        ip_address,
        metadata,
        created_at
      )
      SELECT ${organizationId},
             ${ORG_AUDIT_EVENT_TYPES.ROLE_ASSIGNED},
             ${actor.userId},
             ${organizationId},
             updated.id,
             ${organizationId},
             updated.previous_role,
             updated.role,
             ${actor.ipAddress},
             ${metadata},
             NOW()
      FROM updated
      -- A request that re-asserts the role a user already has changed nothing,
      -- so it is not an authorization event. Recording it would pad the trail
      -- with entries indistinguishable from real grants without comparing
      -- old_role to new_role on every read.
      WHERE updated.previous_role IS DISTINCT FROM updated.role
      RETURNING 1
    )
    SELECT id,
           email,
           username,
           role,
           clerk_user_id as "clerkUserId",
           created_at::text as "createdAt",
           previous_role as "previousRole"
    FROM updated
  `;
  return (rows[0] as UserRoleChange) || null;
}

/**
 * Create a user with an admin-chosen role, subject to the tier's seat cap, and
 * record the grant in `org_audit_log` — **one statement**, for the same reason
 * `applyUserRoleChange` is one: Neon's HTTP driver has no transaction, and a
 * created admin with no record of who created them is the failure the audit
 * trail exists to prevent. Unlike a promotion there is no previous role, so
 * `old_role` is NULL rather than a value the row once held.
 *
 * The seat cap is a `WHERE` on the `created` CTE rather than a read in front of
 * the statement, for the reason `createProduct` gives: a read-then-insert goes
 * stale across a round trip this driver cannot wrap in a transaction. It is
 * still a **soft cap** — each statement snapshots at statement start under READ
 * COMMITTED, so two creates racing at limit-1 can both see room.
 *
 * Because `audited` selects `FROM created`, a capped attempt writes no audit
 * row either. That coupling is the property worth holding: a seat refusal that
 * still recorded `role_assigned` would read, in the compliance trail, as an
 * admin who was created.
 *
 * **The count includes soft-deleted users**, matching `getUsageCounts` (so the
 * cap and the usage screen agree) and Express's `countByOrganization`
 * (`backend/src/repositories/user.repository.ts:67`, which also omits any
 * `deletedAt` filter). `listUsers` does exclude them, so a soft-deleted user is
 * invisible in the UI while still holding a seat. That is pre-existing parity,
 * not a regression, and it is inert while `USAGE_LIMITS_ENFORCE` is off — but
 * it is a condition to settle before turning the flag on, since "delete a user
 * to free a seat" would not work.
 *
 * **This is not the only path that creates a seat, and the other one is
 * deliberately left uncapped.** `upsertClerkUser`
 * (`clerk/clerk-persistence.ts`) inserts a user row on
 * `organizationMembership.created`, which is the normal way a member is minted:
 * an org admin adds someone in Clerk's own UI before they ever sign in.
 * Refusing that delivery would leave the person a member in Clerk with no row
 * here — the identity provider and the database silently disagreeing, which is
 * the failure mode 3.1.k already decided against when it ruled that a dropped
 * webhook must not become a lockout. Svix would also simply retry it.
 *
 * So the contract is narrow on purpose: **the cap governs admin-initiated seat
 * creation through the API, not membership granted in Clerk.** An organization
 * can therefore exceed its tier through Clerk's UI and then be refused at this
 * endpoint, which looks arbitrary from the outside. That is the second
 * condition to settle before `USAGE_LIMITS_ENFORCE` goes on: making seats a
 * real commercial limit means enforcing at the Clerk side or reconciling
 * afterwards, and that is a product decision rather than a gate on this
 * statement.
 *
 * Zero rows back means the cap was reached; a failed insert throws instead, so
 * the caller cannot confuse the two.
 */
async function insertOrganizationUser(
  sql: NeonQueryFunction<false, false>,
  args: {
    organizationId: string;
    username: string | null;
    role: string;
    seatCap: number;
    actor: RoleChangeActor;
  },
): Promise<UserListItem | null> {
  const { organizationId, username, role, seatCap, actor } = args;
  const metadata = JSON.stringify({ trigger: ORG_AUDIT_TRIGGERS.ADMIN_CREATE });
  const rows = await sql`
    WITH created AS (
      INSERT INTO users (organization_id, username, role, created_at, updated_at)
      SELECT ${organizationId}, ${username}, ${role}, NOW(), NOW()
      WHERE (
        SELECT COUNT(*) FROM users WHERE organization_id = ${organizationId}
      ) < ${seatCap}
      RETURNING id, email, username, role, clerk_user_id, created_at
    ),
    audited AS (
      INSERT INTO org_audit_log (
        organization_id,
        event_type,
        actor_user_id,
        actor_organization_id,
        target_user_id,
        target_organization_id,
        old_role,
        new_role,
        ip_address,
        metadata,
        created_at
      )
      SELECT ${organizationId},
             ${ORG_AUDIT_EVENT_TYPES.ROLE_ASSIGNED},
             ${actor.userId},
             ${organizationId},
             created.id,
             ${organizationId},
             NULL,
             created.role,
             ${actor.ipAddress},
             ${metadata},
             NOW()
      FROM created
      RETURNING 1
    )
    SELECT id, email, username, role,
           clerk_user_id as "clerkUserId",
           created_at::text as "createdAt"
    FROM created
  `;
  return (rows[0] as UserListItem) || null;
}

/** Who is performing a role change, for the `org_audit_log` entry it produces. */
export interface RoleChangeActor {
  userId: number;
  ipAddress: string | null;
}

/**
 * A completed role change. `previousRole` is read in the same statement that
 * performs the update, so it is the value the row actually held — not a value
 * re-read afterwards, which a concurrent change could have already replaced.
 * It is internal to the audit trail and must not be returned to API callers.
 */
export interface UserRoleChange extends UserListItem {
  previousRole: string;
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
    JOIN products p ON ii.product_id = p.id AND p.organization_id = ii.organization_id
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
    JOIN products p ON ii.product_id = p.id AND p.organization_id = ii.organization_id
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
    ...createCreditClaimDatabase(sql),

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
    async findProducts(
      organizationId: string,
      options?: {
        limit?: number;
        offset?: number;
        search?: string;
      },
    ): Promise<Product[]> {
      const limit = options?.limit || 50;
      const offset = options?.offset || 0;
      const search = options?.search;

      if (search) {
        const searchPattern = `%${search}%`;
        // The organization predicate is applied BEFORE the search terms and the
        // search group is parenthesised. Without the parentheses, SQL operator
        // precedence binds `AND` tighter than `OR`, so the organization filter
        // would apply only to the first `ILIKE` and the other two would match
        // across every tenant.
        return (await sql`
          SELECT id, name, barcode, sku,
                 cost_price as "costPrice", notes,
                 created_at as "createdAt", updated_at as "updatedAt"
          FROM products
          WHERE organization_id = ${organizationId}
            AND (name ILIKE ${searchPattern}
              OR barcode ILIKE ${searchPattern}
              OR sku ILIKE ${searchPattern})
          ORDER BY name ASC
          LIMIT ${limit} OFFSET ${offset}
        `) as Product[];
      }

      return (await sql`
        SELECT id, name, barcode, sku,
               cost_price as "costPrice", notes,
               created_at as "createdAt", updated_at as "updatedAt"
        FROM products
        WHERE organization_id = ${organizationId}
        ORDER BY name ASC
        LIMIT ${limit} OFFSET ${offset}
      `) as Product[];
    },

    async findProductById(organizationId: string, id: number): Promise<Product | null> {
      const rows = await sql`
        SELECT id, name, barcode, sku,
               cost_price as "costPrice", notes,
               created_at as "createdAt", updated_at as "updatedAt"
        FROM products
        WHERE id = ${id} AND organization_id = ${organizationId}
        LIMIT 1
      `;
      return (rows[0] as Product) || null;
    },

    async countProducts(organizationId: string, search?: string): Promise<number> {
      if (search) {
        const searchPattern = `%${search}%`;
        // Parenthesised for the same precedence reason as findProducts above.
        const rows = await sql`
          SELECT COUNT(*)::int as count FROM products
          WHERE organization_id = ${organizationId}
            AND (name ILIKE ${searchPattern}
              OR barcode ILIKE ${searchPattern}
              OR sku ILIKE ${searchPattern})
        `;
        return rows[0]?.count || 0;
      }
      const rows = await sql`
        SELECT COUNT(*)::int as count FROM products
        WHERE organization_id = ${organizationId}
      `;
      return rows[0]?.count || 0;
    },

    // Inventory queries
    async findInventoryItems(
      organizationId: string,
      options?: {
        limit?: number;
        offset?: number;
      },
    ): Promise<InventoryItem[]> {
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
        -- Each JOIN is correlated to the item's own organization, matching the
        -- pattern already used by findProductByBarcode (:2265-2267). The WHERE
        -- clause alone scopes which inventory rows are returned, but not which
        -- product or store area is attached to them: a row whose product_id
        -- pointed at another tenant's product would still splice that product's
        -- name and barcode into the response. Creation validates that the
        -- references share an organization, but that is one check at one point,
        -- and this query outlives it. Kept in ON rather than WHERE so LEFT JOIN
        -- semantics hold — a mismatched reference yields NULL, it does not drop
        -- the inventory row.
        LEFT JOIN products p ON i.product_id = p.id AND p.organization_id = i.organization_id
        LEFT JOIN store_areas s ON i.location_id = s.id AND s.organization_id = i.organization_id
        WHERE i.organization_id = ${organizationId}
        ORDER BY i.expiry_date ASC NULLS LAST
        LIMIT ${limit} OFFSET ${offset}
      `) as InventoryItem[];
    },

    async countInventoryItems(organizationId: string): Promise<number> {
      const rows = await sql`
        SELECT COUNT(*)::int as count FROM inventory_items
        WHERE organization_id = ${organizationId}
      `;
      return rows[0]?.count || 0;
    },

    // Store area queries
    async findStoreAreas(organizationId: string): Promise<StoreArea[]> {
      return (await sql`
        SELECT id, name,
               parent_id as "parentId",
               sub_department as "subDepartment",
               last_checked as "lastChecked",
               created_at as "createdAt", updated_at as "updatedAt"
        FROM store_areas
        WHERE organization_id = ${organizationId}
        ORDER BY name ASC
      `) as StoreArea[];
    },

    async findStoreAreaById(organizationId: string, id: number): Promise<StoreArea | null> {
      const rows = await sql`
        SELECT id, name,
               parent_id as "parentId",
               sub_department as "subDepartment",
               last_checked as "lastChecked",
               created_at as "createdAt", updated_at as "updatedAt"
        FROM store_areas
        WHERE id = ${id} AND organization_id = ${organizationId}
        LIMIT 1
      `;
      return (rows[0] as StoreArea | undefined) ?? null;
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
              JOIN products p ON ii.product_id = p.id AND p.organization_id = ii.organization_id
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

    async getDashboardAnalytics(organizationId: string): Promise<DashboardAnalytics> {
      // Port of Express's `ReportRepository.getDashboardAnalytics`
      // (`backend/src/repositories/report.repository.ts:405`), which issued six
      // separate SQLite statements. Six statements see six snapshots, so its
      // `activeItems + expiredItems` could disagree with its
      // `totalInventoryItems` whenever a write landed mid-request. One statement
      // is both a single round trip and a single snapshot.
      //
      // The status predicates are copied verbatim rather than rewritten against
      // EXPIRED_WORKLIST_STATUSES: `activeItems` here means "not the literal
      // string 'Expired'", so a 'Markdown 2' item counts as active AND as a
      // markdown item. That double-count is Express's definition of these
      // fields, and no caller reads them, so this is not the place to redefine
      // them -- `getDashboardStats` above is where the non-overlapping,
      // frontend-facing counts live.
      //
      // `LIKE 'Markdown%'` stays case-sensitive where SQLite's LIKE was not.
      // The rows are written by code with exactly these spellings
      // (`shared/domain/disposition.ts:11-16`), never typed by a human, so the
      // two forms select the same rows; ILIKE would have widened the predicate
      // rather than ported it.
      const rows = await sql`
        SELECT
          (SELECT COUNT(*)::int FROM products WHERE organization_id = ${organizationId})
            AS "totalProducts",
          COUNT(*)::int AS "totalInventoryItems",
          COUNT(*) FILTER (WHERE status <> ${EXPIRED_STATUS})::int AS "activeItems",
          COUNT(*) FILTER (WHERE status = ${EXPIRED_STATUS})::int AS "expiredItems",
          COUNT(*) FILTER (WHERE status LIKE 'Markdown%')::int AS "markdownItems",
          COUNT(*) FILTER (
            WHERE expiry_date IS NOT NULL
              AND expiry_date >= CURRENT_DATE
              AND expiry_date <= CURRENT_DATE + INTERVAL '30 days'
              AND status <> ${EXPIRED_STATUS}
          )::int AS "upcomingExpiry"
        FROM inventory_items
        WHERE organization_id = ${organizationId}
      `;

      const row = rows[0] as DashboardAnalytics | undefined;
      return {
        totalProducts: row?.totalProducts ?? 0,
        totalInventoryItems: row?.totalInventoryItems ?? 0,
        activeItems: row?.activeItems ?? 0,
        expiredItems: row?.expiredItems ?? 0,
        markdownItems: row?.markdownItems ?? 0,
        upcomingExpiry: row?.upcomingExpiry ?? 0,
      };
    },

    async getUsageReport(organizationId: string): Promise<UsageReportRow[]> {
      // Port of `ReportRepository.getUsageReport`
      // (`backend/src/repositories/report.repository.ts:363`).
      //
      // `LIKE` is kept case-sensitive even though the SQLite original's LIKE was
      // not, because every writer puts the verb in lower case: this Worker
      // writes 'inventory item created' (:3052) and Express wrote 'Inventory
      // item created with expiry date ...'
      // (`backend/src/services/inventory.service.ts:185`) -- capitalized on the
      // noun, not on the verb. The three sibling report queries below
      // (getDailyUsageReport, getItemsByUserReport, getItemsByDateReport) are
      // already case-sensitive against the same column, so one behaviour across
      // all four readers is worth more than a widening that would only change
      // which rows THIS one counts. The test pins the writers' exact strings, so
      // rewording an audit description fails here instead of silently zeroing a
      // report.
      //
      // One deliberate difference from Express: keys are camelCase, as every
      // other Worker report is. Express returned `total_activities`; nothing
      // consumes either spelling.
      //
      // The join is on `user_id` alone, matching Express. Adding
      // `AND u.organization_id = al.organization_id` would look more careful and
      // buy nothing: `users.id` is a single global SERIAL, so a user_id resolves
      // to at most one row, and `audit_log` is already filtered to this
      // organization. It would only change behaviour for a user row moved
      // between organizations, which no path does.
      return (await sql`
        SELECT
          COALESCE(u.role, 'Unknown') AS role,
          COUNT(al.id)::int AS "totalActivities",
          COUNT(*) FILTER (WHERE al.change_description LIKE '%created%')::int AS creations,
          COUNT(*) FILTER (WHERE al.change_description LIKE '%updated%')::int AS updates,
          COUNT(*) FILTER (WHERE al.change_description LIKE '%deleted%')::int AS deletions
        FROM audit_log al
        LEFT JOIN users u ON al.user_id = u.id
        WHERE al.organization_id = ${organizationId}
        GROUP BY COALESCE(u.role, 'Unknown')
        ORDER BY COALESCE(u.role, 'Unknown')
      `) as UsageReportRow[];
    },

    async getUsageCounts(organizationId: string): Promise<UsageCounts> {
      // Counted live for the same reason the limits are enforced live: the
      // `organization_usage` counter columns this endpoint used to read are
      // written once as literal zeros and never updated, so the dashboard
      // showed every organization at 0 of its limit and the frontend's 80%
      // UsageWarning could never fire.
      //
      // `activeExpiries` excludes the same terminal statuses as
      // `countActiveExpiryItems` (backend/src/repositories/subscription.repository.ts:149)
      // so the number shown matches the number enforced against.
      const [skus, users, activeExpiries] = await Promise.all([
        sql`SELECT COUNT(*)::int as count FROM products WHERE organization_id = ${organizationId}`,
        sql`SELECT COUNT(*)::int as count FROM users WHERE organization_id = ${organizationId}`,
        sql`
          SELECT COUNT(*)::int as count FROM inventory_items
          WHERE organization_id = ${organizationId}
            AND status <> ALL(${TERMINAL_INVENTORY_STATUSES})
        `,
      ]);

      return {
        skus: Number(skus[0]?.count ?? 0),
        users: Number(users[0]?.count ?? 0),
        activeExpiries: Number(activeExpiries[0]?.count ?? 0),
      };
    },

    async getStorageUsedBytes(organizationId: string): Promise<number> {
      // Summed live rather than read from `organization_usage.storage_used_bytes`,
      // which this Worker writes exactly once as a literal 0 and never updates.
      //
      // Known undercount: only queued catalogue imports persist an `uploads`
      // row. Synchronous uploads (expiry lists, small direct posts) deliberately
      // have none -- `handleUploadStatus` relies on their absence to fall
      // through to R2 metadata -- so their bytes are invisible here. The gate
      // therefore fails open, never closed: no caller is refused for storage
      // they do not have. Closing the gap means recording those uploads and
      // teaching the status endpoint to tell a quota row from a job row.
      const rows = await sql`
        SELECT COALESCE(SUM(file_size_bytes), 0)::bigint as "usedBytes"
        FROM uploads
        WHERE organization_id = ${organizationId}
          AND status <> 'deleted'
      `;
      return Number(rows[0]?.usedBytes ?? 0);
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
        JOIN store_areas sa ON ii.location_id = sa.id AND sa.organization_id = ii.organization_id
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
        JOIN store_areas sa ON ii.location_id = sa.id AND sa.organization_id = ii.organization_id
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
        JOIN products p ON ii.product_id = p.id AND p.organization_id = ii.organization_id
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
        JOIN products p ON ii.product_id = p.id AND p.organization_id = ii.organization_id
        JOIN store_areas sa ON ii.location_id = sa.id AND sa.organization_id = ii.organization_id
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
        JOIN inventory_items ii ON eit.inventory_item_id = ii.id AND ii.organization_id = eit.organization_id
        JOIN products p ON ii.product_id = p.id AND p.organization_id = ii.organization_id
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
        JOIN inventory_items ii ON eit.inventory_item_id = ii.id AND ii.organization_id = eit.organization_id
        JOIN store_areas sa ON ii.location_id = sa.id AND sa.organization_id = ii.organization_id
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

    // DELIBERATELY NOT ORGANIZATION-SCOPED — do not "fix" this to match its
    // neighbours without reading the route first.
    //
    // This is the one mutation in this file with no organization predicate, so
    // it looks exactly like the defect fixed in #462. It is not. Catalogue
    // corrections are reviewed by a PLATFORM admin across all tenants, and both
    // this method and `listCatalogueCorrections` (which returns an
    // `organization` field per row for precisely this reason) are gated by
    // `isPlatformAdminUser` at index-minimal.ts, not by tenant membership.
    // Adding an org predicate here would break platform review.
    //
    // Recorded because an audit sweep for "mutations missing organization_id"
    // flags this first, and the guard that makes it correct lives in a
    // different file.
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
        JOIN inventory_items ii ON ii.id = eit.inventory_item_id AND ii.organization_id = eit.organization_id
        JOIN products p ON p.id = ii.product_id AND p.organization_id = ii.organization_id
        LEFT JOIN suppliers s ON s.id = p.supplier_id AND s.organization_id = p.organization_id
        LEFT JOIN brands b ON b.id = p.brand_id AND b.organization_id = p.organization_id
        LEFT JOIN suppliers bs ON bs.id = b.supplier_id AND bs.organization_id = b.organization_id
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
        JOIN products p ON ii.product_id = p.id AND p.organization_id = ii.organization_id
        JOIN store_areas sa ON ii.location_id = sa.id AND sa.organization_id = ii.organization_id
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
      maxSkus: number,
    ): Promise<Product | null> {
      // Tier SKU cap checked inside the statement that consumes it, so the
      // check cannot go stale across a network round trip the way a
      // read-then-insert would (Neon's HTTP driver has no transaction to wrap
      // the pair in, which is what `product.service.ts:145` uses `$transaction`
      // for in Express).
      //
      // **This is a soft cap, not an exact one.** Each statement runs as its
      // own implicit transaction under READ COMMITTED and snapshots at
      // statement start, so two creates racing at limit-1 can both see room and
      // both insert. The overshoot is bounded by the number of in-flight
      // requests, not unbounded, and the window is the snapshot-to-commit
      // interval rather than a full round trip -- but it is a narrowed race,
      // not a closed one. An exact cap needs something this driver cannot
      // express in one statement: SERIALIZABLE, a per-org advisory lock, or a
      // counter row claimed with `UPDATE ... SET used = used + 1 WHERE used <
      // cap` (which re-checks the predicate after taking the row lock). See
      // `utils/usage-limits.ts` for why a counter is not the obvious answer
      // here.
      //
      // Zero rows back means the cap was reached -- the caller turns that into
      // a 402, and cannot confuse it with a failed insert, which throws.
      const rows = await sql`
        INSERT INTO products (organization_id, barcode, sku, name, cost_price, notes, created_at, updated_at)
        SELECT
          ${organizationId},
          ${data.barcode},
          ${data.sku ?? data.barcode},
          ${data.name},
          ${data.costPrice ?? 0},
          ${data.notes ?? ''},
          NOW(),
          NOW()
        WHERE (
          SELECT COUNT(*) FROM products WHERE organization_id = ${organizationId}
        ) < ${maxSkus}
        RETURNING id, name, barcode, sku,
                  cost_price as "costPrice", notes,
                  created_at as "createdAt", updated_at as "updatedAt"
      `;
      return (rows[0] as Product) ?? null;
    },

    /**
     * Partial update of a product, scoped to the organization.
     *
     * Every field is optional and only the ones supplied move. The `COALESCE`
     * form expresses that in a single statement: a parameter left `null` falls
     * back to the column's current value, so there is no dynamic SQL and no
     * read-then-write pair for the Neon HTTP driver to lose a transaction
     * around (same constraint `createProduct` above works within).
     *
     * **The consequence is that no column here can be set to NULL** -- a null
     * parameter means "leave alone", so the two meanings collide. That is
     * acceptable only because nothing needs to clear these fields: Express's
     * `buildProductUpdateData` (`product.controller.ts:77`) copies a key only
     * when it is not `undefined` and its typed shape never carries null, so
     * clearing was not expressible there either. If a "clear the SKU" case ever
     * arrives, this needs a separate explicit sentinel, not a looser COALESCE.
     *
     * Returns null when no row matched -- either the id does not exist, or it
     * belongs to another organization. The caller must not distinguish those
     * two in its response (see `handleUpdateProduct`).
     */
    async updateProduct(
      organizationId: string,
      id: number,
      data: {
        barcode?: string;
        sku?: string;
        name?: string;
        costPrice?: number;
        notes?: string;
      },
    ): Promise<Product | null> {
      const rows = await sql`
        UPDATE products
        SET barcode    = COALESCE(${data.barcode ?? null}, barcode),
            sku        = COALESCE(${data.sku ?? null}, sku),
            name       = COALESCE(${data.name ?? null}, name),
            cost_price = COALESCE(${data.costPrice ?? null}, cost_price),
            notes      = COALESCE(${data.notes ?? null}, notes),
            updated_at = NOW()
        WHERE id = ${id} AND organization_id = ${organizationId}
        RETURNING id, name, barcode, sku,
                  cost_price as "costPrice", notes,
                  created_at as "createdAt", updated_at as "updatedAt"
      `;
      return (rows[0] as Product) ?? null;
    },

    /**
     * The products beyond the organization's SKU cap, oldest kept and newest
     * exported -- the ordering Express used (`product.repository.ts`
     * `findExcessProductsByOrganization`: `orderBy createdAt asc, skip maxSkus`).
     *
     * **`id` is added as a tiebreaker, which Express did not have.** Bulk CSV
     * import writes hundreds of rows inside one statement, so identical
     * `created_at` values are the norm here rather than an edge case, and
     * Postgres is free to order ties differently between two executions of the
     * same query. Without the tiebreaker a customer could export one backup,
     * delete from it, and find they had deleted a product the export never
     * listed -- while a product that *was* over the cap stayed. `id` is the
     * insertion order within a tied batch, so it keeps "oldest survives".
     */
    async findExcessProducts(organizationId: string, maxSkus: number): Promise<ExcessProduct[]> {
      const rows = await sql`
        SELECT
          p.id,
          p.sku,
          p.name,
          p.barcode,
          COALESCE(p.cost_price, 0) AS "costPrice",
          p.created_at AS "createdAt",
          (
            SELECT COUNT(*)::int
            FROM inventory_items i
            WHERE i.product_id = p.id
          ) AS "inventoryCount"
        FROM products p
        WHERE p.organization_id = ${organizationId}
        ORDER BY p.created_at ASC, p.id ASC
        OFFSET ${maxSkus}
      `;

      return rows.map((row) => ({
        id: Number(row.id),
        sku: (row.sku as string | null) ?? null,
        name: String(row.name),
        barcode: (row.barcode as string | null) ?? null,
        costPrice: Number(row.costPrice ?? 0),
        createdAt: new Date(row.createdAt as string | Date).toISOString(),
        inventoryCount: Number(row.inventoryCount ?? 0),
      }));
    },

    /**
     * Delete one product, refusing rather than failing when inventory items
     * still reference it. See {@link DeleteProductResult} for why the refusal
     * is counted instead of caught.
     *
     * Single statement so the count and the delete cannot separate: a
     * count-then-delete would let an inventory item land in the gap and hit the
     * `ON DELETE RESTRICT` constraint anyway, turning the considered 409 back
     * into the 500 this replaces. Note this closes the FK race, not a business
     * race -- an inventory item created against a product deleted in the same
     * instant still loses, which is what the constraint is for.
     *
     * The blocking count is scoped to `product_id` alone, with no
     * `organization_id` predicate, because that is exactly the constraint's own
     * scope. Adding the org filter would let a cross-tenant row (which should
     * not exist, but whose existence is the only case where the two scopes
     * differ) pass the check and then raise the FK. The *delete* stays
     * org-scoped, so this reads no other tenant's data -- it only counts.
     */
    async deleteProduct(organizationId: string, id: number): Promise<DeleteProductResult> {
      const rows = await sql`
        WITH blocking AS (
          SELECT COUNT(*)::int AS n
          FROM inventory_items
          WHERE product_id = ${id}
        ), target AS (
          SELECT id FROM products
          WHERE id = ${id} AND organization_id = ${organizationId}
        ), deleted AS (
          DELETE FROM products
          WHERE id = ${id}
            AND organization_id = ${organizationId}
            AND (SELECT n FROM blocking) = 0
          RETURNING id
        )
        SELECT
          (SELECT COUNT(*)::int FROM target) AS found,
          (SELECT n FROM blocking) AS "inventoryCount",
          (SELECT COUNT(*)::int FROM deleted) AS removed
      `;

      const row = rows[0];
      if (Number(row?.removed ?? 0) > 0) {
        return { outcome: 'deleted' };
      }
      if (Number(row?.found ?? 0) === 0) {
        return { outcome: 'not_found' };
      }
      return { outcome: 'blocked', inventoryCount: Number(row?.inventoryCount ?? 0) };
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
        LEFT JOIN store_areas s ON i.location_id = s.id AND s.organization_id = i.organization_id
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
        LEFT JOIN store_areas s ON i.location_id = s.id AND s.organization_id = i.organization_id
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
      maxActiveExpiries: number,
    ): Promise<InventoryItem | null> {
      // Validate product + location belong to the same org
      await assertReferencesBelongToOrganization(sql, organizationId, {
        productId: data.productId,
        locationId: data.locationId,
      });

      // Atomic insert + audit via CTE so we never end up with an inventory
      // item lacking an audit row (or vice versa) on partial failure.
      //
      // The tier active-expiry cap rides in the same CTE: the WHERE turns the
      // INSERT into a no-op when the org is at its limit, `audited` then has no
      // rows to write, and the final SELECT returns nothing -- so a refusal
      // cannot leave an orphaned audit entry. The excluded statuses mirror
      // `countActiveExpiryItems` (backend/src/repositories/subscription.repository.ts:149)
      // so the Worker refuses on exactly the population Express counted.
      //
      // Same soft-cap caveat as `createProduct`: READ COMMITTED lets concurrent
      // creates at limit-1 both observe room. See `utils/usage-limits.ts`.
      const rows = await sql`
        WITH inserted AS (
          INSERT INTO inventory_items
            (organization_id, product_id, expiry_date, location_id, status, created_at, updated_at)
          SELECT
            ${organizationId}, ${data.productId}, ${data.expiryDate}, ${data.locationId},
            ${data.status ?? 'Normal'}, NOW(), NOW()
          WHERE (
            SELECT COUNT(*) FROM inventory_items
            WHERE organization_id = ${organizationId}
              AND status <> ALL(${TERMINAL_INVENTORY_STATUSES})
          ) < ${maxActiveExpiries}
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

      return (rows[0] as InventoryItem) ?? null;
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

      // Whichever references this patch supplies must belong to the caller's
      // organization. Same helper as the create path, so the two cannot drift
      // apart again — see its comment for what that drift cost.
      await assertReferencesBelongToOrganization(sql, organizationId, {
        productId: data.productId,
        locationId: data.locationId,
      });

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
    async seedDemoData(organizationId: string): Promise<SeedDemoDataResult> {
      // Port of Express's `SeedService.seedDemoData`
      // (`backend/src/services/seed.service.ts:325`), which wrapped ~20
      // statements in a Prisma `$transaction`. Neon's HTTP driver has no
      // transaction (see the note at :834), so the whole seed is ONE statement:
      // a chain of CTEs runs inside the implicit transaction every statement
      // already gets, which is the same atomicity without a session.
      //
      // **Idempotency rests on the unique indexes, not on read-then-write.**
      // Express checked `findBySku` / `findByNameAndSubDepartment` first and
      // inserted if absent, which is check-then-act: two clicks of "Load Demo
      // Data" racing each other both read "absent" and both insert. Here the
      // store-area and product legs are `ON CONFLICT DO NOTHING` against
      // `store_areas_organization_id_name_sub_department_key` and
      // `products_organization_id_sku_key`, so the database refuses the
      // duplicate rather than the code hoping not to see one.
      //
      // The conflict clauses are deliberately untargeted. `products` carries
      // TWO unique indexes -- sku and barcode -- and a targeted
      // `ON CONFLICT (organization_id, sku)` would let a barcode collision
      // (an existing product holding one of these demo barcodes under a
      // different sku) raise and take the entire seed down. Untargeted, that
      // row is skipped: `resolved_products` finds no id for it and the
      // `WHERE rp.id IS NOT NULL` guard drops its inventory item too.
      //
      // **One leg is not constraint-protected.** `inventory_items` has no
      // unique index over (organization_id, product_id, location_id), so its
      // idempotency is the `NOT EXISTS` guard: atomic within this statement,
      // but not isolated against a concurrent seed of the same organization.
      // Two simultaneous seeds can each insert one inventory item per pair.
      // That is strictly no worse than Express, whose `findFirst`-then-create
      // had the same race inside its transaction under READ COMMITTED, and
      // closing it properly means a new unique index, which is a migration.
      //
      // **Expiry months are per-row constants, where Express computed them.**
      // Its expression was `areaIndex === 2 ? 6 : productsCreatedCount % 2 === 0 ? 3 : 18`
      // -- a counter of how many products this run had created SO FAR, so a
      // second run over a half-seeded organization gave the same product a
      // different expiry date. Nothing depends on that; a fixed value per row
      // reproduces the same spread (3, 6 and 18 months out) deterministically.
      //
      // **Usage limits do not apply.** The interactive create path enforces the
      // tier product cap inside its INSERT; seeding deliberately does not, so
      // onboarding cannot fail on a cap the operator has not yet had a chance
      // to raise. An organization can therefore finish onboarding holding more
      // products than its tier allows, and the next interactive create is what
      // refuses.
      const rows = await sql`
        WITH area_input (idx, name, sub_department) AS (
          VALUES (0, 'Front Shelf', 'Over-the-Counter'),
                 (1, 'Back Storage', 'Prescription'),
                 (2, 'Cooler', 'Refrigerated')
        ),
        inserted_areas AS (
          INSERT INTO store_areas (organization_id, name, sub_department, created_at, updated_at)
          SELECT ${organizationId}, ai.name, ai.sub_department, NOW(), NOW()
          FROM area_input ai
          ON CONFLICT DO NOTHING
          RETURNING id, name, sub_department
        ),
        areas AS (
          SELECT ai.idx, COALESCE(ins.id, ex.id) AS id
          FROM area_input ai
          LEFT JOIN inserted_areas ins
            ON ins.name = ai.name AND ins.sub_department = ai.sub_department
          LEFT JOIN store_areas ex
            ON ex.organization_id = ${organizationId}
           AND ex.name = ai.name
           AND ex.sub_department = ai.sub_department
        ),
        product_input (sku, name, barcode, cost_price, area_idx, months) AS (
          VALUES
            ('VIT-C-500', 'Vitamin C 500mg', '123456789012', 5.5, 0, 3),
            ('IBU-200', 'Ibuprofen 200mg', '123456789013', 4.2, 0, 18),
            ('PARA-500', 'Paracetamol 500mg', '123456789014', 3.8, 0, 3),
            ('AMOX-250', 'Amoxicillin 250mg', '123456789015', 12.0, 1, 18),
            ('LISI-10', 'Lisinopril 10mg', '123456789016', 8.5, 1, 3),
            ('MET-500', 'Metformin 500mg', '123456789017', 6.0, 1, 18),
            ('INSU-GLA', 'Insulin Glargine', '123456789018', 45.0, 2, 6),
            ('EPI-300', 'EpiPen 0.3mg', '123456789019', 150.0, 2, 6)
        ),
        inserted_products AS (
          INSERT INTO products (organization_id, barcode, sku, name, cost_price, created_at, updated_at)
          SELECT ${organizationId}, pi.barcode, pi.sku, pi.name, pi.cost_price, NOW(), NOW()
          FROM product_input pi
          ON CONFLICT DO NOTHING
          RETURNING id, sku
        ),
        resolved_products AS (
          SELECT pi.sku, pi.area_idx, pi.months, COALESCE(ip.id, ep.id) AS id
          FROM product_input pi
          LEFT JOIN inserted_products ip ON ip.sku = pi.sku
          LEFT JOIN products ep
            ON ep.organization_id = ${organizationId} AND ep.sku = pi.sku
        ),
        inserted_items AS (
          INSERT INTO inventory_items (
            organization_id, product_id, location_id, expiry_date, status, created_at, updated_at
          )
          SELECT ${organizationId}, rp.id, a.id,
                 CURRENT_DATE + (rp.months * INTERVAL '1 month'),
                 'Normal', NOW(), NOW()
          FROM resolved_products rp
          JOIN areas a ON a.idx = rp.area_idx
          WHERE rp.id IS NOT NULL
            AND a.id IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM inventory_items ii
              WHERE ii.organization_id = ${organizationId}
                AND ii.product_id = rp.id
                AND ii.location_id = a.id
            )
          RETURNING id
        )
        SELECT
          (SELECT COUNT(*) FROM inserted_areas)::int AS "areasCreated",
          (SELECT COUNT(*) FROM inserted_products)::int AS "productsCreated",
          (SELECT COUNT(*) FROM inserted_items)::int AS "inventoryItemsCreated"
      `;

      const row = rows[0] as
        | { areasCreated: number; productsCreated: number; inventoryItemsCreated: number }
        | undefined;

      return {
        success: true,
        areasCreated: row?.areasCreated ?? 0,
        productsCreated: row?.productsCreated ?? 0,
        inventoryItemsCreated: row?.inventoryItemsCreated ?? 0,
      };
    },

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

    /**
     * Create a user with a chosen role, capped at the tier's seats and audited
     * in the same statement. See `insertOrganizationUser`.
     */
    async createOrganizationUser(
      organizationId: string,
      data: { username: string | null; role: string; seatCap: number; actor: RoleChangeActor },
    ): Promise<UserListItem | null> {
      return insertOrganizationUser(sql, { organizationId, ...data });
    },

    /**
     * Change a user's role and record it in `org_audit_log`. See
     * `applyUserRoleChange` for why this is one statement.
     */
    async updateUserRole(
      organizationId: string,
      userId: number,
      role: string,
      actor: RoleChangeActor,
    ): Promise<UserRoleChange | null> {
      return applyUserRoleChange(sql, { organizationId, userId, role, actor });
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
