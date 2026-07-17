// Types for the Supplier Credits workspace. Mirror the backend response shapes
// (shared/domain/credit-claim rollups + Prisma records).

export interface Supplier {
  id: number;
  name: string;
  contactEmail: string | null;
  creditPolicyNote: string;
  policyWriteOffQty: number | null;
  policyCreditQty: number | null;
  followUpDays: number;
  contactPhone: string | null;
  representativeName: string | null;
  representativeEmail: string | null;
  policyUpdatedAt: string | null;
}

export interface SupplierInput {
  name: string;
  contactEmail?: string | null;
  creditPolicyNote?: string;
  policyWriteOffQty?: number | null;
  policyCreditQty?: number | null;
  followUpDays?: number;
  contactPhone?: string | null;
  representativeName?: string | null;
  representativeEmail?: string | null;
}

export type PolicyStatus = 'ATTACHED' | 'MISSING';

export interface PolicyReviewItem {
  brandId: number;
  brandName: string;
  supplier: Supplier | null;
  status: PolicyStatus;
  policyUpdatedAt: string | null;
  representativeName: string | null;
}

export interface BulkAttachPolicyResult {
  attached: number;
  unchanged: number;
  corrections: number;
}

export interface BulkLinkProductsResult {
  brandId: number;
  linked: number;
  alreadyLinked: number;
  corrections: number;
}

export type BulkLinkProductsInput =
  | { brandId: number; productIds: number[]; brandName?: never }
  | { brandName: string; productIds: number[]; brandId?: never };

export interface ClaimablePoolItem {
  transactionId: number;
  productId: number;
  sku: string;
  productName: string;
  unitsDiscarded: number;
  costPrice: number;
  expectedCreditUnits: number | null;
  expectedCreditValue: number | null;
  brandId?: number | null;
  brandName?: string | null;
  brandSource?: string | null;
  suggestedSupplierName?: string | null;
}

export type ClaimabilityState = 'NEEDS_BRAND' | 'PENDING_CONFIRMATION' | 'CLAIMABLE' | 'NO_POLICY';

export interface ClaimablePoolGroup {
  supplierId: number | null;
  supplierName: string | null;
  items: ClaimablePoolItem[];
  expectedCreditValueTotal: number;
  state: ClaimabilityState;
}

export interface Brand {
  id: number;
  name: string;
  manufacturerName: string | null;
  suggestedSupplierName: string | null;
  supplierId: number | null;
  source: 'REFERENCE' | 'USER_ADDED' | 'CONFIRMED';
}

export interface BrandReviewItem {
  productId: number;
  sku: string;
  barcode: string;
  productName: string;
  brand: Brand | null;
}

export interface BrandReviewPage {
  items: BrandReviewItem[];
  nextCursor: number | null;
  page?: number;
  pageSize?: number;
  totalItems?: number;
  totalPages?: number;
}

export type CatalogueReviewState = 'NEEDS_BRAND' | 'PENDING_CONFIRMATION' | 'CONFIRMED';
export type CatalogueTitleMatch = 'contains' | 'startsWith';
export type CatalogueTitleSort = 'titleAsc' | 'titleDesc';

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

export interface BuildClaimLineInput {
  expiredItemTransactionId: number;
  batchNumber?: string | null;
  unitsClaimed?: number;
}

export type ClaimOutcome = 'CREDITED' | 'PARTIALLY_CREDITED' | 'REJECTED';

export interface SupplierRecovery {
  supplierId: number;
  supplierName: string;
  claimsSent: number;
  claimsCredited: number;
  expectedValue: number;
  creditedValue: number;
  recoveryRate: number | null;
}

export interface RecoveryReport {
  outstandingValue: number;
  unclaimedValue: number;
  suppliers: SupplierRecovery[];
}
