import type { Env } from '../types/env';

/**
 * Security response headers for the Worker API.
 *
 * Replaces the `helmet()` call at `backend/src/index.ts:73-90`, which the live
 * Worker has no equivalent of at all (2.5 §F). **It is deliberately not a port
 * of that config**, because Express's helmet was protecting something the
 * Worker does not serve.
 *
 * **Why the CSP here is three words instead of Express's six directives.**
 * Express served the frontend itself -- `express.static(frontendBuildDir)` at
 * `index.ts:372` and an SPA `sendFile` fallback at `:388` -- so its
 * `script-src` / `style-src` / `font-src` / `img-src` directives governed real
 * HTML documents it returned. This Worker serves JSON and nothing else: there
 * is no document for those directives to apply to, so copying them across
 * would be ceremony that reads as protection. What a JSON API actually needs is
 * the opposite of a page policy -- a blanket refusal, so that if any response
 * is ever coerced into being interpreted as a document it can load nothing and
 * cannot be framed.
 *
 * **The frontend's CSP did not move here. It moved to `frontend/public/_headers`**,
 * because the frontend is now served by Cloudflare Pages, a different origin
 * with its own header configuration. That file did not exist before this task,
 * which means the page CSP Express provided has been absent from production
 * since the frontend moved to Pages. Splitting the control in two is the honest
 * shape: page directives belong where the pages are.
 *
 * `X-Frame-Options` is deliberately omitted -- `frame-ancestors` supersedes it
 * in every browser that supports CSP, and helmet only still sends it for
 * pre-CSP clients that cannot reach this API anyway.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  // Stop a browser from re-interpreting a JSON error body as HTML or a script.
  'X-Content-Type-Options': 'nosniff',
  // An API that should load nothing and be framed by nobody.
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  // Do not leak an authenticated API URL, which can carry ids in its path, into
  // a third-party site's Referer log.
  'Referrer-Policy': 'no-referrer',
  // Express did not set this; helmet leaves it to the app. An API that needs no
  // camera, microphone or geolocation should say so once rather than rely on
  // never accidentally embedding something that does.
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
});

/**
 * HSTS, matching Express's helmet settings exactly (`maxAge` one year,
 * `includeSubDomains`, `preload`).
 *
 * Held separately because it is applied conditionally. Sending HSTS over plain
 * HTTP is meaningless -- the RFC requires clients to ignore it, since an
 * attacker who can strip the TLS can strip the header -- and sending it from a
 * local `wrangler dev` origin would pin `localhost` to HTTPS in the developer's
 * browser for a year, which is a genuinely unpleasant thing to do to a
 * teammate and is not undone by reverting this code.
 */
export const HSTS_HEADER = 'max-age=31536000; includeSubDomains; preload';

/**
 * Whether HSTS should be sent for this request.
 *
 * Keyed on the request's own scheme rather than on `NODE_ENV`, so a production
 * build reached over plain HTTP does not advertise it and a staging deployment
 * on real HTTPS does. `wrangler dev` serves `http://localhost`, which this
 * excludes.
 */
export function shouldSendHsts(request: Request): boolean {
  try {
    return new URL(request.url).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Attach the security headers to a response.
 *
 * Existing headers are never overwritten. That matters for one real case: a
 * handler that deliberately sets its own `Content-Security-Policy` or serves a
 * non-JSON body should win over a blanket default, and silently clobbering it
 * here would be a bug that only shows up in a browser.
 *
 * The response is mutated in place where possible. `Response.headers` is
 * immutable for some constructed responses (notably a redirect or one built
 * from another response's body), so the fallback rebuilds. Rebuilding
 * unconditionally would break the streaming gzip response
 * `maybeCompressJsonResponse` produces, which carries `encodeBody: 'manual'`
 * that a naive `new Response(res.body, res)` does not preserve.
 */
export function applySecurityHeaders(response: Response, request: Request, _env?: Env): Response {
  const headers: Record<string, string> = { ...SECURITY_HEADERS };
  if (shouldSendHsts(request)) {
    headers['Strict-Transport-Security'] = HSTS_HEADER;
  }

  try {
    setMissing(response.headers, headers);
    return response;
  } catch {
    const merged = new Headers(response.headers);
    setMissing(merged, headers);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: merged,
    });
  }
}

/**
 * Copy `values` into `target`, skipping any key already present.
 *
 * Extracted because both branches above need exactly this and had it written
 * out twice. The duplication was the kind that rots quietly: a later change to
 * the merge rule -- skipping empty values, say, or logging an overwrite attempt
 * -- would be applied to the in-place branch and missed on the rebuild branch,
 * which only runs for responses with immutable headers and so is the branch
 * least likely to be exercised by hand.
 */
function setMissing(target: Headers, values: Record<string, string>): void {
  for (const [key, value] of Object.entries(values)) {
    if (!target.has(key)) {
      target.set(key, value);
    }
  }
}
