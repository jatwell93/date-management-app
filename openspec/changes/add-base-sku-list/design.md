# Design

## Context

See `proposal.md` for motivation. Current state that shapes the approach:

- `master_catalogue_entries` (migration `0006`, `retired_at` from `0009`) is global, keyed by unique `barcode`. It has `api_sku`, `sigma_sku`, `ch2_sku`, `category`, `sub_category`, `rrp` and `metro_price`. `src/operations/master-catalogue-seed.ts` upserts it from a workbook (`npm run seed:master-catalogue`). It reads headers by exact name: `API PDE`, `Sigma PDE`, `CH2 PDE`, `Category`, `Sub-Category`, `RRP $`, `Metro $`. It retires rows the sheet drops, refuses runs over a retire or blank threshold, supports `dryRun`, and logs a `catalogue_seed_runs` row.
- `products` has `organization_id`, `barcode`, `sku` (NOT NULL), `name` and `cost_price`. It has unique indexes on `(organization_id, sku)` and `(organization_id, barcode)`. It also has a nullable `retail_price` (migration `0003`, used by the markdown matrix); this change reuses it and neither adds nor drops it.
- SKU caps are enforced by counting live rows (`workers/src/utils/usage-limits.ts`, `LAUNCH_TIER_LIMITS`: 500 / 5,000 / 50,000 / 250,000). A usage counter was tried and abandoned because it failed open. This design follows the counting rule.
- `store_areas` is a two-level hierarchy: `parent_id` NULL is a department, set is a bay. Inventory references the bay. The unique index on `(organization_id, name, sub_department)` does not stop duplicates when `sub_department` is NULL (known gap), so duplicate handling must be explicit.
- Only `workers/src/index-minimal.ts` is deployed. Uploads are limited to admin and manager. Organization identity comes from the authenticated `users` row.

## Goals / Non-Goals

**Goals:**

- Stores prefill a tier-sized catalogue in one request, safely and repeatably.
- The owner refreshes prices every quarter from one sheet with the existing safety rails.
- No tier change can leave a free store using a 50,000-SKU catalogue, and none deletes data.

**Non-Goals:**

- A Worker upload endpoint or any owner UI. The CLI is the owner's tool.
- Price history, per-store price lists, or automatic price pushes.
- Changing how existing import enrichment matches. The legacy sheet layout keeps working.
- Linking products to store areas. Products have no area link today, and this change does not add one.

## Decisions

### 1. Extend the master catalogue; one ranked list, not three CSVs

Add `cost_price` and `base_rank` (nullable; indexed where not null but not unique, see below) to `master_catalogue_entries`. Retail price reuses the existing `rrp`. A tier's allowance is `base_rank <= limit`, computed on the server. This keeps one source of truth and means Free is always a strict subset of Starter and Professional.

*Rejected:*
- Three tier tables or CSVs would drift (an item on Free but not on Starter).
- A separate starter table would duplicate barcodes and SKUs and split enrichment from pricing.

### 2. The sheet's new columns are read next to the legacy ones

New headers `Department`, `Cost $` and `Base Rank` are optional. `Category` in the new layout means the second level. The two layouts collide on the word "Category", so the seeder picks the layout by whether a `Department` header exists:

| | `Department` present (new) | `Department` absent (legacy) |
|---|---|---|
| `Department` | stored in `category` | not read |
| `Category` | stored in `sub_category` | stored in `category` |
| `Sub-Category` | ignored | stored in `sub_category` |

DB columns are not renamed. This avoids the six-artifact migration blast radius and leaves import enrichment untouched. The mismatch (DB `category` means department) is documented in the migration comment and the sheet-format doc.

New validation: `Base Rank` must be a positive integer, unique across the whole sheet (checked by the seeder before any write, not by a database unique index: the seeder upserts in batches of 1,000, so a rank swap would trip an immediate unique constraint mid-run), `Cost $` must be a non-negative price, and a ranked row needs `Cost $` and `RRP $`. Retiring an entry also clears its `base_rank`, so a retired row never holds a rank another row reuses. Ties, if any slip through, break by `id` in every ordering. Ranked rows are included in the existing blank-value guard, so a refresh that wipes prices is refused.

