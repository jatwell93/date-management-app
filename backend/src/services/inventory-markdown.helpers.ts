import { InventoryItem } from '../models/inventory-item.model';
import {
  calculateMarkdownPrice,
  MARKDOWN_WINDOWS,
  type MarkdownMatrixConfig,
} from '../../../shared/domain/markdown';

export type InventoryMarkdownStatus = InventoryItem['status'];
export type InventoryMarkdownExpiryDate = string | Date | null | undefined;

// Days-to-expiry thresholds, aligned with the expiry report windows and the
// frontend markdown logic (Markdown 1 = 61-90 days, Markdown 2 = 31-60,
// Markdown 3 = 0-30). Previously 7/14/30, which diverged from the reporting
// windows and the in-store process (first markdown ~3 months out).
export const INVENTORY_MARKDOWN_THRESHOLDS = {
  markdown3: MARKDOWN_WINDOWS.markdown3.maxDays,
  markdown2: MARKDOWN_WINDOWS.markdown2.maxDays,
  markdown1: MARKDOWN_WINDOWS.markdown1.maxDays,
} as const;

function daysUntil(expiryDate: InventoryMarkdownExpiryDate, now = new Date()): number | null {
  if (!expiryDate) {
    return null;
  }

  const expiry = new Date(expiryDate);
  if (Number.isNaN(expiry.getTime())) {
    return null;
  }

  return Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

export function calculateInventoryMarkdownStatus(
  expiryDate: InventoryMarkdownExpiryDate,
  now = new Date(),
): InventoryMarkdownStatus {
  const daysDiff = daysUntil(expiryDate, now);

  if (daysDiff === null) {
    return 'Normal';
  }
  if (daysDiff <= 0) {
    return 'Expired';
  }
  if (daysDiff <= INVENTORY_MARKDOWN_THRESHOLDS.markdown3) {
    return 'Markdown 3';
  }
  if (daysDiff <= INVENTORY_MARKDOWN_THRESHOLDS.markdown2) {
    return 'Markdown 2';
  }
  if (daysDiff <= INVENTORY_MARKDOWN_THRESHOLDS.markdown1) {
    return 'Markdown 1';
  }

  return 'Normal';
}

export interface InventoryMarkdownPriceOptions {
  /** Retail price for retail-basis bands; falls back to cost when absent. */
  retailPrice?: number | null;
  /** The organization's matrix; defaults to the shared 50/60/75%-off-cost ladder. */
  matrix?: MarkdownMatrixConfig;
}

export function calculateInventoryMarkdownPrice(
  costPrice: number,
  expiryDate: InventoryMarkdownExpiryDate,
  now = new Date(),
  options: InventoryMarkdownPriceOptions = {},
): number | null {
  const daysDiff = daysUntil(expiryDate, now);

  // Delegates to the shared resolver so backend prices stay in parity with the
  // frontend and honor the org's configured matrix and basis (issue #338). The
  // resolver returns null for expired (<=0 days) and >90-day stock, matching
  // calculateInventoryMarkdownStatus.
  return calculateMarkdownPrice(
    { costPrice, retailPrice: options.retailPrice ?? null },
    daysDiff,
    options.matrix,
  );
}
