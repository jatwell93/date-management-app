## Tasks

### Fix the multipliers
- [x] Update `calculateInventoryMarkdownPrice` in `backend/src/services/inventory-markdown.helpers.ts` to apply 0.25 (Markdown 3, 0-30d), 0.40 (Markdown 2, 31-60d), 0.50 (Markdown 1, 61-90d), and null outside the 0-90 day window — replacing the legacy 0.8 / 1.0 / 1.2 factors.

### Tests
- [x] Update `backend/src/tests/unit/inventory-markdown.helpers.test.ts` to assert the corrected prices (e.g. cost 10 → 30d=2.5, 60d=4, 90d=5, 91d=null).
- [x] Add a guard test asserting the backend price equals `cost * (1 - sharedDiscountPercentage/100)` at the 30/60/90 day boundaries (75/60/50% off) without importing frontend internals.

### Expired stock has no markdown price or level (review follow-up)
- [x] Guard `calculateInventoryMarkdownPrice` to return null for expired stock (`daysDiff <= 0`), mirroring `calculateInventoryMarkdownStatus`.
- [x] Align the shared lookups on "expires today or later = expired (no markdown)": `getMarkdownDiscountPercentageForDays` and `getMarkdownLevelForDays` both return none/null for `daysToExpiry <= 0`, fixing the day-0 case where reports/workers previously showed Markdown 3 for an item expiring today.
- [x] Add tests asserting expired stock returns no price (status `Expired` and price `null` agree), `getMarkdownDiscountPercentageForDays(-5) === 0`, and the day-0 boundary (`getMarkdownLevelForDays(0)` null, `(1)` Markdown 3).

### Verify no other divergence
- [x] Grep both backends (`backend/`, `workers/`) for any other hardcoded 0.8 / 1.0 / 1.2 markdown price factors; reconcile or document.

### Completion checks
- [x] Backend `npm run lint`, the affected markdown/inventory tests, and `tsc` pass.
- [x] `npx openspec validate reconcile-markdown-price-multipliers --strict` is valid.
