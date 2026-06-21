import { InventoryItem } from '../models/inventory-item.model';

export type InventoryMarkdownStatus = InventoryItem['status'];
export type InventoryMarkdownExpiryDate = string | Date | null | undefined;

// Days-to-expiry thresholds, aligned with the expiry report windows and the
// frontend markdown logic (Markdown 1 = 61-90 days, Markdown 2 = 31-60,
// Markdown 3 = 0-30). Previously 7/14/30, which diverged from the reporting
// windows and the in-store process (first markdown ~3 months out).
export const INVENTORY_MARKDOWN_THRESHOLDS = {
  markdown3: 30,
  markdown2: 60,
  markdown1: 90,
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

export function calculateInventoryMarkdownPrice(
  costPrice: number,
  expiryDate: InventoryMarkdownExpiryDate,
  now = new Date(),
): number | null {
  const daysDiff = daysUntil(expiryDate, now);

  if (daysDiff === null) {
    return null;
  }
  if (daysDiff <= INVENTORY_MARKDOWN_THRESHOLDS.markdown3) {
    return costPrice * 0.8;
  }
  if (daysDiff <= INVENTORY_MARKDOWN_THRESHOLDS.markdown2) {
    return costPrice;
  }
  if (daysDiff <= INVENTORY_MARKDOWN_THRESHOLDS.markdown1) {
    return costPrice * 1.2;
  }

  return null;
}
