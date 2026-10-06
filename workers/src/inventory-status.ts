import { getMarkdownLevelForDays } from '../../shared/domain/markdown';

export type InventoryStatus = 'Normal' | 'Markdown 1' | 'Markdown 2' | 'Markdown 3' | 'Expired';

/**
 * Statuses the daily `markdown-recalculation` job (and an expiry edit) may rewrite.
 * Every other status is a disposition (`Processed`, `Sold Through`, ...) and is never
 * resurrected by a date change.
 */
export const RECALCULABLE_INVENTORY_STATUSES: readonly InventoryStatus[] = [
  'Normal',
  'Markdown 1',
  'Markdown 2',
  'Markdown 3',
  'Expired',
];

/**
 * Inventory status derived from days-to-expiry, on the shared 30/60/90-day
 * markdown windows. This is the same rule the daily `markdown-recalculation`
 * job applies, so an item is not relabelled the first time that job runs.
 *
 * Used by every path that writes an item without an explicit status: the expiry
 * list import, `POST /api/inventory-items` and an expiry edit. Express derived
 * the status on create and on an expiry edit (`inventory.service.ts:164`, `:224`);
 * the Worker defaulted to `Normal` until the nightly job, so an item scanned in
 * store on the day it expired was not an expired item until midnight UTC.
 */
export function calculateInventoryStatus(isoDate: string, now: Date = new Date()): InventoryStatus {
  const expiry = new Date(`${isoDate}T00:00:00.000Z`).getTime();
  const daysDiff = Math.ceil((expiry - now.getTime()) / (1000 * 60 * 60 * 24));

  if (daysDiff <= 0) return 'Expired';
  const level = getMarkdownLevelForDays(daysDiff);
  return level === null ? 'Normal' : (`Markdown ${level}` as const);
}
