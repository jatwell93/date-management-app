## 1. Baseline and Reproduction

- [ ] 1.1 Capture current behavior for `/upgrade`, `/subscription`, `/profile`, `/scan`, `/csv-upload`, and desktop/mobile nav on the PR preview or local equivalent.
- [ ] 1.2 Record current API/network failures for subscription data, billing portal, checkout, scanner lookup, and upload status without logging secrets or tokens.
- [ ] 1.3 Confirm the active role/bootstrap state used for admin navigation so catalog upload visibility is tested with an admin user and a non-admin user.

## 2. Navigation and Loader Cleanup

- [x] 2.1 RED: Add/update frontend tests proving desktop and mobile navigation do not render the `Sentry Test` link for signed-in users.
- [x] 2.2 GREEN: Remove user-facing `Sentry Test` nav entries from `frontend/src/App.tsx` while preserving diagnostics only if a non-nav internal route is still required.
- [x] 2.3 RED: Add a test for the authenticated initial loading state that asserts the loader has expiry-domain wording/iconography and does not expose generic broken-looking loading copy.
- [x] 2.4 GREEN: Replace the generic loading widget with a compact expiry-themed loader that fits existing app styling and responsive constraints.

## 3. Scan Session Stability

- [ ] 3.1 RED: Add a regression test for random/unknown barcode input on `/scan` that simulates a non-auth lookup failure and asserts the user remains on `/scan`.
- [ ] 3.2 GREEN: Update scanner/API error handling so only true auth failures trigger the global unauthorized logout path.
- [ ] 3.3 Verify scanner behavior for product-not-found, validation failure, network failure, and actual 401/403 responses.

## 4. Account Profile Layout

- [x] 4.1 RED: Add a route/layout test for `/profile` proving Clerk profile content is centered within the app shell on desktop and does not align hard-left.
- [x] 4.2 GREEN: Add the smallest wrapper/layout adjustment around Clerk `UserProfile` routing to center the account panel without forking Clerk UI.
- [ ] 4.3 Verify the profile page remains usable on mobile and does not overflow horizontally.

## 5. Billing and Upgrade Flow

- [x] 5.1 RED: Add a nav test proving Billing appears under Account and does not appear as a standalone top-level tab.
- [x] 5.2 GREEN: Remove the standalone Billing nav item from desktop and mobile navigation, keeping Account > Billing.
- [x] 5.3 RED: Add tests for `/subscription` showing recoverable UI when `/subscription/current`, `/organization/usage`, or Stripe portal creation fails.
- [x] 5.4 GREEN: Improve subscription error states so users are told what failed and can retry/open support without a blank or misleading billing page.
- [ ] 5.5 RED: Add `/upgrade` tests for trialing, expired-trial/starter, and active paid users.
- [ ] 5.6 GREEN: Make `/upgrade` start the Stripe-backed upgrade path for eligible users and show clear current-plan/non-eligible states for everyone else.
- [ ] 5.7 Verify Stripe Checkout and Stripe billing portal flows with configured preview/test environment variables.

## 6. Admin Catalog Upload Discoverability

- [x] 6.1 RED: Add admin/non-admin navigation tests proving admin users can see product catalog upload and non-admin users cannot.
- [ ] 6.2 GREEN: Fix any role/bootstrap or nav gating issue that hides required catalog upload from admin users.
- [ ] 6.3 RED: Add an upload page test proving product catalog mode accepts CSV/XLS/XLSX entry and communicates the expected required columns.
- [ ] 6.4 GREEN: Adjust `CSVUploadPage` copy or mode selection only as needed so admin users can confidently upload the required product database file.

## 7. Last Uploaded File Summary

- [x] 7.1 RED: Add tests for a last-upload summary after successful upload completion, including file name, import type, completion state, and processed/imported/rejected counts.
- [x] 7.2 GREEN: Persist the most recent upload summary in an appropriate existing frontend state/storage path or backend status source, without adding mock production data.
- [x] 7.3 Add a clear empty state when no upload has been completed yet.
- [x] 7.4 Verify last-upload details survive the expected navigation/refresh behavior chosen during implementation.

## 8. QA and Approval

- [x] 8.1 Run targeted frontend tests for changed components/pages.
- [ ] 8.2 Run `npm run test:frontend:diff` or the nearest available frontend diff test command.
- [x] 8.3 Run `npm run lint`.
- [x] 8.4 Run `npm run build` or `tsc --noEmit`.
- [x] 8.5 Run `openspec validate UI-fixes --strict`.
- [ ] 8.6 Run browser QA against local or preview `/upgrade`, `/subscription`, `/profile`, `/scan`, and `/csv-upload`.
- [ ] 8.7 Present approval summary with test results, security notes, and any Stripe/Clerk environment limitations.
