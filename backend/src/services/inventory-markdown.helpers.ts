import { InventoryItem } from '../models/inventory-item.model';

export type InventoryMarkdownStatus = InventoryItem['status'];
export type InventoryMarkdownExpiryDate = string | Date | null | undefined;

export const INVENTORY_MARKDOWN_THRESHOLDS = {
  markdown3: 7,
  markdown2: 14,
  markdown1: 30,
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
