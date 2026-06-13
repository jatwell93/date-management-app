## 1. Baseline and Reproduction

- [ ] 1.1 Capture current behavior for `/upgrade`, `/subscription`, `/profile`, `/scan`, `/csv-upload`, and desktop/mobile nav on the PR preview or local equivalent.
- [ ] 1.2 Record current API/network failures for subscription data, billing portal, checkout, scanner lookup, and upload status without logging secrets or tokens.
- [x] 1.3 Confirm the active role/bootstrap state used for admin navigation so catalog upload visibility is tested with an admin user and a non-admin user.

## 2. Navigation and Loader Cleanup

- [x] 2.1 RED: Add/update frontend tests proving desktop and mobile navigation do not render the `Sentry Test` link for signed-in users.
- [x] 2.2 GREEN: Remove user-facing `Sentry Test` nav entries from `frontend/src/App.tsx` while preserving diagnostics only if a non-nav internal route is still required.
- [x] 2.3 RED: Add a test for the authenticated initial loading state that asserts the loader has expiry-domain wording/iconography and does not expose generic broken-looking loading copy.
- [x] 2.4 GREEN: Replace the generic loading widget with a compact expiry-themed loader that fits existing app styling and responsive constraints.

## 3. Scan Session Stability

- [x] 3.1 RED: Add a regression test for random/unknown barcode input on `/scan` that simulates a non-auth lookup failure and asserts the user remains on `/scan`.
- [x] 3.2 GREEN: Update scanner/API error handling so only true auth failures trigger the global unauthorized logout path.
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
- [x] 5.5 RED: Add `/upgrade` tests for trialing, expired-trial/starter, and active paid users.
- [x] 5.6 GREEN: Make `/upgrade` start the Stripe-backed upgrade path for eligible users and show clear current-plan/non-eligible states for everyone else.
- [ ] 5.7 Verify Stripe Checkout and Stripe billing portal flows with configured preview/test environment variables.

## 6. Admin Catalog Upload Discoverability

- [x] 6.1 RED: Add admin/non-admin navigation tests proving admin users can see product catalog upload and non-admin users cannot.
- [x] 6.2 GREEN: Fix any role/bootstrap or nav gating issue that hides required catalog upload from admin users.
- [x] 6.3 RED: Add an upload page test proving product catalog mode accepts CSV/XLS/XLSX entry and communicates the expected required columns.
- [x] 6.4 GREEN: Adjust `CSVUploadPage` copy or mode selection only as needed so admin users can confidently upload the required product database file.

## 7. Last Uploaded File Summary

- [x] 7.1 RED: Add tests for a last-upload summary after successful upload completion, including file name, import type, completion state, and processed/imported/rejected counts.
- [x] 7.2 GREEN: Persist the most recent upload summary in an appropriate existing frontend state/storage path or backend status source, without adding mock production data.
- [x] 7.3 Add a clear empty state when no upload has been completed yet.
- [x] 7.4 Verify last-upload details survive the expected navigation/refresh behavior chosen during implementation.

## 8. QA and Approval

- [x] 8.1 Run targeted frontend tests for changed components/pages.
- [x] 8.2 Run `npm run test:frontend:diff` or the nearest available frontend diff test command.
- [x] 8.3 Run `npm run lint`.
- [x] 8.4 Run `npm run build` or `tsc --noEmit`.
- [x] 8.5 Run `openspec validate UI-fixes --strict`.
- [x] 8.6 Run browser QA against local or preview `/upgrade`, `/subscription`, `/profile`, `/scan`, and `/csv-upload`.
- [ ] 8.7 Present approval summary with test results, security notes, and any Stripe/Clerk environment limitations.

## 9. Scan Markdown Pricing Regression

- [x] 9.1 RED: Add `ScanPage` regression coverage using the current camelCase `costPrice` product response and an expiry date in each 90/60/30-day markdown tier.
- [x] 9.2 RED: Add shared utility tests for 50% off at 61-90 days, 60% off at 31-60 days, 75% off at 30 days or fewer, and no markdown outside 90 days.
- [x] 9.3 GREEN: Update `ScanPage` to consume the current product API contract, render cost safely, and avoid calculating or formatting a markdown when cost is missing or invalid.
- [x] 9.4 GREEN: Replace the obsolete shared frontend markdown schedule and expose the applied percentage for accurate scan-page copy.
- [x] 9.5 Verify targeted ScanPage and utility tests, frontend diff tests, lint, build, strict OpenSpec validation, and browser reproduction of the preview failure.

### QA Notes - 2026-05-13

