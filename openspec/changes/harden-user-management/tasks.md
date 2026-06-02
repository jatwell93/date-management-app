## 1. Baseline and Tests

- [x] 1.1 RED: Add tests for organization-loading and membership-loading live region semantics.
- [x] 1.2 RED: Add a recoverable membership failure test with alert copy and retry behavior.
- [x] 1.3 RED: Add responsive mobile member summary coverage with long name/email wrapping.
- [x] 1.4 RED: Replace `any` component mocks in the focused test file with typed React props.

## 2. User Management Hardening

- [x] 2.1 GREEN: Add abort-safe membership request guards so stale Clerk responses cannot update unmounted state.
- [x] 2.2 GREEN: Add announced loading, empty, and alert states.
- [x] 2.3 GREEN: Add retry support for failed membership loading.
- [x] 2.4 GREEN: Add mobile-first member summary rows while preserving the desktop table.
- [x] 2.5 GREEN: Harden member name, email, role, and status text against long values and missing fields.

## 3. Verification

- [x] 3.1 Run focused user management tests and confirm RED-to-GREEN results.
- [x] 3.2 Run targeted ESLint on the page and test file.
- [x] 3.3 Run token compliance for `UserManagementPage`.
- [x] 3.4 Run OpenSpec validation for `harden-user-management`.
- [x] 3.5 Record that browser checks were skipped at user request.
