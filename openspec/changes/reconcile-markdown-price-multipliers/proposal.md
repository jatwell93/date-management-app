# Proposal: Reconcile backend markdown price multipliers with the canonical discount ladder

## Why

The app has **two divergent formulas** for the reduced price of marked-down stock, and they
disagree by a wide margin — in one case the "markdown" is actually a price *increase*.

- **Frontend (canonical, user-facing, tested):** `frontend/src/lib/utils.ts`
  `calculateMarkdownPercentage` / `calculateMarkdownPrice` express a discount **off cost**:
  - 0-30 days to expiry (Markdown 3) → **75% off** (price = cost x 0.25)
  - 31-60 days (Markdown 2) → **60% off** (price = cost x 0.40)
  - 61-90 days (Markdown 1) → **50% off** (price = cost x 0.50)
  - >90 days → 0% off
  This is shown on the Scan page (`ScanPage.tsx:552`, "Markdown Price (N% off)") and the detailed
  expiry report (`DetailedExpiryReportPage.tsx`), and is locked by `ScanPage.test.tsx` (89d→50%,
  59d→60%, 29d→75%).

- **Backend (wrong):** `backend/src/services/inventory-markdown.helpers.ts`
  `calculateInventoryMarkdownPrice` applies a near-cost ladder:
  - 0-30 days (Markdown 3) → cost x **0.8** (only 20% off)
  - 31-60 days (Markdown 2) → cost x **1.0** (full cost, 0% off)
  - 61-90 days (Markdown 1) → cost x **1.2** (a 20% **markup** on the *first* markdown)

The backend therefore under-discounts at every level and, at Markdown 1, raises the price — the
exact opposite of a markdown. Phase 1b of `track-markdown-action-lifecycle` reconciled the day
**thresholds** (7/14/30 → 30/60/90) but explicitly left these **price multipliers** as a separate
concern. This change closes that gap so cost-derived markdown prices are correct and identical on
both backends.

## Analysis

**Current usage of the wrong helper:**
- `backend/src/services/inventory-markdown.helpers.ts:54` `calculateInventoryMarkdownPrice`.
- Called by `backend/src/services/inventory.service.ts:385`
  (`InventoryService.calculateMarkdownPrice(id)`).
- That service method is **not currently wired to any HTTP route/controller** (no match in
  `backend/src/routes` or `backend/src/controllers`), so the defect is latent — it has not yet
  produced a visibly wrong price to an end user, but it will the moment the method is exposed or
  reused. Fixing it now removes a trap.
- Locked-in by `backend/src/tests/unit/inventory-markdown.helpers.test.ts:24-34`, which currently
  *asserts the wrong values* (30d→8, 60d→10, 90d→12 on a cost of 10). These tests must be updated to
  the correct discount ladder as part of the fix.

**Canonical source of truth:** the frontend's 75/60/50%-off ladder. It is user-facing, tested, and
matches the in-store intent (reduce progressively as expiry nears). The backend should match it.

**Note on a possible objection — "is the cost-ladder intentional?"** A cost-plus ladder (sell at
+20% / cost / -20% as expiry nears) is a coherent *concept*, but it contradicts the only
user-visible pricing in the app and would mean the "50% off" a customer sees on the Scan page is not
the price the backend would compute for the same item. One price per item is the requirement; the
frontend ladder wins because it is the one customers and staff actually see.

## Reuse Strategy

- **Change the multipliers in place** in `calculateInventoryMarkdownPrice` to mirror
  `calculateMarkdownPercentage` (x0.25 / x0.40 / x0.50; null when not on markdown), keeping the
  existing `INVENTORY_MARKDOWN_THRESHOLDS` (30/60/90) the function already uses after Phase 1b. No
  new function, no signature change.
- **Keep the day-window bucketing** already shared with the reports — only the price factors change.
- **Update the existing helper unit tests** to assert the correct ladder, and add a guard test that
  the backend price for a given days-to-expiry equals `cost x (1 - frontendPercentage/100)` at each
  boundary (30/60/90), so the two definitions cannot silently diverge again.
- Confirm no other backend path hardcodes the old 0.8/1.0/1.2 factors (workers pricing, if any).

## Implementation Steps

1. Update `calculateInventoryMarkdownPrice` multipliers to 0.25 / 0.40 / 0.50 (Markdown 3/2/1),
   returning null outside the 0-90 day window.
2. Update `inventory-markdown.helpers.test.ts` to the corrected expected values and add boundary
   guards aligning with the frontend percentages (50/60/75% off at 90/60/30 days).
3. Grep both backends for any other hardcoded markdown price factors; reconcile or document if found.
4. Run completion checks: backend lint + affected tests + `tsc`, and `openspec validate
   reconcile-markdown-price-multipliers --strict`.
