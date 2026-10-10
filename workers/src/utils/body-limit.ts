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
 * **This checks the declared `Content-Length` only.** A chunked request sends
 * none, so `curl -H 'Transfer-Encoding: chunked'` walks straight past it. That
 * case is closed by `capUndeclaredBody` below, which every call site runs
 * after this check (#532). Cloudflare's own body ceiling does not help: it is
 * 100 MB on Free and Pro against a 128 MB isolate, and `request.json()` holds
 * the raw string and the parsed structure at once (roughly 2-3x the body).
 *
 * The two are separate functions because a stream error would surface inside
 * whichever handler reads the body, as a 500 from the outer catch. Reading the
 * undeclared body up front instead lets the cap answer with the same clean 413.
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
 *     there; it needs the tier resolved first, so it is still open.
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

/**
 * Cap a body that declares no usable `Content-Length` (chunked transfer) (#532).
 *
 * Reads at most `MAX_JSON_BODY_BYTES` into memory, which is the same amount the
 * handler would have buffered for a legitimate request, then returns a rebuilt
 * `Request` carrying those bytes. Over the cap it cancels the stream and
 * returns the 413 `Response`, so the over-limit case needs no handler to know
 * about it. A request that declares a numeric `Content-Length` is returned
 * unchanged: `enforceJsonBodyLimit` already judged it, and the runtime enforces
 * the declared length.
 *
 * Callers must use the returned `Request` for every later body read, because
 * the original stream is consumed.
 */
export async function capUndeclaredBody(
  request: Request,
  env: Env,
  requestOrigin?: string,
): Promise<Request | Response> {
  if (BODYLESS_METHODS.has(request.method) || !request.body) {
    return request;
  }

  const declared = request.headers.get('Content-Length');
  if (declared && Number.isFinite(Number(declared))) {
    return request;
  }

  const max = resolveMaxJsonBodyBytes(env);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let seen = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    seen += value.byteLength;
    if (seen > max) {
      await reader.cancel().catch(() => undefined);
      return errorResponse(
        `Request body exceeds the maximum size of ${max} bytes`,
        413,
        env,
        requestOrigin,
      );
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(seen);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Request(request, { body: bytes });
}