*Rejected:* renaming the columns, which touches every reader, test, manifest and fingerprint for no behaviour change.

### 3. Adoption is one set-based SQL statement, not a row loop

Adoption and top-up run as a single `INSERT INTO products ... SELECT ... FROM master_catalogue_entries` in the Worker. They filter `retired_at IS NULL`, `base_rank IS NOT NULL`, `base_rank <= tierLimit` and the chosen supplier's SKU `IS NOT NULL`. They exclude rows the organization already holds by barcode or SKU. Rows are ordered by `base_rank`, with `LIMIT` set to the limit minus the live product count, and `ON CONFLICT DO NOTHING` covers both unique indexes. Nothing is streamed through the Worker, so there are no 50,000-row CPU or subrequest problems. The statement is idempotent.

Brands: the same request first inserts the org's missing brands from the selected entries' `brand_name`, with `source = 'REFERENCE'` (the existing catalogue-derived value allowed by the `brands` check constraint from `0006`), then links `products.brand_id`. This mirrors what enrichment does today, and it creates no tenant Supplier (the `brand-supplier-mapping` rule stays).

Skipped counts come from a second COUNT: allowed rows lacking the chosen supplier SKU, and allowed rows not imported because the limit was reached.

Each imported product records its source: `catalogue_entry_id` (FK, `ON DELETE SET NULL`), plus the imported `base_list_cost_price` and `base_list_retail_price`. Own uploads leave these NULL.

The organization row records `base_list_supplier` (CHECK in `API`, `SIGMA`, `CH2`) and `base_list_adopted_at`. Changing the supplier later is out of scope. Re-running with a different supplier is refused with a clear error.

### 4. Price sync compares against the imported snapshot

A product is "untouched" when `cost_price IS NOT DISTINCT FROM base_list_cost_price` and `retail_price IS NOT DISTINCT FROM base_list_retail_price`. Sync is one `UPDATE ... FROM master_catalogue_entries` over untouched, linked, active-entry, unlocked products. It sets both live and snapshot values. Edited products are counted as skipped. A product whose entry is retired is left alone and counted as retired.

"New prices available" is the count of untouched or edited linked products whose entry values differ from the snapshot. It is cheap and needs no version column. A cost-edit-only product is skipped as a whole, which is simpler and safer than field-by-field merging.

*Rejected:*
- Auto-overwrite (surprising for the store).
- A `price_edited` flag (needs every write path to maintain it, which is the counter failure again).

### 5. Freeze: derived lock, reconciled on tier change

`products.locked_over_plan boolean NOT NULL DEFAULT false`. A reconcile function runs in one transaction. It computes `excess = liveProducts - tierLimit`. If `excess <= 0` it clears all locks. Otherwise it locks the `excess` highest-`base_rank` products that have a `catalogue_entry_id` and clears the rest. Own products are never candidates.

It is called:
- from the tier-change path (the Stripe persistence step that already writes new limits),
- after any adopt, top-up or sync (a no-op when under limit),
- lazily when the base-list status endpoint is read, as a safety net for missed webhooks.

If own products alone exceed the limit, nothing more can be locked. The org stays "over plan", the growth actions stay blocked, and the UI says so. This matches the existing import rules and never deletes data.

Locked products are excluded from product search and barcode lookup used by the add-expiry flow, and from the product list. Existing `inventory_items` joins are not filtered, so expiries on locked products stay visible and unchanged (spec: "Existing expiries survive a lock").

*Rejected:*
- Filtering by `rank <= limit` at read time. Re-ranking each quarter would silently unlock or lock different products.
- Blocking the downgrade (needs Stripe coordination and is harsh on the customer).

### 6. Store-area templates

