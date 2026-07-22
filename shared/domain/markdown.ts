export const MARKDOWN_WINDOWS = {
  markdown1: { level: 1, minDays: 61, maxDays: 90 },
  markdown2: { level: 2, minDays: 31, maxDays: 60 },
  markdown3: { level: 3, minDays: 0, maxDays: 30 },
  totalMarkdown: { minDays: 0, maxDays: 90 },
  nextMonthMarkdown: { minDays: 91, maxDays: 120 },
  activeExpiryStock: { minDays: 0 },
} as const;

export type MarkdownLevel = 1 | 2 | 3;

export const MARKDOWN_DISCOUNT_PERCENTAGES = {
  markdown1: 50,
  markdown2: 60,
  markdown3: 75,
  none: 0,
} as const;

/**
 * Whether a band's discount is taken off the item's cost price or its retail price.
 */
export type MarkdownBasis = 'cost' | 'retail';

export interface MarkdownBandConfig {
  /** Discount percentage, 0-100. */
  percentage: number;
  basis: MarkdownBasis;
}

/**
 * An organization's markdown matrix: one config per band, keyed to the existing
 * day-to-expiry windows (band1 = 61-90 days, band2 = 31-60, band3 = 0-30).
 */
export interface MarkdownMatrixConfig {
  band1: MarkdownBandConfig;
  band2: MarkdownBandConfig;
  band3: MarkdownBandConfig;
}

export const CREDIT_SCOPES = ['NO_CREDIT', 'FULL_CREDIT'] as const;
export type CreditScope = (typeof CREDIT_SCOPES)[number];
export type MarkdownMatrixSet = Record<CreditScope, MarkdownMatrixConfig>;

/**
 * The pre-existing hardcoded ladder, expressed as a matrix: 50/60/75% off cost.
 * Organizations that have not customized their matrix use this, so behavior is
 * unchanged until they edit it.
 */
export const DEFAULT_MARKDOWN_MATRIX: MarkdownMatrixConfig = {
  band1: { percentage: MARKDOWN_DISCOUNT_PERCENTAGES.markdown1, basis: 'cost' },
  band2: { percentage: MARKDOWN_DISCOUNT_PERCENTAGES.markdown2, basis: 'cost' },
  band3: { percentage: MARKDOWN_DISCOUNT_PERCENTAGES.markdown3, basis: 'cost' },
} as const;

export const DEFAULT_FULL_CREDIT_MARKDOWN_MATRIX: MarkdownMatrixConfig = {
  band1: { percentage: 20, basis: 'cost' },
  band2: { percentage: 20, basis: 'cost' },
  band3: { percentage: 20, basis: 'cost' },
} as const;

export const DEFAULT_MARKDOWN_MATRIX_SET: MarkdownMatrixSet = {
  NO_CREDIT: DEFAULT_MARKDOWN_MATRIX,
  FULL_CREDIT: DEFAULT_FULL_CREDIT_MARKDOWN_MATRIX,
};

/**
 * An item whose markdown price can be resolved. Retail is optional — items
 * without a retail price fall back to cost even on a retail-basis band.
 */
export interface MarkdownableItem {
  costPrice: number;
  retailPrice?: number | null;
}

function bandConfigForLevel(
  level: MarkdownLevel,
  config: MarkdownMatrixConfig,
): MarkdownBandConfig {
  if (level === 1) {
    return config.band1;
  }
  if (level === 2) {
    return config.band2;
  }
  return config.band3;
}

export function getMarkdownLevelForDays(daysToExpiry: number | null): MarkdownLevel | null {
  // Expired stock (on or past its used-by date) is written off, not marked down.
  if (daysToExpiry === null || daysToExpiry <= 0) {
    return null;
  }
  if (daysToExpiry <= MARKDOWN_WINDOWS.markdown3.maxDays) {
    return MARKDOWN_WINDOWS.markdown3.level;
  }
  if (daysToExpiry <= MARKDOWN_WINDOWS.markdown2.maxDays) {
    return MARKDOWN_WINDOWS.markdown2.level;
  }
  if (daysToExpiry <= MARKDOWN_WINDOWS.markdown1.maxDays) {
    return MARKDOWN_WINDOWS.markdown1.level;
  }
  return null;
}