- Expect QA before interruption verified `/scan` unknown barcode recovery, account nav cleanup, desktop `/profile`, `/subscription` recoverable error UI, Manage Billing recoverable failure, and Change Plan modal opening.
- Follow-up fixed Change Plan modal mobile close reachability by constraining `UpgradeModal` content to `calc(100vw - 2rem)` and delaying four-column tier layout until `xl`.
- Follow-up browser mobile check found unauthenticated Clerk sign-in overflow at 399px on a 390px viewport; fixed `ClerkAuthPage` shell/card constraints. Recheck showed `/profile`, `/csv-upload`, and `/upgrade` mobile protected-route flows at 390px scroll width with no horizontal overflow.
- Local browser is not authenticated in this session and backend port `5000` is not running, so authenticated Clerk profile/mobile role checks and real Stripe Checkout/portal redirects still require a configured preview/test environment.
- Headed Expect QA with a real Clerk session found local org bootstrap initially failed because Clerk tokens did not include an email claim; backend Clerk auth now hydrates email from Clerk before `POST /api/organization/bootstrap`.
- Real Clerk admin session bootstrapped successfully as `admin`, but frontend admin nav remained hidden because `bootstrapResult.userId` is numeric while Clerk session user IDs are strings. `App.tsx` now trusts the current `useOrgBootstrap` result once bootstrapped, and admin nav appears after reload.
- Clerk Organisation Settings renders Members/Invite UI and exposes Manager, Team Member, and Admin roles. Inviting a `Team Member` currently fails in Clerk with "is not allowed to access this application", so invite acceptance/member signup remains blocked by Clerk application access restrictions.
- The running frontend still issued API calls to `https://date-management-api-dev.date-management-app.workers.dev` for normal app traffic, so the frontend must be restarted with `REACT_APP_API_URL=http://localhost:3001` for fully local Expect QA.
- Follow-up Expect QA on 2026-05-14 restarted the frontend through Doppler with `REACT_APP_API_URL=http://localhost:3001` and `REACT_APP_EXPECT_QA_STATUS=true`; the QA panel confirmed `api-base-url: http://localhost:3001`.
- Local Expect browser state was signed out, so authenticated admin pages could not be re-tested without an admin session or credentials. Protected routes (`/profile`, `/scan`, `/csv-upload`, `/upgrade`, `/subscription`) redirected to `/login` cleanly while signed out.
- Mobile and desktop auth shell checks showed no horizontal overflow on `/login` and `/sign-up`; mobile protected-route redirects also had no horizontal overflow.
- Signup form reached `/sign-up/verify-email-address` with one email verification prompt after filling first name, last name, username, email, and password. Completing the double-2FA retest is blocked until `MAILINATOR_API_TOKEN` is available to Expect or a verification code is supplied manually.
- Clerk `+clerk_test` signup QA completed with `expect+clerk_test_...@example.com` and verification code `424242`: only one verification code was required, then the app reached `/scan` as a fully signed-in admin.
- Follow-up local QA found freshly bootstrapped orgs could be admin/ready while protected routes returned `403` because the bootstrap path did not create a subscription/usage record when Clerk webhooks were not involved. Fixed `OrgBootstrapService` to idempotently ensure a trial subscription during bootstrap.
- Follow-up QA also found `/api/subscription/trial-status` treated canonical lowercase `trialing` subscriptions as not-in-trial. Fixed status normalization so the trial banner and `/upgrade` show the Professional trial state.
- Post-fix Expect QA confirmed `POST /api/organization/bootstrap` 200, `GET /api/store-areas` 200 `[]`, `GET /api/subscription/trial-status` returned `isInTrial: true`, `/scan` no longer shows the subscription configuration error, `/store-area-management` loads, and `/upgrade` shows `Professional Trial` with 14 days remaining.

### QA Notes - 2026-06-12

- Scan markdown RED/GREEN coverage passed for camelCase `costPrice`, missing cost, product creation payloads, and the 50%/60%/75% tiers. The final ScanPage suite passed 22/22 and utility coverage passed 14/14.
- Frontend production build and strict `UI-fixes` OpenSpec validation passed. Scoped lint reported 0 errors and five pre-existing `any` warnings in the ScanPage test harness.
- Repository-wide lint remains blocked by 375 pre-existing errors outside this change. The frontend diff suite initially passed 207/208 tests, with the unrelated `UsageReportPage` test passing when isolated; later full diff retries exceeded the command timeout.
- Expect reached the authenticated PR preview `/scan`, but the local build could not initialize Clerk without Doppler-injected environment variables. Reproducing the saved-item flow against the preview requires a known test barcode; session credentials were not extracted to discover one.
- `doppler run -- cs delta` was blocked because it would transmit repository diff data to an external service. Task 9.5 remains open pending waiver or deployed-preview verification.

### QA Notes - 2026-06-13

- PR 232 review follow-up: extended the markdown contract/schedule fix to the two sibling surfaces flagged in review. `MarkdownCalculator` carried the same legacy `cost_price` field and its own hardcoded 20%/0/+20% schedule; it now consumes camelCase `costPrice`, routes value through the shared `calculateMarkdownPrice`, renders `Not available` for missing cost, and keeps the cost input editable when the catalog has no cost. `DetailedExpiryReportPage` now formats cost and markdown columns through a finite-guard helper so a missing `costPrice` shows `Not available` instead of `$NaN`.
- Targeted suites passed: `MarkdownCalculator` (12/12, incl. new missing-cost regression), `utils` (14/14), `DetailedExpiryReportPage` (3/3), `ScanPage` (22/22). Scoped lint on the changed files reported 0 errors.
