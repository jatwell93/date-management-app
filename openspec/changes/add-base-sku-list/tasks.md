# Tasks: Base SKU list for new stores

Tasks are tracer-bullet slices: each lands its own tests and docs and leaves the app working. Tasks marked `(owner)` need a protected path, production access, a vendor console or data only the owner has; an edit to a protected path goes on its own pull request from the default branch, never on the factory's. Run `npm run test:db`, `npm run test:operations` and `(cd workers && npm run typecheck)` for the packages a task touches. Every new tenant-data query gets a tenant-isolation test (seed a second organization's rows and assert they never appear), mutation-verified by removing the `organization_id` predicate.

## 1. Schema and production readiness

- [ ] 1.1 (owner) Migration `0021_add_base_sku_list` (`.up.sql` and `.down.sql`) (#816): adds `master_catalogue_entries.cost_price` and `base_rank` (non-unique partial index on active ranked rows), `products.catalogue_entry_id` (FK, `ON DELETE SET NULL`), `base_list_cost_price`, `base_list_retail_price` and `locked_over_plan`, and `organizations.base_list_supplier` (CHECK `API`/`SIGMA`/`CH2`) and `base_list_adopted_at`. `products.retail_price` already exists from `0003` and is neither added nor dropped. Update `manifest.json`, `catalog-fingerprint.json`, the prod-schema artifact, the three id lists and the pglite harness schema. This is on `database/migrations/**`, so it goes on its own PR from the default branch.
      Demo: the migration applies and rolls back cleanly on a scratch database.
      Acceptance: `npm run test:migrations` and `npm run test:db` pass; a pglite test shows the down migration restores the prior columns and leaves `retail_price` intact.
- [ ] 1.2 (owner) Apply `0021` to production following `docs/migrations-deploy-runbook.md`, before any Worker task merges (#817): the Worker auto-deploys on merge to the default branch and its new routes read these columns.
      Blocked by: 1.1.
      Demo: the production schema shows the new columns and `0021` is recorded as applied.
      Acceptance: the runbook's post-apply verification passes and the migrations canary stays green.

## 2. The owner's sheet

- [ ] 2.1 Seeder accepts the new layout (#818): extend `src/operations/master-catalogue-seed.ts`, its CLI and tests with `Department`, `Category`, `Cost $` and `Base Rank`, chosen by the presence of a `Department` header (design decision 2). Validate positive integer ranks unique across the whole sheet, non-negative cost, and cost and `RRP $` on ranked rows. Retiring an entry clears its rank. Ranked fields join the blank-value guard and the dry-run diff. Add a sample new-layout workbook fixture and document the columns and the quarterly refresh in `docs/csv-upload-format.md` or a sibling doc.
      Blocked by: 1.1.
      Demo: a dry run on the sample workbook prints added, changed and retired counts, and a legacy workbook still publishes unchanged.
      Acceptance: `npm run test:operations` passes with cases for duplicate rank, missing cost on a ranked row, legacy layout, blank-guard refusal, retirement clearing rank, and a rank swap between two rows in one run.
- [ ] 2.2 (owner) Build the real base sheet (#819): your ranked SKUs with API, Sigma and CH2 codes, cost, RRP, department and category, in the layout the 2.1 doc describes. Only the owner has this data. Keep at least 500 rows so Free is fully served, and aim for the sizes you intend to sell (5,000 and 50,000).
      Blocked by: 2.1.
      Demo: a dry run of the real sheet against a scratch database reports no validation errors.
      Acceptance: the dry-run diff reads as expected and every ranked row has cost and RRP.

## 3. Adopt the base list

- [ ] 3.1 A store adopts the base list (#820): Worker routes `POST /api/base-list/adopt` and `GET /api/base-list/status`, admin and manager only, with the organization and tier from the session. One set-based `INSERT ... SELECT` with brand creation (`source = 'REFERENCE'`) and linking, skip and limit counts, an idempotent re-run, refusal when the supplier differs from the recorded one, and refusal when over plan. Route wiring in `workers/src/index-minimal.ts`; shared types in `shared/`.
      Blocked by: 1.2.
      Demo: against a seeded test database, a Free org adopts with Sigma and gets only the rank 1 to 500 rows that have a Sigma code, with the skipped counts reported.
      Acceptance: pglite tests (`npm run test:db`) cover the tier cut-off, missing-supplier skip, limit reached at 480 existing, barcode and SKU conflict with an own product, idempotent re-run, team-member refusal, payload organization ignored, and tenant isolation (mutation-verified); `(cd workers && npm run typecheck)` passes.
- [ ] 3.2 First-run choice UI (#821): for an admin with zero products, "Use the base list" or "Upload my own". The base-list path has a supplier picker (API, Sigma, CH2) and a pre-import summary, then calls adopt. The upload path routes to the existing upload page. The same actions are reachable from the products page.
      Blocked by: 3.1.
      Demo: a new organization chooses the base list and lands on a populated products page; choosing upload opens the existing flow.
      Acceptance: `npm run test:frontend:diff` passes with component tests for both branches and the error and over-plan states; `npm run lint` is clean.

## 4. Grow and refresh

- [ ] 4.1 Top-up after an upgrade (#822): Worker route `POST /api/base-list/top-up` and a products-page button. It works for stores that began with their own list and records the supplier when none is set.
      Blocked by: 3.1.
      Demo: upgrading a Free store to Starter and topping up adds ranks 501 to 5,000 and leaves the first 500 unchanged.
      Acceptance: pglite tests cover the upgrade top-up, an own-list store topping up, a refusal while over plan, and tenant isolation (mutation-verified); `npm run test:frontend:diff` passes for the button.
- [ ] 4.2 Price sync (#823): Worker route `POST /api/base-list/sync`, "new prices available" in `status`, and a products-page banner with a result summary. Only untouched prices change, judged against the imported snapshot; edited and retired products are counted and left alone.
      Blocked by: 3.1.
      Demo: after a seeder refresh that raises one cost, the banner reports one change, sync updates an untouched product and skips an edited one.
      Acceptance: pglite tests cover an untouched price following the list, an edited price kept, a retired entry left alone, a refusal while over plan, and tenant isolation (mutation-verified); `npm run test:frontend:diff` passes for the banner.

## 5. Downgrade freeze

- [ ] 5.1 Lock reconcile (#824): a function (design decision 5) called from the tier-change path in `workers/src/stripe/stripe-persistence.ts`, after adopt, top-up and sync, and lazily from `GET /api/base-list/status`. Own products are never locked, and locks clear when under the limit.
      Blocked by: 3.1.
      Demo: downgrading a Professional org holding 20,000 list products to Free leaves 500 unlocked and the rest locked, with nothing deleted.
      Acceptance: pglite tests cover the lock count and rank order, own products never locked, upgrade clearing locks, own products alone over the limit, and recovery from a missed webhook through the status read.
- [ ] 5.2 Locked products leave lookup (#825): exclude them from product search, barcode lookup for the add-expiry flow and the product list, while existing `inventory_items` still resolve. First enumerate every product read path the add-expiry flow uses and list it in the PR description. Add an over-plan banner that explains the freeze and the options.
      Blocked by: 5.1.
      Demo: a locked product cannot be found when adding an expiry, but its existing expiries are still listed.
      Acceptance: a pglite or handler test per read path (mutation-verified by removing the lock predicate), a test that expiries on locked products stay visible, and a banner component test under `npm run test:frontend:diff`.

## 6. Store-area starter set

- [ ] 6.1 Store-area starter set (#826): Worker routes `GET /api/store-areas/department-templates` (departments within the tier allowance, with counts) and `POST /api/store-areas/from-templates` (creates top-level departments, trims names, rejects blank and over-long names, skips case-insensitive duplicates, returns created and skipped lists), plus an editable checklist dialog on the store-areas page. Admin and manager only.
      Blocked by: 1.2.
      Demo: renaming "Cold and flu" and confirming creates it as a department, a bay is then added with the existing bay form, and confirming again skips it.
      Acceptance: pglite tests cover the tier-scoped list, duplicate skipping ignoring case and whitespace, a repeated confirm being a no-op, team-member refusal, and tenant isolation (mutation-verified), with `parent_id` NULL on every created row; `npm run test:frontend:diff` passes for rename, untick, add and skipped-name reporting.

## 7. Docs, rehearsal and launch

- [ ] 7.1 Owner runbook (#827): document the quarterly refresh (sheet edit, dry run, reading the diff, live run, the production-confirmation guard) in `docs/`, linked from the sheet-format doc.
      Blocked by: 2.1, 3.2.
      Demo: the documented commands run as written against the sample workbook on a scratch database.
      Acceptance: a reviewer follows the runbook end to end without a gap; `npm run lint` is clean.
- [ ] 7.2 (owner) Store-staff user doc with screenshots (#828): the first-run choice, supplier picker, over-plan banner and store-area starter set, written and captured by the owner.
      Blocked by: 3.2, 6.1.
      Demo: the doc shows each screen as shipped.
      Acceptance: the owner confirms the screenshots match the live app.
- [ ] 7.3 (owner) Scratch-Neon rehearsal plus a Stripe test-mode downgrade check (#829): publish the sample sheet, adopt on Free, upgrade and top up, downgrade through Stripe test mode and watch the freeze, sync after a refresh, and create areas. Attach the run log to the PR.
      Blocked by: 2.1, 3.2, 4.1, 4.2, 5.2, 6.1.
      Demo: the full journey runs with no manual database edits.
      Acceptance: `npm run test:migrations`, `npm run test:db`, `npm run test:operations`, `(cd workers && npm run typecheck)` and `npm run lint` pass, and the Stripe webhook triggers the lock reconcile.
- [ ] 7.4 (owner) Publish the real sheet to production Neon (#830): dry run, read the diff, then a live run under the production-confirmation guard.
      Blocked by: 1.2, 2.2, 7.3.
      Demo: the production catalogue holds the ranked list and `status` reports the expected tier allowances.
      Acceptance: a new Free test organization adopts the list and gets exactly the rank 1 to 500 rows, and no other production data changes.
