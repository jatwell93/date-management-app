# Design: User-configurable markdown matrix

## Data model

### `OrganizationMarkdownConfig` (new, org-scoped 1:1)

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid / autoincrement | PK |
| `organization_id` | string | unique, FK → Organization, `onDelete: CASCADE` |
| `band1_percentage` | Float | 0-100, default 50 |
| `band2_percentage` | Float | 0-100, default 60 |
| `band3_percentage` | Float | 0-100, default 75 |
| `band1_basis` | String | `cost` \| `retail`, default `cost` |
| `band2_basis` | String | `cost` \| `retail`, default `cost` |
| `band3_basis` | String | `cost` \| `retail`, default `cost` |
| `created_at` / `updated_at` | DateTime | standard |

SQLite has no enum, so basis is a `String` constrained in the app layer (Zod) and echoed in the
Neon SQL as a `CHECK (band1_basis IN ('cost','retail'))`. Defaults reproduce today's ladder so an org
that never opens settings is unaffected.

**Why a table over a JSON column on `Organization`:** stronger validation, easy defaulting via a
`load-or-default` read, and it keeps `Organization` a pure identity row (matches how
`OrganizationUsage` is split out).

### `Product.retailPrice` (new, nullable)

`retail_price Float?` — nullable so existing cost-only catalogues remain valid. Triplicated across
Prisma schema, Neon SQL (+ rollback), and the SQLite migration.

## Shared domain (`shared/domain/markdown.ts`)

```ts
export type MarkdownBasis = 'cost' | 'retail';

export interface MarkdownBandConfig { percentage: number; basis: MarkdownBasis; }

export interface MarkdownMatrixConfig {
  band1: MarkdownBandConfig; // 61-90 days
  band2: MarkdownBandConfig; // 31-60 days
  band3: MarkdownBandConfig; // 0-30 days
}

export const DEFAULT_MARKDOWN_MATRIX: MarkdownMatrixConfig = {
  band1: { percentage: 50, basis: 'cost' },
  band2: { percentage: 60, basis: 'cost' },
  band3: { percentage: 75, basis: 'cost' },
};

export interface MarkdownableItem { costPrice: number; retailPrice?: number | null; }

// Single resolver used by every price path (backend helper, frontend calculator, reports).
export function calculateMarkdownPrice(
  item: MarkdownableItem,
  daysToExpiry: number | null,
  config: MarkdownMatrixConfig = DEFAULT_MARKDOWN_MATRIX,
): number | null;
```

- Band selection reuses the existing `MARKDOWN_WINDOWS` day mapping unchanged.
- Basis selection: `retail` uses `retailPrice` when finite, else **falls back to `costPrice`** so no
  item is left unpriced.
- Existing exports (`MARKDOWN_DISCOUNT_PERCENTAGES`, `calculateMarkdownPriceFromCost`) are kept as
  thin wrappers over `DEFAULT_MARKDOWN_MATRIX` for back-compat; no caller breaks.

## Backend wiring

- `MarkdownConfigRepository` / `MarkdownConfigService`: `getForOrg(orgId)` returns the stored row or
  `DEFAULT_MARKDOWN_MATRIX`; `upsertForOrg(orgId, input)`.
- `hasRetailData(orgId)`: `COUNT(*) FROM products WHERE organization_id = ? AND retail_price IS NOT NULL > 0`.
- Routes (admin-gated, org from auth): `GET /markdown-config`, `PUT /markdown-config`.
- Wire `getForOrg` into `calculateInventoryMarkdownPrice` and any report price path so a per-request
  org matrix is threaded in. Reports compute the resolved price per item in JS after the SQL band
  bucketing (unchanged), keeping SQL portable across pglite/SQLite.

## Validation (Zod)

- `percentage`: number, `0 ≤ p ≤ 100`.
- `basis`: `enum(['cost','retail'])`.
- Non-decreasing discount across bands 1→2→3.
- `basis: 'retail'` rejected when `hasRetailData(orgId)` is false, with a message pointing to retail
  upload. (Per-item cost fallback still applies for individual products missing retail.)

## Frontend

- Settings section: three rows, each a percentage input + a cost/retail segmented toggle. The retail
  option is disabled with a tooltip ("Upload retail prices to enable retail-based markdowns") when
  `hasRetailData` is false.
- Calculator/scan/report views fetch the org matrix (React Query, key includes `orgId` per
  conventions) and pass it to the shared resolver. Remove the inline ladder in
  `MarkdownCalculator.tsx`.

## Dual-backend parity

Golden rule 5: add a conformance test asserting `calculateMarkdownPrice` yields identical resolved
prices for the same item + matrix across the pglite/PostgreSQL and SQLite report paths, including the
retail-fallback case.

## Rejected alternatives

- **JSON column on `Organization`** — weaker validation, awkward defaulting.
- **Snapshot resolved price at markdown time (frozen history)** — deferred to v2; v1 recomputes live
  per the chosen scope.
- **Import `shared/domain` directly into the CRA frontend** — historically blocked by the CRA/CRACO
  build (see `reconcile-markdown-price-multipliers` follow-up); continue via the existing
  `frontend/src/lib/utils.ts` seam / packaged shared pricing.
