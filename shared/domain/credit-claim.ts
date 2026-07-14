// Shared supplier credit-claim domain. Both backends (SQLite dev repo and the
// Cloudflare Workers Neon path) must agree on the claim status vocabulary, the
// expected-credit maths, and the follow-up schedule, so those live here rather
// than being re-derived per backend (golden rule 5). The SQL that *fetches* the
// rows differs per dialect; this module owns the pure logic on top of them.

import { resolveSupplier } from './brand-supplier';

// ── Status vocabulary (String columns + const-union, per shared/domain/disposition.ts) ──

export const CREDIT_CLAIM_STATUSES = [
  'DRAFT',
  'SENDING',
  'SENT',
  'ACKNOWLEDGED',
  'CREDITED',
  'PARTIALLY_CREDITED',
  'REJECTED',
  'CANCELLED',
] as const;

export type CreditClaimStatus = (typeof CREDIT_CLAIM_STATUSES)[number];

/** Statuses where the credit is resolved: no more chasing, photos may be purged. */
export const SETTLED_CLAIM_STATUSES = [
  'CREDITED',
  'PARTIALLY_CREDITED',
  'REJECTED',
  'CANCELLED',
] as const satisfies readonly CreditClaimStatus[];

/** Statuses that are still open with the supplier and may be followed up. */
export const CHASEABLE_CLAIM_STATUSES = [
  'SENT',
  'ACKNOWLEDGED',
] as const satisfies readonly CreditClaimStatus[];

export function isSettledClaimStatus(status: string): boolean {
  return (SETTLED_CLAIM_STATUSES as readonly string[]).includes(status);
}

export function isChaseableClaimStatus(status: string): boolean {
  return (CHASEABLE_CLAIM_STATUSES as readonly string[]).includes(status);
}

export const CREDIT_CLAIM_EVENT_TYPES = [
  'CREATED',
  'SENT',
  'FOLLOW_UP_SENT',
  'ACKNOWLEDGED',
  'CREDITED',
  'PARTIALLY_CREDITED',
  'REJECTED',
  'CANCELLED',
  'NOTE',
] as const;

export type CreditClaimEventType = (typeof CREDIT_CLAIM_EVENT_TYPES)[number];

// ── Expected credit ──────────────────────────────────────────────────────────

/**
 * A supplier's structured credit ratio, e.g. `{ writeOffQty: 3, creditQty: 1 }`
 * for "3-for-1". Either field null/absent means the policy is free-text only and
 * expected credit cannot be computed — callers should treat that as *unknown*,
 * not zero.
 */
export interface CreditPolicyRatio {
  writeOffQty: number | null;
  creditQty: number | null;
}

export interface ExpectedCredit {
  /** Units expected back, or null when the policy has no structured ratio. */
  units: number | null;
  /** Monetary value of `units` at `unitCostValue`, or null when unknown. */
  value: number | null;
}

/**
 * Expected credit for a single claim line. With a 3→1 ratio, 6 units written off
 * yields 2 units (`floor(6 / 3) * 1`); 1 unit yields 0 (below the threshold, so
 * the UI can advise "no credit"). Returns unknown (`null`) when the supplier has
 * no structured ratio, so an absent policy is never silently treated as zero.
 */
export function expectedCredit(
  policy: CreditPolicyRatio,
  unitsClaimed: number,
  unitCostValue: number | null = null,
): ExpectedCredit {
  const { writeOffQty, creditQty } = policy;
  if (
    writeOffQty == null ||
    creditQty == null ||
    writeOffQty <= 0 ||
    creditQty < 0 ||
    !Number.isFinite(unitsClaimed) ||
    unitsClaimed < 0
  ) {
    return { units: null, value: null };
  }

  const units = Math.floor(unitsClaimed / writeOffQty) * creditQty;
  const value = unitCostValue == null ? null : units * unitCostValue;
  return { units, value };
}

// ── Follow-up schedule ───────────────────────────────────────────────────────

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The next follow-up time for a sent claim. Deterministic from the send time so
 * it never depends on when the job happens to run: after sending (count 0) the
 * first nudge is `sentAt + followUpDays`; after N follow-ups it is
 * `sentAt + followUpDays * (N + 1)`.
 */
export function nextFollowUp(sentAt: Date, followUpDays: number, followUpCount: number): Date {
  const days = Math.max(1, followUpDays) * (Math.max(0, followUpCount) + 1);
  return new Date(sentAt.getTime() + days * MS_PER_DAY);
}

export interface FollowUpState {
  status: string;
  nextFollowUpAt: Date | null;
}

/**
 * Whether a claim is due for a follow-up nudge now. Only open (chaseable) claims
 * with a scheduled time in the past qualify; settled claims are never chased.
 */
