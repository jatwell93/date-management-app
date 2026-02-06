## Why

The backend test suite passes but emits noisy warnings and skips one integration area, which hides real regressions and slows investigation. We should quiet test-only noise and ensure the CSV parser integration uses the migrated test database so the suite is clean and consistent.

## What Changes

- Suppress Sentry instrumentation warnings during tests via test-only initialization behavior.
- Address MaxListeners warnings by tightening test server lifecycle or listener usage in integration tests.
- Update CSV parser integration tests to use the standard test database/migrations so they do not skip.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None.

## Impact

- Backend test harness, specifically test setup and integration tests.
- Sentry initialization path during tests.
- CSV parser integration tests and database usage.
