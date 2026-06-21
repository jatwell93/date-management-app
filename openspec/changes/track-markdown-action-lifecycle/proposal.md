# Proposal: Track the end-to-end markdown action lifecycle

## Why

Stores currently run the markdown process on an Excel month-tab diary: each month they look
ahead ~3 months, apply Markdown 1, then re-check older months to deepen reductions, mark items
as sold-through, or write off expired stock. The app computes *what level an item should be at*
from its used-by date, but it cannot record *what the team actually did* — which lines were sold
while reduced, and at which markdown level. That gap is why the diary still exists.

This change closes the loop so the app handles **record → reduce → track → write-off** end to
end, and surfaces the key insight the diary cannot: which products only sell once reduced.

## Analysis

**Current — disposition machinery already exists and is heavily reused here:**
- Workers: `workers/src/database.ts:747` `processExpiredItem(...)` sets `inventory_items.status`
  to `Sold Through` / `Expired` and writes a row to `expired_item_transactions`
  (`action`, `units_discarded`, `financial_loss`, `transaction_date`).
- Backend (Node/SQLite): `backend/src/services/expired-item.service.ts`,
  `backend/src/controllers/expired-item.controller.ts`, `backend/src/routes/expired-item.routes.ts`,
  ledger table from `backend/src/migrations/007-add-expired-item-transactions-table.migration.ts`.
- Frontend: `frontend/src/services/expiredItemService.ts` (`processExpiredItem`,
  `getExpiredItems`, `getExpiredLossesReport`), `frontend/src/pages/ExpiredItemsPage.tsx`,
  types in `frontend/src/types/inventory.ts:24-38`.
- Markdown level + price are computed from days-to-expiry, not stored:
  `frontend/src/pages/DetailedExpiryReportPage.tsx:75` (`getMarkdownStatus`) and
  `frontend/src/lib/utils.ts:16-31` (`calculateMarkdownPrice` / `calculateMarkdownPercentage`),
  with a backend inventory-markdown helper extracted from `InventoryService`.
- The "next 90 days" detailed report (`DetailedExpiryReportPage.tsx`) already lists each item with
  its computed markdown status and price — the natural home for a monthly worklist.

**Gaps (the actual scope):**
1. `processExpiredItem` only targets stock the Expired-items page surfaces (already past expiry);
   the team also needs to record **sold-through** for *active* items while they are on markdown.
   (Write-off stays restricted to expired stock; removing an active record for damage/recall uses
   the existing `deleteInventoryItem` / `DELETE /inventory-items/:id` flow.)
2. The ledger records the action but **not the markdown level at the time of disposition**, so the
   "only sells when reduced" insight is impossible to report.
3. There is no **monthly worklist** grouping items into the diary's three steps (new to Markdown 1,
   already-reduced review, expired → write off) with inline disposition actions.
4. There is no **sell-through-by-markdown-level** report.

**Constraint (confirmed with user):** markdown *level* stays computed from the used-by date. We only
persist a **snapshot** of the computed level on the disposition event (the item is gone/changes
after sale, so a historical snapshot is required for reporting).

## Reuse Strategy

- **Extend, do not rebuild, the disposition path.** Add a nullable `markdown_level` (smallint, 1-3)
  to `expired_item_transactions` and populate it inside the existing `processExpiredItem` from the
  item's days-to-expiry at disposition time (reusing the same bucketing as the reports). Mirror the
  column in: Neon/prisma migration, `backend/src/migrations`, the workers schema, the pglite harness
  (`workers/src/__tests__/pglite-db.ts`), and the backend in-memory test schema.
- **Allow sold-through of active markdown items** by relaxing the eligibility check in the existing
  service rather than adding a new endpoint; reuse `POST /expired-items/process`. Write-off remains
  restricted to expired stock; active records are removed via the existing delete flow.
- **Extend `DetailedExpiryReportPage`** into a grouped monthly worklist with inline "Sold through"
  and "Write off" actions calling the existing `expiredItemService.processExpiredItem`.
- **Extend reporting** by adding a sell-through-by-markdown-level query alongside the existing loss
  reports (`getLossBySkuReport` / `getExpiredLossesReport`), surfaced on `ReportsPage`.
- Follow TDD with the existing patterns: real-SQL pglite tests (`*.node.test.ts`, `npm run test:db`),
  backend jest repository/service tests, and frontend craco/jest page tests.

## Implementation Steps

Phase 1 — Capture markdown level at disposition (foundation)
1. Add `markdown_level` to `expired_item_transactions` across prisma/Neon, backend migration,
   workers schema, pglite harness, and backend test schema.
2. Populate `markdown_level` in `processExpiredItem` (workers + backend service) from days-to-expiry,
   reusing the report bucketing; add real-SQL/jest coverage.
3. Allow `sold_through` disposition for active markdown items (not only past-expiry); keep write-off
   restricted to expired stock; add regression coverage.

Phase 2 — Monthly markdown worklist
4. Group `DetailedExpiryReportPage` into: New → Markdown 1 this month, Already reduced — review,
   Expired → write off; add inline disposition actions reusing `expiredItemService`.
5. Add focused frontend tests for grouping and the disposition actions.

Phase 3 — Sell-through reporting
6. Add a sell-through-by-markdown-level report query (workers + backend) and surface it on
   `ReportsPage`, reusing the loss-report plumbing.
7. Add report tests (real-SQL + frontend) and run completion checks
   (`npm run lint`, tests, `openspec validate --all`).
