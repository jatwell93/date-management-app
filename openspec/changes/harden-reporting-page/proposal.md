## Why

The reporting pages scored 13/20 in the impeccable audit and read more like a generic analytics page than a PharmIQ pharmacy operations surface. Rather than creating separate OpenSpec changes for `impeccable harden`, `layout`, `adapt`, `clarify`, and `polish`, this change consolidates the full audit remediation into one reporting-page track.

Audit evidence:

- `frontend/src/components/ui/card.tsx:31` renders `CardTitle` as a `div`, while report pages rely on it for section headings at `frontend/src/pages/ReportsPage.tsx:99` and `frontend/src/pages/UsageReportPage.tsx:219`.
- `frontend/src/pages/UsageReportPage.tsx:236` and `frontend/src/pages/UsageReportPage.tsx:265` render Chart.js canvases without adjacent operational summaries.
- `frontend/src/pages/DetailedExpiryReportPage.tsx:516` wraps a wide table in horizontal scroll, and `frontend/src/pages/DetailedExpiryReportPage.tsx:538` tells mobile users the report is best viewed on desktop.
- `frontend/src/pages/ReportsPage.tsx:86`, `frontend/src/pages/UsageReportPage.tsx:141`, and `frontend/src/pages/DetailedExpiryReportPage.tsx:419` expose loading/error text without live-region semantics.
- `frontend/src/pages/ReportsPage.tsx:105` uses a repeated metric-tile grid that looks like generic dashboard furniture.
- `frontend/src/tests/UsageReportPage.test.tsx:47` currently mocks canvas in a way that still allowed Chart.js jsdom noise during the audit run.

## What Changes

- Add accessible loading and error states with live-region semantics and recoverable copy across report pages.
- Add non-canvas chart summaries and robust empty states so usage insights remain available when Chart.js cannot render or users rely on assistive technology.
- Harden report text, dates, numbers, and long labels against overflow using existing semantic tokens and shared UI primitives.
- Replace the detailed expiry mobile punt with a responsive, usable handheld reporting layout.
- Rework reporting layout hierarchy so report sections use semantic headings, left-aligned operational structure, and spacing rhythm appropriate for data-dense product UI.
- Replace generic metric-tile language with pharmacy decision language: expired risk, markdown action, active expiry stock, and next review window.
- Reduce the generic chart-heavy pattern by pairing visuals with scannable operational summaries and priority data.
- Stabilize usage-report tests so Chart.js does not emit jsdom canvas errors.
- Add focused tests for reporting hardening before production code changes.

## Capabilities

### New Capabilities

- `reporting-ui-resilience`: Reporting pages remain understandable and usable across loading, empty, error, long-text, chart fallback, and narrow viewport states.
- `reporting-page-layout`: Reporting pages use PharmIQ-specific hierarchy, spacing, and responsive structure instead of generic analytics card-grid patterns.

### Modified Capabilities

- `frontend-metrics`: Reporting surfaces must preserve accessible status, table, and chart-summary behavior while keeping frontend bundle and token compliance checks passing.

## Impact

- **Frontend pages:** `frontend/src/pages/ReportsPage.tsx`, `frontend/src/pages/UsageReportPage.tsx`, `frontend/src/pages/DetailedExpiryReportPage.tsx`
- **Shared UI:** `frontend/src/components/ui/card.tsx` only if heading semantics require a shared primitive adjustment
- **Tests:** existing reporting tests in `frontend/src/tests/ReportsPage.test.tsx`, `frontend/src/tests/UsageReportPage.test.tsx`, plus focused coverage for detailed expiry reporting
- **Verification:** focused Jest tests, targeted ESLint, token compliance, frontend build, OpenSpec validation, and browser QA where local auth permits
