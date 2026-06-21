## Tasks

### Phase 1 — Capture markdown level at disposition
- [x] Add nullable `markdown_level` to `expired_item_transactions` across the Prisma schema + SQLite migration, the Neon migration (`prisma/migrations/neon/0002_*`), the backend runtime migration (id 9), and the pglite harness.
- [x] Populate `markdown_level` in `processExpiredItem` (workers + backend service) from days-to-expiry using the report bucketing (0-30→3, 31-60→2, 61-90→1; null when not on markdown). Covered by `database.disposition.pglite.node.test.ts` and `expired-item.service.test.ts`.
- [x] Allow `sold_through` disposition for active markdown items (proven by future-dated items in the disposition real-SQL test); write-off stays restricted to expired stock (enforced in the Phase 2 worklist UI); removal of active records uses the existing `deleteInventoryItem` flow.

### Phase 1b — Reconcile markdown thresholds
- [x] Align the stored-status thresholds (`INVENTORY_MARKDOWN_THRESHOLDS` / `InventoryService.MARKDOWN_THRESHOLDS`) from the legacy 7/14/30 days to the report/frontend windows 30/60/90 (Markdown 3/2/1). Updated helper, consistency, service, and create-status tests (118 inventory tests passing). Markdown *price multipliers* in the helper left unchanged (separate concern).

### Phase 2 — Monthly markdown worklist
- [x] Group `DetailedExpiryReportPage` into Apply Markdown 1 (61-90d), Markdown 2 — review (31-60d), and Markdown 3 — urgent (0-30d). (Expired → write off stays on the Expired items page, since the detailed report only returns 0-90 day stock and active stock gets sold-through only.)
- [x] Add inline "Sold through" action reusing the existing `/expired-items/process` disposition endpoint (markdown level snapshotted server-side).
- [x] Add focused frontend tests for grouping and the sold-through action.

### Phase 3 — Sell-through reporting
- [ ] Add a sell-through-by-markdown-level report query (workers + backend) reusing loss-report plumbing.
- [ ] Surface the sell-through report on `ReportsPage` with focused tests.
- [ ] Run completion checks: `npm run lint`, focused + full tests, `openspec validate --all`.
