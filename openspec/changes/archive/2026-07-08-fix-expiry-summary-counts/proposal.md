# Proposal: Fix Expiry Report Summary Counts

## Analysis

**Current**: `frontend/src/pages/ReportsPage.tsx`
- The `/reports` page fetches `/reports/expiry` and `/reports/expiry-overall`.
- The expiry action summary cards render `expiry_risk_count`, `next_month_markdown_count`, and `active_expiry_stock_count` from the overall payload.
- Missing or malformed overall summary fields are currently normalized to `0`, which can hide a stale API contract behind misleading dashboard values.
- The monthly report table still shows the low-value `Total Markdown` aggregate column.

**Affected**: `workers/src/database.ts`, `backend/src/repositories/report.repository.ts`
- Existing report SQL already derives expiry buckets from shared `MARKDOWN_WINDOWS` rather than stored status strings.
- Regression coverage should prove Workers and SQLite stay aligned for `expiry_risk_count`, `next_month_markdown_count`, and `active_expiry_stock_count`.

**References**: GitHub issue 240; Sentry `NODE-EXPRESS-18`.

## Reuse Strategy

- Extend existing report tests instead of adding new report infrastructure.
- Keep canonical windows in `shared/domain/markdown.ts`:
  - `0-30` days for expiry risk.
  - `91-120` days for entering markdown next month.
  - `>= 0` days for active future-dated expiry stock.
- Keep backend API fields unchanged for compatibility; remove only the redundant monthly table display.

## Implementation Steps

1. Add frontend regressions for exact summary-card counts, missing overall summary contract errors, and absence of `Total Markdown` in monthly report UI.
2. Add or extend Workers/dual-backend regression coverage for organization-scoped summary counts using real seeded rows.
3. Fix report normalization/UI code to reject missing required overall summary fields and remove the monthly `Total Markdown` display.
4. Run focused frontend, backend, Workers, lint/build, OpenSpec, and available final quality gates.
