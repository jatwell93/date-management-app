## Context

The backend test suite currently passes but emits noisy warnings and skips the CSV parser integration tests because the dedicated test database is not migrated. Sentry is initialized at module load, which leads to express instrumentation warnings in tests. MaxListeners warnings appear on ServerResponse during integration tests using supertest.

## Goals / Non-Goals

**Goals:**

- Silence Sentry-related instrumentation warnings during tests without changing production behavior.
- Eliminate MaxListeners warnings by removing the underlying source of duplicate listeners.
- Run CSV parser integration tests against the standard migrated test database so they no longer skip.

**Non-Goals:**

- Changing production Sentry configuration, alerting, or routing.
- Modifying CSV parser business logic or performance characteristics.
- Altering API responses or contracts.

## Decisions

- **Guard Sentry initialization in tests.** Add a test-only check in instrumentation so Sentry is not initialized when `NODE_ENV=test`. This prevents express instrumentation warnings and avoids extra listeners. Alternative: keep Sentry enabled in tests and tolerate warnings; rejected because it obscures real failures.
- **Keep Sentry error handler out of tests.** Skip `Sentry.setupExpressErrorHandler` when `NODE_ENV=test` to avoid instrumentation warnings on express. Alternative: reorder imports to ensure express is instrumented; rejected because tests import the app module directly and reorder would be invasive.
- **Use the standard test database for CSV parser integration.** Update the CSV parser integration test to use the default test database (`file:./test.db`) that is already migrated in `test-setup.js`. Alternative: run extra migrations per test file against a separate DB; rejected as slower and duplicative.
- **Address MaxListeners at the source.** Expect the warnings to drop once Sentry is disabled in tests; if not, add a targeted test-only listener cap adjustment in test setup as a fallback.

## Risks / Trade-offs

- **Reduced Sentry coverage in tests** → Keep Sentry enabled in non-test environments; tests should focus on application behavior, not Sentry wiring.
- **Shared test database contention** → Ensure CSV parser integration tests clear their tables in `beforeEach` and rely on the existing global cleanup.

## Migration Plan

- Update instrumentation and app initialization to bypass Sentry in tests.
- Adjust CSV parser integration test to use the standard test database and cleanup.
- Run `npm test` to confirm warnings are resolved and tests no longer skip.