export function isFollowUpDue(claim: FollowUpState, now: Date): boolean {
  if (!isChaseableClaimStatus(claim.status)) return false;
  if (claim.nextFollowUpAt == null) return false;
  return claim.nextFollowUpAt.getTime() <= now.getTime();
}

// ── Claimable-pool rollup ────────────────────────────────────────────────────

/**
 * One expired write-off that has not yet been attached to a claim, joined to its
 * product and (nullable) supplier. Both backends fetch these rows in their own
 * dialect; this module groups them identically.
 */
export interface ClaimableWriteOffRow {
  transactionId: number;
  supplierId: number | null;
  supplierName: string | null;
  policyWriteOffQty: number | null;
  policyCreditQty: number | null;
  creditPolicyNote?: string | null;
  brandId?: number | null;
  brandName?: string | null;
  brandSource?: string | null;
  suggestedSupplierName?: string | null;
  brandSupplierId?: number | null;
  brandSupplierName?: string | null;
  brandPolicyWriteOffQty?: number | null;
  brandPolicyCreditQty?: number | null;
  brandCreditPolicyNote?: string | null;
  productId: number;
  sku: string;
  productName: string;
  unitsDiscarded: number;
  costPrice: number;
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
  brandId: number | null;
  brandName: string | null;
}

export const CLAIMABILITY_STATES = [
  'NEEDS_BRAND',
  'PENDING_CONFIRMATION',
  'CLAIMABLE',
  'NO_POLICY',
] as const;

export type ClaimabilityState = (typeof CLAIMABILITY_STATES)[number];

export interface ClaimablePoolGroup {
  /** Null for the "needs supplier" bucket (products with no supplier assigned). */
  supplierId: number | null;
  supplierName: string | null;
  items: ClaimablePoolItem[];
  /** Sum of known line values; null contributions (unknown policy) are skipped. */
  expectedCreditValueTotal: number;
  state: ClaimabilityState;
}

// Sort so grouped output is stable across backends (golden rule 5 checks row
// order): real suppliers first by name, then the needs-supplier bucket last.
function compareGroups(a: ClaimablePoolGroup, b: ClaimablePoolGroup): number {
  if (a.supplierId == null && b.supplierId != null) return 1;
  if (a.supplierId != null && b.supplierId == null) return -1;
  if (a.supplierId == null && b.supplierId == null && a.state !== b.state) {
    if (a.state === 'NEEDS_BRAND') return 1;
    if (b.state === 'NEEDS_BRAND') return -1;
  }
  const nameA = a.supplierName ?? '';
  const nameB = b.supplierName ?? '';
  if (nameA !== nameB) return nameA < nameB ? -1 : 1;
  return (a.supplierId ?? 0) - (b.supplierId ?? 0);
}

interface ResolvedClaimSupplier {
  id: number | null;
  name: string | null;
  writeOffQty: number | null;
  creditQty: number | null;
  policyNote: string | null;
  state: ClaimabilityState;
  key: string;
}

function resolveClaimSupplier(row: ClaimableWriteOffRow): ResolvedClaimSupplier {
  const supplierId = resolveSupplier(
    { supplierId: row.supplierId },
    { supplierId: row.brandSupplierId },
  );

  if (supplierId != null && row.supplierId != null) {
    const hasPolicy =
      row.policyWriteOffQty != null ||
      row.policyCreditQty != null ||
      Boolean(row.creditPolicyNote?.trim());
    return {
      id: row.supplierId,
      name: row.supplierName,
      writeOffQty: row.policyWriteOffQty,
      creditQty: row.policyCreditQty,
      policyNote: row.creditPolicyNote ?? null,
      state: hasPolicy ? 'CLAIMABLE' : 'NO_POLICY',
      key: `s:${row.supplierId}`,
    };
  }

  if (supplierId != null && row.brandSupplierId != null) {
    const hasPolicy =
      row.brandPolicyWriteOffQty != null ||
      row.brandPolicyCreditQty != null ||
      Boolean(row.brandCreditPolicyNote?.trim());
    return {
      id: row.brandSupplierId,
      name: row.brandSupplierName ?? null,
      writeOffQty: row.brandPolicyWriteOffQty ?? null,
      creditQty: row.brandPolicyCreditQty ?? null,
      policyNote: row.brandCreditPolicyNote ?? null,
      state:
        row.brandSource === 'REFERENCE'
          ? 'PENDING_CONFIRMATION'
          : hasPolicy
            ? 'CLAIMABLE'
            : 'NO_POLICY',
      key: `s:${row.brandSupplierId}`,
    };
  }

  const suggestion = row.suggestedSupplierName?.trim() || null;
  if (row.brandId != null && row.brandSource === 'REFERENCE' && suggestion) {
    return {
      id: null,
      name: suggestion,
      writeOffQty: null,
      creditQty: null,
      policyNote: null,
      state: 'PENDING_CONFIRMATION',
      key: `suggested:${suggestion.toUpperCase()}`,
    };
  }

  const brandName = row.brandName?.trim() || null;
  if (row.brandId != null && brandName) {
    return {
      id: null,
      name: brandName,
      writeOffQty: null,
      creditQty: null,
      policyNote: null,
      state: 'PENDING_CONFIRMATION',
      key: `brand:${row.brandId}`,
    };
  }

  return {
    id: null,
    name: null,
    writeOffQty: null,
    creditQty: null,
    policyNote: null,
    state: 'NEEDS_BRAND',
    key: 'needs-brand',
  };
}

