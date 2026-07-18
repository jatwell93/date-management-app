# Proposal: User-configurable markdown matrix (per-org percentages + cost/retail basis)

## Why

The reduced price of marked-down stock is hardcoded for every organization: a fixed
50 / 60 / 75%-off ladder applied to **cost price** only, defined in
`shared/domain/markdown.ts` (`MARKDOWN_DISCOUNT_PERCENTAGES`) and consumed by the frontend
calculator, the backend inventory helper, and the reports.

Stores manage markdowns differently. Issue #338 asks for a system where each org sets its **own**
markdown bands, computed off **either retail or cost** price — e.g. "50% off retail in band 1,
75% off in band 2, 90% off in band 3". Two things block this today:

1. **No per-org config.** The percentages are module constants; there is nowhere to store an
   organization's chosen matrix.
2. **Retail price is not stored.** `Product` has only `costPrice`. The catalogue parser
   (`workers/src/upload/catalogue-parser.ts:13-24`) actively *aliases* `retailprice` and
   `sellingprice` columns **into** `costPrice`, so retail is silently collapsed into cost and cannot
   be a distinct basis.

## Scope (v1)

- Keep **exactly 3 markdown bands** (issue: "keep the markdown bands at 3 for v1").
- Keep the existing **day windows** (61-90 / 31-60 / 0-30 days → band 1/2/3). This change touches the
  discount *percentage* and the *basis*, not the day-to-band mapping.
- Each band is configurable: a percentage (0-100) and a basis (`cost` or `retail`).
- **Recompute live** — reports and calculators always reflect the org's current matrix. We do not
  snapshot resolved prices onto rows in v1 (deferred below).
- Retail basis is only offered once the org has uploaded retail data; otherwise the UI is reduced to
  cost only (issue requirement).

## Analysis

**Where the hardcoded ladder is consumed:**
- `shared/domain/markdown.ts` — `MARKDOWN_DISCOUNT_PERCENTAGES` (50/60/75) and
  `calculateMarkdownPriceFromCost`.
- `backend/src/services/inventory-markdown.helpers.ts:58` `calculateInventoryMarkdownPrice`.
- `frontend/src/components/MarkdownCalculator.tsx:139-151` — **re-implements** the day→band ladder
  and calls `calculateMarkdownPrice` from `frontend/src/lib/utils.ts`.
- Reports (`backend/src/repositories/report.repository.ts`) use `MARKDOWN_WINDOWS` for **band
  counts** (day windows only) — those are unaffected. Only paths that compute a **reduced dollar
  price** need the org matrix.

**Config home.** Per the multi-tenant golden rules (org-scoped, `organizationId` from auth only,
cascade delete), the matrix belongs in a new org-scoped table `OrganizationMarkdownConfig`
(1 row per org), not a JSON blob on `Organization`. Defaults preserve today's behavior
(50/60/75% off cost) so existing orgs see **zero change** until they edit their matrix.

**Retail storage.** Add a nullable `retailPrice` to `Product` and split the parser's `retail`
aliases out of the `cost` list. Products without retail keep working on cost.

## Reuse Strategy

- **Extend the shared domain, don't fork it.** Add a `MarkdownMatrixConfig` type and a
  `DEFAULT_MARKDOWN_MATRIX` (= current 50/60/75 cost) to `shared/domain/markdown.ts`, and make the
  price functions accept an optional config that defaults to the constant. Every existing caller that
  passes no config keeps its current behavior — this is a backwards-compatible signature widening,
  the same pattern used by `reconcile-markdown-price-multipliers`.
- **One resolver for the price.** A single `calculateMarkdownPrice({ costPrice, retailPrice }, daysToExpiry, config)`
  selects the basis per band and falls back to cost when a product has no retail — used by the
  backend helper, the frontend calculator, and any report price path, so both backends stay in
  parity (conformance test required by golden rule 5).
- **Kill the duplicated ladder** in `MarkdownCalculator.tsx` — route it through the shared function
  instead of its inline 30/60/90 branches.
- **Schema stays triplicated** (golden rule 6): Prisma schema, hand-written Neon SQL (+ rollback),
  and the runtime SQLite migration all add `retail_price` and the `organization_markdown_config`
  table.

## Guardrails

- Percentages validated `0 ≤ p ≤ 100`.
- Bands must be **non-decreasing** (band1 ≤ band2 ≤ band3 discount): the issue's own example
  (50→75→90) is monotonic and it prevents a nearer-expiry band being *less* discounted than a
  further one. Surfaced as a validation error, not a silent clamp.
- A band may only be set to `retail` basis when the org has at least one product with a retail price
  (cheap `COUNT`). Independently, at compute time a product missing retail on a retail-basis band
  falls back to its cost so no item is left unpriced.
- Config endpoints are org-scoped and admin-gated per the existing RBAC; `organizationId` is derived
  from auth, never from the client payload (golden rule 1).

## Deferred Follow-up

- **Historical accuracy (snapshotting).** v1 recomputes live, so editing the matrix moves past
  reduced prices. A v2 can snapshot the resolved price alongside the existing `markdown_level` column
  on item transactions for frozen history.
- **Configurable day windows** (band boundaries) and **more than 3 bands** are explicitly out of
  scope for v1.

## Implementation Steps

1. Shared domain: add `MarkdownBasis`, `MarkdownMatrixConfig`, `DEFAULT_MARKDOWN_MATRIX`, and widen
   the price functions to take an optional config with a single per-item resolver + cost fallback.
2. Schema (triplicated): `Product.retailPrice` (nullable) and `OrganizationMarkdownConfig` table.
3. Parser: split `retail` aliases out of `cost`; persist `retailPrice`; keep cost-only uploads valid.
4. Backend: config repository/service (load-with-default, upsert), validation schema, admin-gated
   GET/PUT routes, and a `hasRetailData` flag; wire org config into the inventory helper and report
   price paths.
5. Frontend: settings section (3 rows: percentage + cost/retail toggle, retail disabled until the org
   has retail data), consume config in the calculator/scan/report views, remove the duplicated ladder.
6. Tests: shared-domain unit tests (per-band basis, fallback, monotonic validation), dual-backend
   conformance for the resolved price, backend route/validation tests, frontend settings + calculator
   tests.
7. Completion checks: backend + frontend lint, affected tests, `tsc`, and
   `npx openspec validate add-user-configurable-markdown-matrix --strict`.
