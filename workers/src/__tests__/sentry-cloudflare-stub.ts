/**
 * Minimal stand-in for `@sentry/cloudflare` used only by the Node-environment
 * (pglite) test project. index-minimal.ts calls `Sentry.withSentry(...)` at module
 * load and `Sentry.captureException(...)` on errors; the real package targets
 * workerd, so we alias it here to keep the module importable under Node vitest.
 */
export function withSentry<T>(_options: unknown, handler: T): T {
  return handler;
}

export function captureException(_error: unknown, _context?: unknown): void {
  // no-op in tests
}

export default { withSentry, captureException };
