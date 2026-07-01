# Proposal: Fix Issue 268 Expired Items Regressions

## Analysis

**Current**: `frontend/src/pages/ExpiredItemsPage.tsx`

- The expired item process dialog still mixes typography styles across product, SKU, location, expiry, cost, and quantity helper/error rows.
- Quantity entry must remain user-editable and allow any whole number from `1` to the grouped `quantityAvailable`, including rows where the available grouped quantity is greater than `1`.

**Affected**: `backend/src/services/expired-item.service.ts`, `backend/src/controllers/expired-item.controller.ts`, `backend/src/routes/expired-item.routes.ts`

- Express already owns expired item grouping, processing, and expired-loss report behavior.
- Regression coverage should prove grouped rows expose `quantityAvailable > 1` and processing `N` units updates exactly `N` inventory rows plus one ledger row.

**Affected**: `workers/src/database.ts`, `workers/src/minimal-api-routes.ts`, `workers/src/__tests__`

- Local code registers `GET /api/expired-items/reports/expired-losses`, but the deployed API has returned `404 {"error":"Not Found"}` for the same path.
- Worker tests and deployment smoke coverage must fail on route-not-found while allowing authentication-related statuses for unauthenticated live probes.

## Reuse Strategy

- Extend the existing expired-items frontend page and page tests rather than adding a new modal system.
- Reuse the existing `expiredItemService` public API shape: `GET /expired-items/reports/expired-losses` returns `{ lossesBySKU, lossesByStoreArea }`.
- Extend current Express and Workers expired item grouping/processing tests rather than adding parallel data-access paths.
- Add a narrow smoke script for the live Workers route so deployment freshness is checked without requiring secrets.

## Implementation Steps

1. Add frontend regressions for consistent dialog typography and multi-unit quantity submission.
2. Add Express regressions for grouped quantities and exact multi-row write-off semantics.
3. Add Workers regressions for route registration, grouped quantity, multi-unit processing, and expired-loss report shape.
4. Normalize expired-items dialog detail and quantity text typography.
5. Fix any grouping or processing defects exposed by the regressions.
6. Add and run a route smoke check that fails when the live expired-loss report endpoint returns 404.
