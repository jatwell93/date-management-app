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
}

export interface SupplierInput {
  name: string;
  contactEmail?: string | null;
  creditPolicyNote?: string;
  policyWriteOffQty?: number | null;
  policyCreditQty?: number | null;
  followUpDays?: number;
}

export interface ClaimablePoolItem {
  transactionId: number;
  productId: number;
  sku: string;
  productName: string;
  unitsDiscarded: number;
  costPrice: number;
  expectedCreditUnits: number | null;
  expectedCreditValue: number | null;
}

export interface ClaimablePoolGroup {
  supplierId: number | null;
  supplierName: string | null;
  items: ClaimablePoolItem[];
  expectedCreditValueTotal: number;
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
