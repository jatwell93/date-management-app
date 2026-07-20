# Proposal: Fix Expired Items Write-Off Dialog and Loss Reporting

## Analysis

**Current**: `frontend/src/pages/ExpiredItemsPage.tsx`

- The `/expired-items` process dialog uses a hand-built modal instead of the shared Dialog/Input/Label/Button primitives.
- The UI defaults `unitsDiscarded` to `1`, but the process flow needs to accept any whole quantity from `1` through the row's `quantityAvailable`.
- The confirmation copy should name the exact units and calculated loss before submission.

**Affected**: `backend/src/services/expired-item.service.ts`, `backend/src/controllers/expired-item.controller.ts`, `backend/src/routes/expired-item.routes.ts`

- The Express backend already owns expired item write-off and expired-loss report behavior.
- Multi-unit write-offs should extend the existing service instead of adding another disposition flow.

**Affected**: `workers/src/database.ts`, `workers/src/minimal-api-routes.ts`, `workers/src/__tests__`

- Production Workers currently return 404 for `GET /api/expired-items/reports/expired-losses`, while the frontend already calls that route.
- Workers expired write-offs must match Express semantics so rows leave the expired worklist and loss reporting receives the same ledger shape.

**References**: GitHub issue 268.

## Reuse Strategy

- Extend the existing `ExpiredItemsPage` tests and component rather than creating a new frontend route or modal implementation.
- Reuse existing shared UI primitives from `frontend/src/components/ui`.
- Extend the current expired item service/controller and Workers database APIs instead of introducing a parallel write-off endpoint.
- Reuse existing expired-loss aggregation response shape: `{ lossesBySKU, lossesByStoreArea }`.
- Keep shared disposition/status semantics aligned with `shared/domain/disposition.ts`.

## Implementation Steps

1. Add failing frontend regressions for multi-unit process submission and invalid quantity rejection.
2. Add failing backend service coverage for multi-row expired write-offs, quantity bounds, one ledger row, and worklist removal.
3. Add failing Workers coverage for grouped quantities, multi-row processing, report parity, and non-404 expired-loss route behavior.
4. Replace the custom expired-items process modal with shared Dialog/Input/Label/Button primitives and update confirmation copy.
5. Implement Express and Workers quantity semantics so `unitsDiscarded` controls processed rows and financial loss.
6. Run focused frontend/backend/Workers tests, builds, OpenSpec validation, and browser verification on `/expired-items`.