/**
 * Resolve the configured band (percentage + basis) that applies to an item this
 * many days from expiry, or null when the item is not on markdown (expired or
 * >90 days out). Lets UI show the configured percentage/basis without duplicating
 * the day-to-band mapping. Defaults to the pre-existing 50/60/75%-off-cost ladder.
 */
export function getMarkdownBandConfig(
  daysToExpiry: number | null,
  config: MarkdownMatrixConfig = DEFAULT_MARKDOWN_MATRIX,
): MarkdownBandConfig | null {
  const level = getMarkdownLevelForDays(daysToExpiry);
  return level === null ? null : bandConfigForLevel(level, config);
}

export function getMarkdownDiscountPercentageForDays(daysToExpiry: number | null): number {
  // Expired stock (on or past its used-by date) gets no discount — mirror getMarkdownLevelForDays.
  if (daysToExpiry === null || daysToExpiry <= 0) {
    return MARKDOWN_DISCOUNT_PERCENTAGES.none;
  }
  if (daysToExpiry <= MARKDOWN_WINDOWS.markdown3.maxDays) {
    return MARKDOWN_DISCOUNT_PERCENTAGES.markdown3;
  }
  if (daysToExpiry <= MARKDOWN_WINDOWS.markdown2.maxDays) {
    return MARKDOWN_DISCOUNT_PERCENTAGES.markdown2;
  }
  if (daysToExpiry <= MARKDOWN_WINDOWS.markdown1.maxDays) {
    return MARKDOWN_DISCOUNT_PERCENTAGES.markdown1;
  }

  return MARKDOWN_DISCOUNT_PERCENTAGES.none;
}

export function calculateMarkdownPriceFromCost(costPrice: number, daysToExpiry: number): number {
  const discountPercentage = getMarkdownDiscountPercentageForDays(daysToExpiry);

  return costPrice * (1 - discountPercentage / 100);
}

/**
 * Resolve the reduced price of a marked-down item using an organization's matrix.
 *
 * Band selection reuses the shared day-to-expiry windows. Each band's discount is
 * taken off cost or retail per its configured basis; a retail-basis band falls back
 * to the item's cost when the item has no finite retail price, so no item is left
 * unpriced. Returns null for stock that is not on markdown (expired or >90 days out),
 * mirroring getMarkdownLevelForDays.
 *
 * Callers that pass no config get DEFAULT_MARKDOWN_MATRIX, i.e. the pre-existing
 * 50/60/75%-off-cost behavior.
 */
export function calculateMarkdownPrice(
  item: MarkdownableItem,
  daysToExpiry: number | null,
  config: MarkdownMatrixConfig = DEFAULT_MARKDOWN_MATRIX,
): number | null {
  const level = getMarkdownLevelForDays(daysToExpiry);
  if (level === null) {
    return null;
  }

  const band = bandConfigForLevel(level, config);
  const useRetail =
    band.basis === 'retail' &&
    typeof item.retailPrice === 'number' &&
    Number.isFinite(item.retailPrice);
  const basisPrice = useRetail ? (item.retailPrice as number) : item.costPrice;

  return basisPrice * (1 - band.percentage / 100);
}

export function selectMatrix(set: MarkdownMatrixSet, scope: CreditScope): MarkdownMatrixConfig {
  return set[scope];
}

export interface ResolvedMarkdown {
  price: number | null;
  band: MarkdownBandConfig | null;
  scope: CreditScope;
}

export function resolveMarkdown(
  item: MarkdownableItem,
  daysToExpiry: number | null,
  set: MarkdownMatrixSet,
  scope: CreditScope,
): ResolvedMarkdown {
  const matrix = selectMatrix(set, scope);
  return {
    price: calculateMarkdownPrice(item, daysToExpiry, matrix),
    band: getMarkdownBandConfig(daysToExpiry, matrix),
    scope,
  };
}
