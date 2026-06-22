export const WORKERS_SOLD_THROUGH_STATUS = 'Sold Through' as const;
export const SQLITE_PROCESSED_STATUS = 'Processed' as const;
export const EXPIRED_STATUS = 'Expired' as const;

export const DISPOSITIONED_STATUSES = [
  SQLITE_PROCESSED_STATUS,
  WORKERS_SOLD_THROUGH_STATUS,
] as const;

export type DispositionedStatus = (typeof DISPOSITIONED_STATUSES)[number];