/**
 * Group unclaimed write-offs by supplier, computing per-line expected credit and
 * a per-group value total. Products with no supplier collect into a single
 * `supplierId: null` "needs supplier" group so the UI can prompt assignment.
 */
export function rollupClaimablePool(rows: ClaimableWriteOffRow[]): ClaimablePoolGroup[] {
  const groups = new Map<string, ClaimablePoolGroup>();

  for (const row of rows) {
    const resolved = resolveClaimSupplier(row);
    let group = groups.get(resolved.key);
    if (!group) {
      group = {
        supplierId: resolved.id,
        supplierName: resolved.name,
        items: [],
        expectedCreditValueTotal: 0,
        state: resolved.state,
      };
      groups.set(resolved.key, group);
    }

    const credit = expectedCredit(
      { writeOffQty: resolved.writeOffQty, creditQty: resolved.creditQty },
      row.unitsDiscarded,
      row.costPrice,
    );

    group.items.push({
      transactionId: row.transactionId,
      productId: row.productId,
      sku: row.sku,
      productName: row.productName,
      unitsDiscarded: row.unitsDiscarded,
      costPrice: row.costPrice,
      expectedCreditUnits: credit.units,
      expectedCreditValue: credit.value,
      brandId: row.brandId ?? null,
      brandName: row.brandName ?? null,
    });

    if (credit.value != null) {
      group.expectedCreditValueTotal += credit.value;
    }
  }

  const result = [...groups.values()].sort(compareGroups);
  // Stable line ordering within a group: by transaction id (insertion is already
  // query-ordered, but pin it so the two backends can never drift).
  for (const group of result) {
    group.items.sort((a, b) => a.transactionId - b.transactionId);
  }
  return result;
}

// ── Recovery report ──────────────────────────────────────────────────────────

/** One ever-sent claim, reduced to the fields the recovery rollup needs. */
export interface RecoveryClaimRow {
  supplierId: number;
  supplierName: string;
  status: string;
  expectedCreditValue: number | null;
  creditedValue: number | null;
}

export interface SupplierRecovery {
  supplierId: number;
  supplierName: string;
  claimsSent: number;
  claimsCredited: number;
  expectedValue: number;
  creditedValue: number;
  /** creditedValue / expectedValue, or null when nothing was expected. */
  recoveryRate: number | null;
}

export interface RecoveryReport {
  /** Expected credit still owed on sent-but-unsettled claims. */
  outstandingValue: number;
  /** Value of eligible write-offs never attached to a claim ("money on the table"). */
  unclaimedValue: number;
  suppliers: SupplierRecovery[];
}

/**
 * Aggregate ever-sent claims into per-supplier recovery plus the org totals. Both
 * backends fetch the claim rows + the unclaimed value in their own dialect and feed
 * them here, so the maths (and row order) can never drift (golden rule 5).
 */
export function rollupRecoveryReport(
  claims: RecoveryClaimRow[],
  unclaimedValue: number,
): RecoveryReport {
  const bySupplier = new Map<number, SupplierRecovery>();
  let outstandingValue = 0;

  for (const claim of claims) {
    if (isChaseableClaimStatus(claim.status)) {
      outstandingValue += claim.expectedCreditValue ?? 0;
    }

    let row = bySupplier.get(claim.supplierId);
    if (!row) {
      row = {
        supplierId: claim.supplierId,
        supplierName: claim.supplierName,
        claimsSent: 0,
        claimsCredited: 0,
        expectedValue: 0,
        creditedValue: 0,
        recoveryRate: null,
      };
      bySupplier.set(claim.supplierId, row);
    }

    row.claimsSent += 1;
    row.expectedValue += claim.expectedCreditValue ?? 0;
    if (claim.status === 'CREDITED' || claim.status === 'PARTIALLY_CREDITED') {
      row.claimsCredited += 1;
      row.creditedValue += claim.creditedValue ?? 0;
    }
  }

  const suppliers = [...bySupplier.values()]
    .map((row) => ({
      ...row,
      recoveryRate: row.expectedValue > 0 ? row.creditedValue / row.expectedValue : null,
    }))
    .sort((a, b) =>
      a.supplierName === b.supplierName
        ? a.supplierId - b.supplierId
        : a.supplierName < b.supplierName
          ? -1
          : 1,
    );

  return { outstandingValue, unclaimedValue, suppliers };
}
