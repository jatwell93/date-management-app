# Proposal

## Why

A new store must upload a POS export (FRED, Z-office, ...) before the app shows anything useful. That is the biggest first-run friction. The owner already maintains a global `master_catalogue_entries` table (barcode, wholesaler SKUs, brand, reference prices) for import enrichment. It can double as a ready-made starter catalogue, with cost and retail prices, sized to each subscription tier. A store can then start working on day one and swap in its own list whenever it likes.

## What Changes

- **Base list (operator side).** Extend the master catalogue with a cost price, a retail price, a department and a single `base_rank`. One ranked list serves all tiers: Free takes ranks 1-500, Starter 1-5,000, Professional 1-50,000. The owner maintains one sheet, not three CSVs. The existing `npm run seed:master-catalogue` seeder gains the new columns. Its dry-run, retire and blank guardrails apply to the quarterly price refresh unchanged.
- **Store adoption.** A new store with an empty catalogue can choose "use the base list" or "upload my own". With the base list it picks one supplier: API, Sigma or CH2, with no custom option. The Worker prefills `products` set-based, with no row-by-row transfer. Each product gets the chosen supplier's SKU, the list cost, the list retail price and the brand link. Rows without that supplier's SKU are skipped and reported. Rows past the tier's SKU limit are never imported.
- **Top-up and price sync.** An admin or manager can top up from the base list after a tier upgrade. They can also apply the owner's quarterly price refresh on demand. Sync only touches prices the store has not edited. Nothing is ever deleted.
- **Downgrade freeze.** If a store holds more SKUs than its tier allows, nothing is deleted. Base-list products past the allowance are locked and hidden from product lookup and new-expiry entry. Adoption, top-up and sync are blocked until the store is back under its limit. Products the store uploaded or edited itself are never locked.
- **Store-area starter set.** A second, optional setup action on the store-areas page offers the list's departments as an editable checklist (rename, untick, add). Confirming it creates top-level department areas. The store then adds bays with the existing bay feature, for example "Cold and flu" then "Bay one".
- **Retail price on products.** The list's retail price lands in the existing `products.retail_price` column (added in `0003`). This change adds no retail column.

## Capabilities

### New Capabilities

- `base-sku-list`: operator publishing of the ranked list, tier-scoped store adoption, top-up, price sync, and the downgrade freeze.
- `store-area-templates`: seeding top-level store areas from the base list's departments, with edit-before-create and duplicate skipping.

### Modified Capabilities

- `brand-supplier-mapping`: the master catalogue requirement changes. Entries also carry cost price, retail price, department and base rank. The sheet's Department/Category headers map onto the existing `category`/`sub_category` columns.

## Impact

- **Schema** (one migration pair, with manifest, fingerprint and prod schema updates).
  - `master_catalogue_entries`: `cost_price`, `base_rank`.
  - `products`: `catalogue_entry_id`, `base_list_cost_price`, `base_list_retail_price`, `locked_over_plan`.
  - `organizations`: `base_list_supplier`, `base_list_adopted_at`.
- **Operator CLI:** `src/operations/master-catalogue-seed.ts` and `seed-master-catalogue-cli.ts`, plus their tests and the sheet format docs.
- **Worker:** new `/api/base-list/*` and `/api/store-areas/department-templates` handlers in `workers/src/`, a lock-reconcile step on tier change (Stripe persistence path), and lock filters on product lookup.
- **Frontend:** a first-run choice step (base list or own upload, then supplier), a store-areas "start from base list departments" dialog, and an over-plan banner.
- **Tenancy:** every new query derives the organization from auth claims. Each new tenant-data query needs a real-SQL isolation test (`npm run test:db`).
- **Out of scope:** a price-history table, a Worker upload endpoint for the owner (CLI only), custom supplier choice, and auto-push of prices to stores.
