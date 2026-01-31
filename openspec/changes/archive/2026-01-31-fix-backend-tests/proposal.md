# Proposal: Fix Backend Test Suite

## Analysis
**Problem**: The backend test suite is slow (3-4 mins) and has 19 failing suites causing CI instability.
**Root Causes**:
1.  **Compilation Overhead**: `ts-jest` doing full type checking.
2.  **Type Errors**: `auth.middleware.ts` type mismatch with JWT.
3.  **Missing Mocks**: Unit tests hitting real database paths (Prisma integration) instead of mocks.
4.  **Database State**: Integration tests expecting tables that don't exist (migrations not running in test env).

## Reuse Strategy
-   Maintain existing Jest config structure but enable `isolatedModules` for speed.
-   Use existing mock patterns from successful tests (if any) to fix failing ones.

## Implementation Steps
1.  **Fix Types**: Resolve `auth.middleware.ts` TS errors.
2.  **Optimize Config**: Enable `isolatedModules: true` in `jest.config.js` to skip type checking during test runs (speed boost).
3.  **Fix Mocks**:
    -   Update `database.test.ts` to properly mock `getDb`.
    -   Verify `product.service.test.ts` mocks Prisma correctly.
4.  **Setup Test DB**: Add a `globalSetup` or scripts to ensure SQLite DB is migrated before integration tests run.
