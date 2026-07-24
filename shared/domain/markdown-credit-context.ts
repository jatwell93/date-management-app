import type { ResolvedSupplierContext, SupplierContextCandidate } from './brand-supplier';
import type { CreditScope } from './markdown';
import { creditScopeForSupplier, type SupplierPolicyRecord } from './supplier-policy';

export const CREDIT_SCOPE_REASONS = [
  'FULL_CREDIT',
  'NO_CREDIT',
  'NO_POLICY',
  'PENDING_CONFIRMATION',
  'NEEDS_BRAND',
] as const;

export type CreditScopeReason = (typeof CREDIT_SCOPE_REASONS)[number];

export interface MarkdownCreditContext {
  creditScope: CreditScope;
  creditScopeReason: CreditScopeReason;
  creditSupplierId: number | null;
  creditSupplierName: string | null;
}

type CreditSupplier = SupplierContextCandidate & Pick<SupplierPolicyRecord, 'creditType'>;

export function resolveMarkdownCreditContext(
  resolved: ResolvedSupplierContext<CreditSupplier>,
): MarkdownCreditContext {
  const identity = {
    creditSupplierId: resolved.supplier?.id ?? null,
    creditSupplierName: resolved.supplierName,
  };

  if (resolved.state !== 'CLAIMABLE') {
    return {
      creditScope: 'NO_CREDIT',
      creditScopeReason: resolved.state,
      ...identity,
    };
  }

  const creditScope = creditScopeForSupplier(resolved.supplier);
  return {
    creditScope,
    creditScopeReason: creditScope,
    ...identity,
  };
}
