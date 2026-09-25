import type { Env } from '../types/env';
import { errorResponse } from './worker-response';

/**
 * Maximum accepted JSON request body, in bytes.
 *
 * Express capped this at 10 MB (`express.json({ limit: '10mb' })`,
 * `backend/src/index.ts:108`); the Worker capped nothing, so a JSON body of any
 * size reached `await request.json()` (2.5 §F). **The number is deliberately
 * not Express's**, because 10 MB bears no relationship to what this API
 * accepts: the largest payload it takes by design is 500 integer ids
 * (`isValidBulkIdBatch`, `index-minimal.ts`), a few kilobytes. 1 MiB is roughly
 * a hundred times any legitimate request and still small enough to be worth
 * enforcing.
 *
 * **Why an uncapped body matters more in a Worker than it did in Express.**
 * `request.json()` buffers the entire body before parsing, and a Worker isolate
 * has a 128 MB memory ceiling *shared with the other requests it is concurrently
 * serving*. In Express an oversized body cost that one request's process memory
 * on a box sized for it; here it can evict or fail work belonging to other
 * organizations. The cap is a tenant-fairness control as much as an abuse one.
 *
 * Overridable via `MAX_JSON_BODY_BYTES` so a bulk endpoint added later does not
 * need a redeploy of this constant to be unblocked.
 */
export const DEFAULT_MAX_JSON_BODY_BYTES = 1024 * 1024;

/**
 * Methods that carry no body worth capping.
 *
 * A named set rather than a chain of `||` comparisons: the predicate is now
 * stated once, in the place where the reason for it can be written down, and
 * adding a method is a list edit rather than another clause.
 */
const BODYLESS_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function resolveMaxJsonBodyBytes(env: Env): number {
  const raw = (env as { MAX_JSON_BODY_BYTES?: string }).MAX_JSON_BODY_BYTES;
  if (!raw) {
    return DEFAULT_MAX_JSON_BODY_BYTES;
  }
  const parsed = Number(raw);
  // A malformed override falls back rather than throwing or yielding NaN: a
  // typo in a deployment variable should not uncap the limit, which is what
  // `parsed > cap` would silently do with NaN.
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_MAX_JSON_BODY_BYTES;
}

/**
 * Refuse a request whose declared body exceeds the cap.
 *
 * Returns a 413 `Response` to return immediately, or `null` to proceed.
 *
 * **This checks `Content-Length` only, and that is a deliberate limitation
 * worth stating rather than hiding.** A chunked request sends no
 * `Content-Length`, so a client that wants past this can omit it. Two reasons
 * that is still the right trade here: Cloudflare terminates the connection and
 * enforces its own hard body ceiling well below the isolate's memory limit, so
 * the unbounded case is already bounded by the platform; and the alternative --
 * reading the body through a counting stream -- means this Worker buffers and
 * inspects every request body itself, which is the cost the cap exists to
 * avoid. The header check stops the ordinary large-payload case, including
 * every accidental one, at zero cost.
 *
 * Applied to JSON API routes only. Uploads keep their own tier-aware cap
 * (`STANDARD_MAX_FILE_SIZE` / `getTierFileSizeLimit`), which is both larger and
 * correct for their purpose, and the signed webhook paths are excluded because
 * refusing a Stripe or Clerk delivery unread turns a provider retry loop into a
 * silent data gap.
 */
export function enforceJsonBodyLimit(
  request: Request,
  env: Env,
  requestOrigin?: string,
): Response | null {
  // A body-less method has nothing to cap, and some clients send
  // `Content-Length: 0` on GET.
  if (BODYLESS_METHODS.has(request.method)) {
    return null;
  }

  const declared = request.headers.get('Content-Length');
  if (!declared) {
    return null;
  }

  const size = Number(declared);
  if (!Number.isFinite(size)) {
    return null;
  }

  const max = resolveMaxJsonBodyBytes(env);
  if (size <= max) {
    return null;
  }

  return errorResponse(
    `Request body exceeds the maximum size of ${max} bytes`,
    413,
    env,
    requestOrigin,
  );
}