`GET /api/store-areas/department-templates` returns `SELECT category, count(*) FROM master_catalogue_entries WHERE retired_at IS NULL AND base_rank <= :limit AND category IS NOT NULL GROUP BY category`. `POST` accepts `{ names: string[] }` and inserts departments (`parent_id` NULL) with `INSERT ... SELECT ... WHERE NOT EXISTS`. It compares `lower(trim(name))` among that org's departments, so the known NULL-`sub_department` unique gap is handled explicitly. It trims names, caps their length, rejects blanks, and returns created and skipped lists. Bays are not created. Admin and manager only. The organization comes from the session. There is no new table.

Concurrency: two simultaneous confirms could both pass `NOT EXISTS`. The impact is a duplicate department, which the store can delete. A partial unique index on `(organization_id, lower(name)) WHERE parent_id IS NULL` is out of scope (existing duplicate data may block it). It is recorded as a follow-up.

### 7. First-run choice lives in the app, not in Clerk signup

The choice appears as a first-run step for an admin whose organization has zero products: "Use the base list" or "Upload my own". The base-list path shows a three-option supplier picker (API, Sigma, CH2) and a summary of what will be imported. The upload path routes to the existing upload page. The same actions stay reachable from the products page afterwards, which covers top-up and existing stores. The store-areas page gets a "Start from base list departments" button that opens the editable checklist.

### 8. Operator workflow stays a CLI

The quarterly flow is: edit the sheet, run `npm run seed:master-catalogue` with `--dry-run`, read the diff, then run it live against Neon (Doppler, with the existing production confirmation guard). This reuses the retire and blank thresholds, validation, and the `catalogue_seed_runs` audit row. It adds no public surface. If a terminal stops being convenient, a gated Worker endpoint can be added later without changing the data model.

## Risks / Trade-offs

- **[Prefill shows catalogue prices as the store's own prices]** → Prices are labelled as list prices in the adoption summary, and sync never overwrites edits.
- **[Bad cost or retail data published to all new stores]** → The dry-run diff and blank guard apply, and `Cost $` and `RRP $` are required for ranked rows.
- **[Missed tier-change webhook leaves locks stale]** → The lazy reconcile on status read and the post-action reconcile cover this.
- **[Trial or Professional-trial stores import 50,000 and then fall to Free]** → This is exactly the freeze case, and the lock reconcile handles it.
- **[Locked-product filtering misses a read path]** → A task enumerates every product read the add-expiry flow uses, with a test per path. Reports deliberately still include locked products' existing expiries.
- **[Supplier SKU collisions between entries]** → `ON CONFLICT DO NOTHING` keeps the lower-rank entry, and the skipped count reports the rest.
- **[Duplicate departments under concurrent confirms]** → Accepted and documented (decision 6).

## Migration Plan

One additive migration `0021_add_base_sku_list` (`.up.sql` and `.down.sql`):

- Adds nullable columns and the CHECK constraints listed in the proposal Impact.
- Adds a non-unique partial index on `master_catalogue_entries(base_rank) WHERE base_rank IS NOT NULL AND retired_at IS NULL`.
- Adds an index on `products(organization_id, locked_over_plan)` and one on `products(catalogue_entry_id)`.
- Makes no existing row change, so deploy needs no data backfill.

Rollout steps:

- Update `database/migrations/manifest.json`, `catalog-fingerprint.json` and the prod-schema artifact. Add the three id lists from the migration checklist. `npm run test:migrations` must pass.
- Deploy the Worker. All new routes are inert until the owner publishes a ranked sheet.
- Run the seeder dry-run on the real sheet, then live. Production writes follow the existing guard and need explicit confirmation.

Rollback: the down migration drops the added columns and indexes. Products created by adoption remain as ordinary products because the source columns are nullable.

## Open Questions

- Resolved: the base list carries its own `Cost $` column and `Metro $` keeps its current meaning.
- Should the department-template button also be hidden for stores that already have many departments? This is a UI nicety and can be decided during implementation.
