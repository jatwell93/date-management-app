## 1. Sentry Test Noise

- [x] 1.1 Add test-only guard to Sentry initialization so it is skipped when `NODE_ENV=test`
- [x] 1.2 Skip `Sentry.setupExpressErrorHandler` in tests and confirm no instrumentation warnings

## 2. MaxListeners Cleanup

- [x] 2.1 Identify the listener source in tests and remove extra listeners (prefer test-only fix)
- [x] 2.2 Add a fallback test-only listener cap adjustment if warnings persist

## 3. CSV Parser Integration

- [x] 3.1 Update CSV parser integration tests to use the migrated standard test database
- [x] 3.2 Ensure CSV parser integration cleanup runs safely between tests

## 4. Verification

- [x] 4.1 Run backend test suite and confirm warnings are gone and CSV parser integration tests are not skipped
