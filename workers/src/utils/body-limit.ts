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
  const raw = env.MAX_JSON_BODY_BYTES;
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
 * **This checks `Content-Length` only, which leaves a real and reachable gap.**
 * A chunked request sends no `Content-Length`, so `curl -H 'Transfer-Encoding:
 * chunked'` walks straight past this check.
 *
 * An earlier version of this comment justified that by claiming Cloudflare's
 * own body ceiling sits "well below the isolate's memory limit". **That is
 * false**, and the correction matters because it was the only rationale given
 * for the gap: the request-body ceiling is 100 MB on Free and Pro (200 MB
 * Business, 500 MB Enterprise) against a 128 MB isolate, and `request.json()`
 * holds the raw string and the parsed structure at the same time -- roughly
 * 2-3x the body. A chunked body comfortably inside Cloudflare's ceiling can
 * still exhaust the isolate (error 1102) and take out the other requests
 * sharing it, which is precisely the tenant-fairness failure this cap exists to
 * prevent. The same comment also mischaracterized the alternative: a
 * pass-through counting `TransformStream` streams with backpressure and does
 * not buffer the body, so "the cost the cap exists to avoid" does not apply to
 * it.
 *
 * The gap is left open **in this change only**, deliberately and on narrower
 * grounds: closing it means piping `request.body` through a counter and
 * rebuilding the `Request`, and an over-limit stream then surfaces as a stream
 * error inside whichever handler is reading it -- a 500 from the outer catch
 * rather than this clean 413 -- which changes the failure mode of every POST on
 * the Worker. That is its own change with its own tests, tracked as **#532**.
 * The header check still removes every accidental large payload and every
 * non-adversarial client at zero cost, which is strictly better than the
 * nothing that was here before.
 *
 * **Where this is actually applied**, stated precisely because an earlier
 * version of the call-site comment claimed a blanket "before any handler
 * buffers it" that was not true:
 *
 *   * JSON API routes, from the entry point, after the upload router declines.
 *   * `POST /api/organization/bootstrap`, from inside
 *     `clerk/bootstrap-handler.ts` -- dispatched above the entry-point check
 *     (it must precede the legacy `JWT_SECRET` check) and buffers with
 *     `request.text()`, so it enforces the cap itself.
 *   * `POST {/upload,/api/upload}/initiate` and `.../complete`, from
 *     `upload/upload-router.ts` -- also dispatched above the entry-point check,
 *     and they buffer `request.json()`. Note `handleUploadInitiate`'s
 *     `fileSize` comparison validates a *declared field*, not the request body,
 *     so it was never a body-size control.
 *
 * **Deliberately not applied**, with the reason for each:
 *   * `POST .../direct/:key` and `PUT .../presigned/:key` carry the uploaded
 *     file itself and are governed by the tier-aware
 *     `STANDARD_MAX_FILE_SIZE` / `getTierFileSizeLimit` -- larger, and correct
 *     for their purpose. `handleUploadDirect` does buffer `request.formData()`
 *     before its size check, so a pre-read cap would still be an improvement
 *     there; it needs the tier resolved first, so it rides with **#532**.
 *   * The signed webhook paths, because refusing a Stripe or Clerk delivery
 *     unread turns a provider retry loop into a silent data gap.
 *
 * **Any new handler that buffers a body must either sit behind the entry-point
 * check or call this itself.** The guarantee is per-route, not global. Two
 * earlier revisions of this comment asserted a broader guarantee than the code
 * delivered -- first "before any handler buffers it", then an exclusion list
 * that implied uploads were covered when only their file bytes were. Both were
 * caught in review. Keep this list literal.
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
