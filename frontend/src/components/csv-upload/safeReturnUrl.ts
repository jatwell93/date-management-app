// Backslashes (browsers normalise `/\evil.com` to `//evil.com`), whitespace and control
// characters (stripped by the URL parser, so `/\t/evil.com` becomes `//evil.com`).
const UNSAFE_CHARACTERS = /[\\\s\u0000-\u001f\u007f]/;
// An encoded backslash is a same-origin path to the URL parser, but some servers and
// proxies decode it before routing. No in-app route needs one, so reject it outright.
const ENCODED_BACKSLASH = /%5c/i;

const isSingleSlashPath = (path: string): boolean => /^\/(?!\/)/.test(path);

const hasSafeSyntax = (candidate: string): boolean =>
  !UNSAFE_CHARACTERS.test(candidate) &&
  !ENCODED_BACKSLASH.test(candidate) &&
  isSingleSlashPath(candidate);

const parseSameOrigin = (candidate: string): URL | null => {
  try {
    const url = new URL(candidate, window.location.origin);
    return url.origin === window.location.origin ? url : null;
  } catch {
    return null;
  }
};

/**
 * Returns `candidate` as a same-origin in-app path (pathname + search + hash) when it is
 * safe to hand to the router, otherwise null. Guards the `?return=` open-redirect vector:
 * React Router falls back to `window.location.assign` when pushState rejects a
 * cross-origin URL, so anything that resolves off-origin must never reach `navigate`.
 */
export function toSafeReturnPath(candidate: string | null | undefined): string | null {
  if (typeof candidate !== 'string' || !hasSafeSyntax(candidate)) return null;
  const url = parseSameOrigin(candidate);
  if (!url || !isSingleSlashPath(url.pathname)) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}
