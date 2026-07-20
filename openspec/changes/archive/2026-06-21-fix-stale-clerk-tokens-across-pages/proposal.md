# Proposal: Fix Stale Clerk Tokens Across Authenticated Frontend Pages

## Analysis

**Current**: `frontend/src/components/ClerkAuthProvider.tsx`

- The provider loads a Clerk session token once and passes it through authenticated route props.
- Several pages and components pass that prop token directly to `apiService`, so a valid Clerk session can still send an expired bearer token after the JWT ages out.

**Affected**: `frontend/src/pages/ScanPage.tsx`, `frontend/src/pages/DashboardPage.tsx`, `frontend/src/pages/ReportsPage.tsx`, `frontend/src/pages/UsageReportPage.tsx`, `frontend/src/pages/DetailedExpiryReportPage.tsx`, `frontend/src/pages/StoreAreaManagementPage.tsx`, `frontend/src/pages/ExpiredItemsPage.tsx`, `frontend/src/components/MarkdownCalculator.tsx`, `frontend/src/components/ExpiredLossReport.tsx`, `frontend/src/components/ManageSubscriptionButton.tsx`, `frontend/src/components/SubscriptionDashboard.tsx`, `frontend/src/components/TrialBanner.tsx`, `frontend/src/components/TrialUpgradeFlow.tsx`, `frontend/src/lib/sync-manager.ts`, `frontend/src/lib/offline-sync.ts`

**Pattern**: Reuse the existing `apiService` transport and Clerk `useAuth().getToken()` pattern from `frontend/src/pages/CSVUploadPage.tsx` and the prior `ScanPage` expiry-submit fix.

## Reuse Strategy

- Add a shared frontend helper/hook for call-time Clerk token refresh with prop-token fallback.
- Keep `apiService` 401 behavior unchanged so real authorization failures still dispatch the unauthorized event.
- Extend existing page/component tests instead of adding broad end-to-end fixtures.
- Leave Worker auth, Clerk session settings, and `skills-lock.json` untouched.

## Implementation Steps

1. Add failing tests for representative stale-token call sites: ScanPage lookup, dashboard/report fetch, store-area mutation, markdown lookup, offline sync, and refresh fallback telemetry.
2. Add a shared helper/hook that calls Clerk `getToken()` immediately before authenticated API requests, falls back to the prop token, and captures refresh failures without token values.
3. Migrate authenticated frontend API calls to the helper across scan, report, management, subscription, markdown, expired-items, and sync surfaces.
4. Verify targeted tests, frontend lint/build where feasible, and OpenSpec validation.
