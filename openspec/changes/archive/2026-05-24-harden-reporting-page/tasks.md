## 1. Baseline and Tests

- [x] 1.1 RED: Add report loading and error accessibility tests for `ReportsPage`.
- [x] 1.2 RED: Add usage chart semantic-summary tests for user and date chart data.
- [x] 1.3 RED: Add detailed expiry mobile-resilience tests for summary copy and removal of the desktop punt.
- [x] 1.4 RED: Add heading-semantics tests for report section titles.
- [x] 1.5 RED: Add layout/copy regression tests proving the overall expiry summary no longer renders as a generic repeated metric-tile grid.
- [x] 1.6 RED: Add a usage-report test boundary that fails on Chart.js canvas noise or missing chart mocks.

## 2. Report Page Hardening and Clarification

- [x] 2.1 GREEN: Add announced loading and alert error states to `ReportsPage`.
- [x] 2.2 GREEN: Format report numbers and dates with `Intl` and improve empty-state copy.
- [x] 2.3 GREEN: Keep report action links responsive and resistant to long labels.
- [x] 2.4 GREEN: Replace generic overall metric labels with pharmacy action language for expired risk, markdown action, active expiry stock, and review timing.
- [x] 2.5 GREEN: Replace the repeated metric-tile grid with a prioritized operational summary layout.

## 3. Usage Report Hardening

- [x] 3.1 GREEN: Add accessible non-canvas chart summaries for items-by-user and items-by-date.
- [x] 3.2 GREEN: Use real user names in chart labels and summary rows.
- [x] 3.3 GREEN: Add announced loading/error states and hardened empty-state copy.
- [x] 3.4 GREEN: Stabilize `UsageReportPage` tests so Chart.js does not emit jsdom canvas errors.

## 4. Detailed Expiry Adaptation

- [x] 4.1 GREEN: Add a compact report summary for detailed expiry counts.
- [x] 4.2 GREEN: Replace the mobile desktop warning with clear table navigation context.
- [x] 4.3 GREEN: Harden long text and edit controls using existing shared primitives and semantic tokens.
- [x] 4.4 GREEN: Provide a priority-column or mobile row-summary layout for handheld pharmacy use while preserving full table access.

## 5. Reporting Layout Pass

- [x] 5.1 GREEN: Make report section titles semantic headings without broad shared-component churn unless required.
- [x] 5.2 GREEN: Apply product-layout spacing rhythm: tight control groups, clear region separation, predictable scanning, and no nested cards.
- [x] 5.3 GREEN: Rebalance reporting hierarchy so expiry risk and next actions are visually primary, charts and history are supporting.

## 6. Final Polish and Verification

- [x] 6.1 Run focused reporting tests and confirm RED-to-GREEN results.
- [x] 6.2 Run targeted ESLint, token compliance, route-performance tests, semantic page tests, and frontend build.
- [x] 6.3 Run OpenSpec validation for `harden-reporting-page`.
- [x] 6.4 Run browser QA where local authentication permits and record any limitations.
- [x] 6.5 Run a final impeccable-style polish check for anti-patterns, copy fit, responsive behavior, and accessible semantics.
