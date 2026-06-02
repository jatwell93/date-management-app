## Why

The user management page scored 13/20 in the impeccable audit. It is admin-gated and token-compliant, but it assumes the Clerk memberships request succeeds, presents loading text without live-region semantics, relies on a horizontally scrolling table on narrow screens, and has no regression coverage for error recovery or long member data.

Audit evidence:

- `frontend/src/pages/UserManagementPage.tsx` starts the membership request without an unmount guard, so late responses can update state after navigation.
- `frontend/src/pages/UserManagementPage.tsx` converts fetch failures into the same empty state as a valid empty organization.
- `frontend/src/pages/UserManagementPage.tsx` exposes dynamic loading text without announced status semantics.
- `frontend/src/pages/UserManagementPage.tsx` relies on table overflow for all narrow viewport behavior.
- `frontend/src/tests/UserManagementPage.test.tsx` uses `any` in component mocks, leaving lint warnings in the focused test file.

## What Changes

- Add focused RED tests for announced loading states, recoverable membership errors, mobile member summaries, long member names/emails, and typed test component mocks.
- Harden the membership fetch with an active request guard and retry path.
- Add `role="status"` for loading and empty states, plus `role="alert"` for membership load errors.
- Preserve the desktop table while adding a compact mobile member list that wraps long pharmacy-team names and email addresses.
- Clarify copy around Settings-based invitations without adding modal or new management flows.
- Remove test `any` usage in the touched test file.

## Reuse Strategy

- Extend `frontend/src/pages/UserManagementPage.tsx` rather than creating a new user management surface.
- Follow the existing Store Area hardening pattern for abort-safe loading and live regions from `frontend/src/pages/StoreAreaManagementPage.tsx`.
- Keep shared primitives from `frontend/src/components/ui/card.tsx` and existing semantic Tailwind tokens.
- Keep Clerk membership loading through `useOrganization`; no mock data in production and no backend changes.

## Impact

- **Frontend page:** `frontend/src/pages/UserManagementPage.tsx`
- **Tests:** `frontend/src/tests/UserManagementPage.test.tsx`
- **Verification:** focused Jest test, targeted ESLint, token compliance for the page, OpenSpec validation. Browser checks are intentionally skipped per user instruction.
