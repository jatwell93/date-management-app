// Postgres error classification shared by the Worker's data-access modules.
//
// This exists because there were two copies: a hardened one in index-minimal.ts and a
// weaker one in credit-claim-database.ts that missed the nested shape, so the same
// unique violation produced a 409 on one path and a 500 on another. That is the drift
// this package keeps paying for — see shared/domain/credit-claim-email.ts for the same
// consolidation on the email body.

/** SQLSTATE 23505 — unique_violation. */
const UNIQUE_VIOLATION = '23505';

function hasCode(value: unknown, code: string): boolean {
  return !!value && typeof value === 'object' && (value as { code?: unknown }).code === code;
}

/**
 * Thrown by `createInventoryItem` when an active item already holds the same
 * product, expiry date and location. It is the fast path in front of the
 * `inventory_items_active_triple_unique` index (migration 0019); a concurrent
 * race that slips past it surfaces as a plain unique violation instead, and
 * `isDuplicateInventoryItem` treats both the same way.
 */
export const DUPLICATE_INVENTORY_ITEM_MESSAGE =
  'An inventory item with the same product, expiry date, and location already exists';

export class DuplicateInventoryItemError extends Error {
  constructor() {
    super(DUPLICATE_INVENTORY_ITEM_MESSAGE);
    this.name = 'DuplicateInventoryItemError';
  }
}

/**
 * Thrown by `createStoreArea` when the organization already has an area with the same name
 * and sub-department. The unique index on (organization_id, name, sub_department) cannot
 * stop this when the sub-department is NULL, because Postgres treats NULLs as distinct, so
 * the two areas "Aisle 1" with no sub-department were both accepted. Express refused them in
 * `store-area.service.ts` with a NULL-safe lookup; this is the same check.
 */
export const DUPLICATE_STORE_AREA_MESSAGE = 'Store area with this name already exists';

export class DuplicateStoreAreaError extends Error {
  constructor() {
    super(DUPLICATE_STORE_AREA_MESSAGE);
    this.name = 'DuplicateStoreAreaError';
  }
}

export function isDuplicateInventoryItem(error: unknown): boolean {
  return error instanceof DuplicateInventoryItemError || isUniqueViolation(error);
}

/**
 * Detect a Postgres unique-violation. Prefer the SQLSTATE code over substring matching
 * the message, which is locale- and version-dependent.
 *
 * The `cause` check is not defensive padding: some Neon driver wrappers nest the pg
 * error under `.cause`, and a caller that misses that shape rethrows instead of
 * answering the conflict — turning the one case the constraint exists to catch into an
 * opaque 500.
 */
export function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  if (hasCode(error, UNIQUE_VIOLATION)) return true;
  return hasCode((error as { cause?: unknown }).cause, UNIQUE_VIOLATION);
}
