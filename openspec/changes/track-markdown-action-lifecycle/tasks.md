## Tasks

### Phase 1 — Capture markdown level at disposition
- [ ] Add nullable `markdown_level` (smallint, 1-3) to `expired_item_transactions` across prisma/Neon migration, `backend/src/migrations`, the workers schema, the pglite harness, and the backend in-memory test schema.
- [ ] RED/GREEN: populate `markdown_level` in `processExpiredItem` (workers + backend service) from days-to-expiry using the report bucketing (0-30→3, 31-60→2, 61-90→1; null when not on markdown).
- [ ] RED/GREEN: allow `sold_through` disposition for active markdown items (not only already-expired stock); keep write-off restricted to expired stock — removal of active records uses the existing `deleteInventoryItem` flow.

### Phase 2 — Monthly markdown worklist
- [ ] Group `DetailedExpiryReportPage` into "New → Markdown 1 this month", "Already reduced — review", and "Expired → write off".
- [ ] Add inline "Sold through" / "Write off" actions reusing `expiredItemService.processExpiredItem`.
- [ ] Add focused frontend tests for grouping and disposition actions.

### Phase 3 — Sell-through reporting
- [ ] Add a sell-through-by-markdown-level report query (workers + backend) reusing loss-report plumbing.
- [ ] Surface the sell-through report on `ReportsPage` with focused tests.
- [ ] Run completion checks: `npm run lint`, focused + full tests, `openspec validate --all`.
