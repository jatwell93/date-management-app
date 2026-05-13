## Why

Testing against the dev preview at `https://pr-126.date-management-frontend.pages.dev/upgrade` shows several UI paths that are either still exposed as internal/dev affordances, visually inconsistent, or disconnected from already-built capabilities. These are launch blockers because a trial user cannot reliably scan, manage account/billing, upgrade, seed required product data, or inspect the result of the most recent upload.

This change formalizes the existing `UI-fixes` note into an OpenSpec change so implementation can proceed through TDD and focused QA instead of another broad UI pass.

## Analysis

**Current note source:** `openspec/changes/UI-fixes` was a flat note file listing observed issues. It has been converted into this OpenSpec change directory so progress can be tracked with `tasks.md` and validated with OpenSpec.

**Relevant existing frontend surfaces:**

- `frontend/src/App.tsx:286` renders a desktop `Sentry Test` nav link, and `frontend/src/App.tsx:496` renders the same path in mobile nav. This should be removed from user-facing navigation while preserving any internal route only if still needed for diagnostics.
- `frontend/src/App.tsx:372` includes `Billing` inside the Account dropdown, while `frontend/src/App.tsx:385` also exposes `Billing` as a standalone top-level tab. The standalone billing tab should be removed so billing lives under Account.
- `frontend/src/App.tsx:670` and `frontend/src/App.tsx:839` route `/upgrade` to `TrialUpgradeFlow`, but the dev preview behavior indicates the user-facing path does not complete the expected upgrade experience.
- `frontend/src/pages/SubscriptionSettingsPage.tsx:31` loads `/subscription/current` and `/organization/usage`; `frontend/src/pages/SubscriptionSettingsPage.tsx:112` starts Stripe Checkout; `frontend/src/components/ManageSubscriptionButton.tsx:26` starts the Stripe billing portal. Existing components should be reused rather than rebuilding bespoke billing UI.
- `frontend/src/pages/CSVUploadPage.tsx:52` already supports `product-catalog` and expiry-list import modes, and `frontend/src/App.tsx:413` exposes `CSV Upload` only behind admin/member-management permission. The missing piece is user-visible admin access and validation that this required catalog import path is reachable in the current role/bootstrap flow.
- `frontend/src/pages/CSVUploadPage.tsx:357` polls upload status for an upload key and renders per-upload results in state, but there is no durable user-facing "last uploaded file" summary after the page/session changes.
- `frontend/src/App.tsx:153` has a global unauthorized handler. The `/scan` logout report should be tested against scanner/API failure paths so random barcode input does not trigger a full logout unless auth is actually invalid.
- `frontend/src/App.tsx:617` has a handheld settings TODO, and the current generic loading state uses app-wide styling rather than an expiry-domain loading affordance.

**Related OpenSpec context:**

- `openspec/changes/trial-readiness/proposal.md` and `tasks.md` already attempted to expose Clerk profile, subscription UI, CSV upload, and onboarding/catalog flows.
- `openspec/changes/archive/2026-02-25-implement-trial-system/proposal.md` specified trial status, upgrade CTA, and Stripe conversion paths.
- `openspec/changes/archive/2026-04-09-add-onboarding-expiry-list-import/proposal.md` and specs added permanent CSV/XLS/XLSX import capabilities, including expiry import and template downloads.

## Reuse Strategy

- Extend existing routes/components instead of creating replacement billing, upgrade, upload, or account surfaces.
- Reuse `SubscriptionSettingsPage`, `SubscriptionDashboard`, `UpgradeModal`, `ManageSubscriptionButton`, and `TrialUpgradeFlow` for billing and upgrade fixes.
- Reuse `CSVUploadPage` for admin product catalog upload and upload result presentation.
- Reuse Clerk `UserProfile` routing for profile rendering, with wrapper/layout fixes only where needed to center the profile inside the app shell.
- Reuse existing scanner and auth error boundaries; change logout behavior only after reproducing the random-code scan failure with a failing test.

## What Changes

- Remove dev-only Sentry Test navigation from user-facing desktop/mobile nav.
- Replace the generic initial page loader with a compact expiry-themed loading affordance.
- Prevent scanner lookup failures for random barcode input from logging the user out.
- Center Clerk profile/account UI within the app layout.
- Make Billing available under Account only, using Stripe portal/checkout flows for billing management and plan changes.
- Make `/upgrade` a functional upgrade path for trial and non-trial eligible users.
- Ensure admin users can reach the required CSV/XLSX product catalog upload flow.
- Add a user-visible last-upload summary so users can inspect the most recent file and processing outcome.

## Capabilities

### Added

- `launch-ui-readiness`: User-facing UI routes and navigation must expose only production-appropriate entries and must keep required account, billing, upgrade, scan, and upload workflows functional.
- `upload-last-file-summary`: Users can see the last uploaded file and its processing result after completing a catalog or expiry import.

### Modified

- `subscription-ui`: Upgrade and billing surfaces must route through existing Stripe checkout/portal paths without duplicate navigation entries.
- `csv-catalog-upload`: Admin product catalog upload must remain discoverable and usable in the current role-gated navigation.
- `scanner-workflow`: Non-auth scanner lookup failures must not clear the authenticated session.

## Impact

- **Frontend router/nav:** `frontend/src/App.tsx`
- **Account/profile:** Clerk `UserProfile` wrapper in `frontend/src/App.tsx`
- **Billing/upgrade:** `frontend/src/pages/SubscriptionSettingsPage.tsx`, `frontend/src/components/SubscriptionDashboard.tsx`, `frontend/src/components/TrialUpgradeFlow.tsx`, `frontend/src/components/UpgradeModal.tsx`, `frontend/src/components/ManageSubscriptionButton.tsx`
- **Scan workflow:** `frontend/src/pages/ScanPage.tsx`, `frontend/src/pages/__tests__/ScanPage.test.tsx`
- **Upload workflow:** `frontend/src/pages/CSVUploadPage.tsx`, `frontend/src/pages/__tests__/CSVUploadPage.test.tsx`
- **Regression coverage:** frontend component tests and targeted E2E smoke tests for `/upgrade`, `/subscription`, `/profile`, `/scan`, and `/csv-upload`

## Success Criteria

- No user-facing desktop or mobile navigation exposes `Sentry Test`.
- Initial loading state uses a small expiry-domain loader and does not look like a broken generic spinner.
- Entering an unknown/random barcode in `/scan` shows a recoverable product-not-found or validation state and keeps the user signed in.
- `/profile` renders Clerk profile UI centered within the app shell.
- Billing appears only under Account and can open Stripe billing portal or present a clear recoverable error.
- `/upgrade` allows eligible users to start a Stripe-backed plan upgrade, or shows a clear non-eligible/current-plan state.
- Admin users can find and use product catalog CSV/XLSX upload.
- Users can see their most recent uploaded file name, upload type, completion state, and processing counts.
- `openspec validate UI-fixes --strict`, frontend tests, lint, and relevant E2E smoke tests pass before approval.
