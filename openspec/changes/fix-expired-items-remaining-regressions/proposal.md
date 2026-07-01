# Proposal: Fix Remaining Expired Items Regressions

## Analysis

**Current**: `frontend/src/pages/ExpiredItemsPage.tsx`

- Issue 268 still needs protection for multi-unit expired write-offs where users clear the default `1` and type values such as `15` or `37`.
- The page currently stores `unitsDiscarded` as a number, which makes an empty input awkward and can prevent reliable multi-digit entry.
- Previous work in PR 303 and PR 307 should be treated as context, with this change extending the existing page and tests instead of replacing the dialog.

**Affected**: `backend/src/services/expired-item.service.ts`, `backend/src/controllers/expired-item.controller.ts`, `backend/src/routes/expired-item.routes.ts`

- Express already owns expired item grouping, processing, and expired-loss report behavior.
- The required behavior is exact multi-row processing for `N` matching inventory rows, one `expired_item_transactions` ledger row, and `financial_loss = unitsDiscarded * costPrice`.

**Affected**: `workers/src/index-minimal.ts`, `workers/src/database.ts`, `workers/src/minimal-api-routes.ts`, `workers/src/__tests__`

- Production currently builds from `workers/src/index-minimal.ts` via `workers/build.js`, not from Sentry's diagnostic `workers/src/index.ts` proposal.
- Sentry issue `NODE-EXPRESS-1X` reports `/expired-items` failing to fetch `/expired-items/reports/expired-losses` with 404. Related Sentry issues `NODE-EXPRESS-1W`, `NODE-EXPRESS-1V`, `NODE-EXPRESS-19`, and `NODE-EXPRESS-1R` are diagnostic context for issue 268 follow-up verification.
- The route must remain registered in `workers/src/index-minimal.ts`, and the built `workers/dist/index.js` artifact must contain `/api/expired-items/reports/expired-losses` after `npm run build --prefix workers`.

## Reuse Strategy

- Extend `frontend/src/tests/ExpiredItemsPage.test.tsx` and `frontend/src/pages/ExpiredItemsPage.tsx`; no new modal or service layer.
- Extend existing Express expired item tests and service behavior; no new controller/service/repository.
- Extend existing Workers route, database, and deployment smoke tests; do not copy `handleGetExpiredLossesReport` into `workers/src/index.ts` unless build/deploy config changes to use that entrypoint.
- Preserve the existing `expiredItemService` report shape: `{ lossesBySKU, lossesByStoreArea }`.

## Implementation Steps

1. Add frontend regression for clearing and typing multi-digit `#units-discarded`, confirmation copy, and API payload.
2. Add or confirm Express regressions for grouped `quantityAvailable > 1`, exact multi-row processing, one ledger row, bounds errors, and `financial_loss = costPrice * N`.
3. Add or confirm Workers regressions for route registration, multi-unit processing, expired-loss aggregation, and built artifact route presence.
4. Store the frontend units input as a string, parsing only during validation and submission.
5. Fix backend or Workers defects exposed by the regressions while preserving existing layered architecture.
6. Validate OpenSpec and run focused frontend, backend, Workers, build, and preview/live smoke checks where available.
