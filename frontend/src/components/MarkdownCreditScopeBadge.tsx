import { Link } from 'react-router-dom';
import type { MarkdownCreditContext } from '@shared/markdown-credit-context';
import { Badge } from './ui/badge';

const LABELS: Record<MarkdownCreditContext['creditScopeReason'], string> = {
  FULL_CREDIT: 'Full credit',
  NO_CREDIT: 'No credit',
  NO_POLICY: 'No policy',
  PENDING_CONFIRMATION: 'Confirm supplier',
  NEEDS_BRAND: 'Needs brand',
};

export function MarkdownCreditScopeBadge({
  creditScopeReason,
  creditSupplierId,
  creditSupplierName,
}: MarkdownCreditContext) {
  const catalogueReview =
    creditScopeReason === 'PENDING_CONFIRMATION' || creditScopeReason === 'NEEDS_BRAND';
  const policyReview = creditScopeReason === 'NO_POLICY';
  const params = new URLSearchParams();

  if (catalogueReview) params.set('view', 'catalogue-review');
  if (policyReview) params.set('view', 'policy-review');
  if (creditSupplierId != null) params.set('supplierId', String(creditSupplierId));

  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-xs">
      <Badge title={creditSupplierName ?? undefined}>{LABELS[creditScopeReason]}</Badge>
      {(catalogueReview || policyReview) && (
        <Link
          className="font-medium text-semantic-primary underline-offset-2 hover:underline"
          to={`/supplier-credits?${params.toString()}`}
        >
          {policyReview ? 'Review policy' : 'Review catalogue'}
        </Link>
      )}
    </span>
  );
}
