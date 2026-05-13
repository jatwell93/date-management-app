## Why

Expect browser QA is useful for catching layout and workflow regressions, but the local setup currently depends on ad hoc backend startup, manual Clerk state, and unknown Stripe price configuration. That makes authenticated QA inconsistent and can hide role/bootstrap issues such as admin versus team member navigation.

This change creates a real-Clerk-first local QA workflow. Clerk remains the source of truth for auth and roles; a dev-only diagnostic panel exposes auth/bootstrap state to Expect so browser checks can verify what role and organization the frontend actually resolved.

## Analysis

**Current frontend auth:** `frontend/src/components/ClerkAuthProvider.tsx` already exposes `isLoggedIn`, `isFullySignedIn`, `hasOrganization`, `userId`, `userName`, `userRole`, and the current token. Extending that context is unnecessary.

**Current bootstrap state:** `frontend/src/hooks/useOrgBootstrap.ts` already returns `isBootstrapped`, `isBootstrapping`, `bootstrapError`, and `bootstrapResult`, including backend-resolved role and organization ID. This should be surfaced in development instead of bypassing Clerk.

**Current API config:** `frontend/src/lib/api.service.ts` resolves `REACT_APP_API_URL`/`REACT_APP_API_BASE_URL`, defaulting to `http://localhost:3001`. The QA docs and diagnostics should display the resolved base URL so backend wiring is visible in browser checks.

**Current backend auth fallback:** backend integration tests use `TEST_AUTH_BYPASS` with `default-org`. That remains useful for non-auth backend tests, but it must not be treated as the primary browser QA path for Clerk or role validation.

## Reuse Strategy

- Extend `frontend/src/App.tsx` with a dev-only QA diagnostics panel using existing auth/bootstrap values.
- Reuse existing frontend tests in `frontend/src/App.test.tsx` to prove the panel appears only when explicitly enabled and reports admin/team-member state.
- Add documentation instead of a bespoke auth harness for Clerk.
- Use Stripe CLI and existing Stripe Checkout/Billing Portal code paths; do not introduce mock production billing data.

## What Changes

- Add `REACT_APP_EXPECT_QA_STATUS=true` as an explicit frontend opt-in for a development/test-only QA diagnostics panel.
- Show frontend auth role, backend bootstrap role, organization ID, bootstrap status, token presence, and resolved API base URL in a stable DOM surface for Expect.
- Document how to run backend and frontend locally, how to sign in as real Clerk admin/member users, and how to create or locate Stripe test price IDs with the Stripe CLI.

## Impact

- **Frontend app shell:** `frontend/src/App.tsx`
- **Frontend tests:** `frontend/src/App.test.tsx`
- **Local QA docs:** `docs/local-expect-qa.md`
- **Implementation plan:** `docs/plans/2026-05-13-local-expect-qa.md`

## Success Criteria

- Clerk is not bypassed for primary browser QA.
- When `REACT_APP_EXPECT_QA_STATUS=true` and the app is not running in production, Expect can read role/bootstrap/API status from the page.
- The QA panel is absent unless explicitly enabled.
- Documentation gives the user exact steps to run frontend/backend, sign into Clerk test users, and retrieve/create Stripe test price IDs.
- Targeted frontend tests and `openspec validate local-expect-qa --strict` pass.
