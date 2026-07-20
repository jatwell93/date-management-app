export const BRAND_SOURCES = ['REFERENCE', 'USER_ADDED', 'CONFIRMED'] as const;
export type BrandSource = (typeof BRAND_SOURCES)[number];

export const CORRECTION_KINDS = ['UNMATCHED', 'BRAND_ADDED', 'SUPPLIER_OVERRIDE'] as const;
export type CorrectionKind = (typeof CORRECTION_KINDS)[number];

export const CORRECTION_STATUSES = ['PENDING', 'ACCEPTED', 'REJECTED'] as const;
export type CorrectionStatus = (typeof CORRECTION_STATUSES)[number];

export const CATALOGUE_REVIEW_STATES = [
  'NEEDS_BRAND',
  'PENDING_CONFIRMATION',
  'CONFIRMED',
] as const;
export type CatalogueReviewState = (typeof CATALOGUE_REVIEW_STATES)[number];

export function isCatalogueReviewState(value: unknown): value is CatalogueReviewState {
  return (
    typeof value === 'string' && CATALOGUE_REVIEW_STATES.includes(value as CatalogueReviewState)
  );
}

export interface SupplierReference {
  supplierId?: number | null;
}

export function resolveSupplier(
  product: SupplierReference,
  brand: SupplierReference | null | undefined,
): number | null {
  return product.supplierId ?? brand?.supplierId ?? null;
}

export interface CatalogueMatchEntry {
  id: number;
  barcode: string | null;
  apiSku: string | null;
  sigmaSku: string | null;
  ch2Sku: string | null;
}

export interface CatalogueMatchInput {
  barcode?: string | null;
  sku?: string | null;
}

function normalizeBarcode(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function normalizeCatalogueSku(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase();
  return normalized ? normalized : null;
}

export function matchByBarcode<T extends CatalogueMatchEntry>(
  entries: readonly T[],
  barcode: string | null | undefined,
): T | null {
  const normalized = normalizeBarcode(barcode);
  if (!normalized) return null;
  return entries.find((entry) => normalizeBarcode(entry.barcode) === normalized) ?? null;
}

export function matchByWholesalerSku<T extends CatalogueMatchEntry>(
  entries: readonly T[],
  sku: string | null | undefined,
): T | null {
  const normalized = normalizeCatalogueSku(sku);
  if (!normalized) return null;

  const matches = entries.filter((entry) =>
    [entry.apiSku, entry.sigmaSku, entry.ch2Sku].some(
      (candidate) => normalizeCatalogueSku(candidate) === normalized,
    ),
  );
  return matches.length === 1 ? matches[0] : null;
}

export function matchCatalogueEntry<T extends CatalogueMatchEntry>(
  entries: readonly T[],
  input: CatalogueMatchInput,
): T | null {
  return matchByBarcode(entries, input.barcode) ?? matchByWholesalerSku(entries, input.sku);
}
