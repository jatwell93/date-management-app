export const WORKERS_SOLD_THROUGH_STATUS = 'Sold Through' as const;
export const SQLITE_PROCESSED_STATUS = 'Processed' as const;
export const EXPIRED_STATUS = 'Expired' as const;

/**
 * Statuses that make an inventory item eligible for the expired-items worklist
 * regardless of expiry date. Markdown items appear in the worklist before their
 * expiry date, so the worklist query and the write-off matcher must share this
 * list to stay in agreement (see issue #268).
 */
export const EXPIRED_WORKLIST_STATUSES = [
  EXPIRED_STATUS,
  'Markdown 1',
  'Markdown 2',
  'Markdown 3',
] as const;

export type ExpiredWorklistStatus = (typeof EXPIRED_WORKLIST_STATUSES)[number];

export const DISPOSITIONED_STATUSES = [
  SQLITE_PROCESSED_STATUS,
  WORKERS_SOLD_THROUGH_STATUS,
] as const;

export type DispositionedStatus = (typeof DISPOSITIONED_STATUSES)[number];
