# Proposal: Fix Expiry Report NaN and Markdown Classification

## Analysis

**Current**: `frontend/src/pages/ReportsPage.tsx`
- Renders `/reports/expiry` and `/reports/expiry-overall` numeric fields directly with `Intl.NumberFormat`.
- The TypeScript interface assumes numeric fields are always `number`, but production API payloads may contain numeric strings, `null`, or missing values.
- Direct formatting can produce visible `NaN` in the expiry action summary and monthly buckets.

**Affected**: `backend/src/repositories/report.repository.ts`, `workers/src/database.ts`
- Existing SQL now computes markdown buckets from expiry-date windows:
  - Markdown 3: 0-30 days
  - Markdown 2: 31-60 days
  - Markdown 1: 61-90 days
  - Next-month markdown review: 91-120 days
- Reuse these existing repository contracts unless local evidence shows the API bucket math is still wrong.

**Pattern**: Extend the existing report page and focused tests.
- Keep controller/service/repository boundaries unchanged.
- Normalize frontend API response values at the report-page boundary before rendering.

## Reuse Strategy

- Extend `ReportsPage` with a small numeric response normalizer.
- Extend `frontend/src/tests/ReportsPage.test.tsx` with a production-shaped payload that reproduces visible `NaN`.
- Keep backend and Workers SQL aligned with existing tests unless a regression is reproduced there.

## Implementation Steps

1. Reproduce the frontend `NaN` behavior with a failing ReportsPage regression test.
2. Normalize report numeric fields from API payloads before storing state.
3. Run focused frontend, backend, and Workers report tests.
4. Validate OpenSpec and perform local browser QA for `/reports` where possible.
