# Tasks: Base SKU list for new stores

Tasks are tracer-bullet slices: each one lands its own tests and docs and leaves the app working. Run `npm run test:db`, `npm run test:operations` and `(cd workers && npm run typecheck)` for the packages a task touches. Every new tenant-data query gets a tenant-isolation test (seed a second organization's rows and assert they never appear), mutation-verified by removing the `organization_id` predicate.

## 1. Schema and the owner's sheet

- [ ] 1.1 Migration `0021_add_base_sku_list` (`.up.sql` and `.down.sql`). It adds `master_catalogue_entries.cost_price` and `base_rank` (non-unique partial index on active ranked rows), `products.catalogue_entry_id` (FK, `ON DELETE SET NULL`), `base_list_cost_price`, `base_list_retail_price` and `locked_over_plan`, and `organizations.base_list_supplier` (CHECK `API`/`SIGMA`/`CH2`) and `base_list_adopted_at`. Update `manifest.json`, `catalog-fingerprint.json`, the prod-schema artifact and the three id lists (see the adding-a-migration checklist). Update the pglite harness schema if it is hand-written.
      Demo: the migration applies and rolls back cleanly on a scratch database.
      Acceptance: `npm run test:migrations` and `npm run test:db` pass; a pglite test shows the down migration restores the prior columns.
- [ ] 1.2 Extend the seeder (`src/operations/master-catalogue-seed.ts`, CLI, tests) with the new-layout headers `Department`, `Category`, `Cost $` and `Base Rank`. The layout is chosen by the presence of `Department` (design decision 2). Validate unique positive ranks, non-negative cost, and cost and `RRP $` present on ranked rows. Include the new fields in the blank-value guard and the dry-run diff.
      Demo: a dry run on a sample new-layout workbook prints added, changed and retired counts, and a legacy workbook still publishes unchanged.
      Acceptance: `npm run test:operations` passes with cases for duplicate rank, missing cost on a ranked row, legacy layout, blank-guard refusal and retirement of a ranked entry (rank cleared, excluded from the allowance) and a rank swap between two rows in one run. Document the new sheet columns and the quarterly refresh steps in `docs/csv-upload-format.md` or a sibling doc.

## 2. Adopt the base list

- [ ] 2.1 Worker handler `POST /api/base-list/adopt` and `GET /api/base-list/status`. Admin and manager only. The organization and tier come from the session. One set-based `INSERT ... SELECT` with brand creation and linking, the skip and limit counts, an idempotent re-run, a refusal when the supplier differs from the recorded one, and a refusal when over plan. Route wiring in `workers/src/index-minimal.ts`; types in `shared/`.
      Demo: against a seeded test database, a Free org adopts with Sigma and gets only rank 1-500 rows that have a Sigma SKU, and the response reports the skipped counts.
      Acceptance: pglite tests (`npm run test:db`) cover the tier cut-off, missing-supplier skip, limit reached at 480 existing, barcode and SKU conflict with an own product, idempotent re-run, team-member refusal, payload organization ignored, and tenant isolation (mutation-verified). `(cd workers && npm run typecheck)` passes.
- [ ] 2.2 First-run choice UI. For an admin with zero products, show "Use the base list" or "Upload my own". The base-list path has a supplier picker (API, Sigma, CH2) and a pre-import summary, then calls adopt. The upload path routes to the existing upload page. The same actions are reachable from the products page.
      Demo: a new organization chooses the base list and lands on a populated products page; choosing upload opens the existing flow.
      Acceptance: `npm run test:frontend:diff` passes with component tests for both branches and for the error and over-plan states; `npm run lint` is clean.

## 3. Top-up and price sync

- [ ] 3.1 Worker handlers `POST /api/base-list/top-up` and `POST /api/base-list/sync`. Top-up works for stores that began with their own list, and records the supplier when none is set. Sync updates only untouched prices against the imported snapshot and reports updated, edited-skipped and retired counts. `status` reports "new prices available".
      Demo: after a seeder refresh that raises one cost, status reports one change, sync updates an untouched product and skips an edited one.
      Acceptance: pglite tests cover upgrade top-up (ranks 501-5,000, first 500 unchanged), an own-list store topping up, an untouched price following the list, an edited price kept, a retired entry left alone, a blocked-while-over-plan refusal, and tenant isolation (mutation-verified).
- [ ] 3.2 UI for top-up and "new prices available" on the products page, with the sync result summary.
      Demo: the banner appears when prices differ and clears after sync.
      Acceptance: `npm run test:frontend:diff` passes with a component test per state.

## 4. Downgrade freeze

- [ ] 4.1 Lock reconcile function (design decision 5), called from the tier-change path in `workers/src/stripe/stripe-persistence.ts`, after adopt, top-up and sync, and lazily from `GET /api/base-list/status`. Own products are never locked, and locks clear when under the limit.
      Demo: downgrading a Professional org holding 20,000 list products to Free leaves 500 unlocked and the rest locked, and nothing is deleted.
      Acceptance: pglite tests cover the downgrade lock count and rank order, own products never locked, upgrade clearing locks, own products alone over the limit, and a missed-webhook recovery through the status read.
- [ ] 4.2 Exclude locked products from product search, barcode lookup for the add-expiry flow and the product list, while existing `inventory_items` still resolve. First enumerate every product read path the add-expiry flow uses and record the list in the task's PR description. Add an over-plan banner that explains the freeze and the options (upgrade or delete down).
      Demo: a locked product cannot be found when adding an expiry, but its existing expiries are still listed.
      Acceptance: a pglite or handler test per read path (mutation-verified by removing the lock predicate), plus a test that expiries on locked products stay visible; `npm run test:frontend:diff` passes for the banner.

## 5. Store-area starter set

- [ ] 5.1 Worker handlers `GET /api/store-areas/department-templates` and `POST /api/store-areas/from-templates`. The GET lists departments within the tier allowance with counts. The POST creates top-level departments, trimming names and rejecting blanks and over-long names, skipping case-insensitive duplicates, and returning created and skipped lists. Admin and manager only.
      Demo: confirming a three-name selection creates three departments, and confirming it again creates none and reports three skipped.
      Acceptance: pglite tests cover the tier-scoped department list, duplicate skipping that ignores case and whitespace, a repeated confirm being a no-op, team-member refusal, and tenant isolation (mutation-verified). Departments appear with `parent_id` NULL.
- [ ] 5.2 Store-areas page dialog "Start from base list departments": an editable checklist (rename, untick, add), then confirm, then the existing department and bay UI continues as normal.
      Demo: renaming "Cold and flu" and confirming creates it as a department, and a bay is then added with the existing bay form.
      Acceptance: `npm run test:frontend:diff` passes with component tests for rename, untick, add and skipped-name reporting; `npm run lint` is clean.

## 6. Close-out

- [ ] 6.1 End-to-end check on a scratch Neon branch: publish a sample ranked sheet, adopt on Free, upgrade and top up, downgrade and see the freeze, sync after a price refresh, and create areas. Document the owner's quarterly refresh runbook in `docs/` (CLI commands, dry-run, the production-confirmation guard) and add a user-facing note for the first-run choice.
      Demo: the full journey runs on the scratch branch with no manual database edits.
      Acceptance: the run log is attached to the PR; `npm run test:migrations`, `npm run test:db`, `npm run test:operations`, `(cd workers && npm run typecheck)` and `npm run lint` pass. No production data is touched.
