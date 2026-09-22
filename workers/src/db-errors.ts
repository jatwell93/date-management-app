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
