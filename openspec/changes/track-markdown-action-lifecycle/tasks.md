## Tasks

### Phase 1 — Capture markdown level at disposition
- [x] Add nullable `markdown_level` to `expired_item_transactions` across the Prisma schema + SQLite migration, the Neon migration (`prisma/migrations/neon/0002_*`), the backend runtime migration (id 9), and the pglite harness.
- [x] Populate `markdown_level` in `processExpiredItem` (workers + backend service) from days-to-expiry using the report bucketing (0-30→3, 31-60→2, 61-90→1; null when not on markdown). Covered by `database.disposition.pglite.node.test.ts` and `expired-item.service.test.ts`.
- [x] Allow `sold_through` disposition for active markdown items (proven by future-dated items in the disposition real-SQL test); write-off stays restricted to expired stock (enforced in the Phase 2 worklist UI); removal of active records uses the existing `deleteInventoryItem` flow.

### Phase 2 — Monthly markdown worklist
- [ ] Group `DetailedExpiryReportPage` into "New → Markdown 1 this month", "Already reduced — review", and "Expired → write off".
- [ ] Add inline "Sold through" / "Write off" actions reusing `expiredItemService.processExpiredItem`.
- [ ] Add focused frontend tests for grouping and disposition actions.

### Phase 3 — Sell-through reporting
- [ ] Add a sell-through-by-markdown-level report query (workers + backend) reusing loss-report plumbing.
- [ ] Surface the sell-through report on `ReportsPage` with focused tests.
- [ ] Run completion checks: `npm run lint`, focused + full tests, `openspec validate --all`.
