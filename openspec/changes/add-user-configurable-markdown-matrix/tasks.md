## Tasks

### Shared domain
- [x] Add `MarkdownBasis`, `MarkdownBandConfig`, `MarkdownMatrixConfig`, `MarkdownableItem`, and `DEFAULT_MARKDOWN_MATRIX` (= 50/60/75 cost) to `shared/domain/markdown.ts`.
- [x] Add `calculateMarkdownPrice(item, daysToExpiry, config = DEFAULT_MARKDOWN_MATRIX)` with per-band basis selection and cost fallback when `retailPrice` is missing.
- [x] Keep `MARKDOWN_DISCOUNT_PERCENTAGES` / `calculateMarkdownPriceFromCost` as back-compat wrappers over the default matrix.
- [x] Unit tests: each band's percentage + basis, retail→cost fallback, day-window boundaries (90/60/30), expired (`<= 0` days) returns null. (`backend/src/tests/unit/markdown-matrix.test.ts`)

### Schema (triplicated — golden rule 6)
- [x] Prisma: add `Product.retailPrice Float? @map("retail_price")` and new `OrganizationMarkdownConfig` model (org-scoped, unique `organizationId`, cascade delete, band percentages + basis, defaults). Base + production schemas.
- [x] Neon SQL: forward + rollback migrations (`0003_add_configurable_markdown_matrix.sql` + rollback) with `CHECK (… IN ('cost','retail'))` and percentage-range checks.
- [x] Runtime SQLite migrations (`010` retail_price, `011` organization_markdown_config) added inline to `migration.service.ts`.
- [x] pglite test harness updated (`workers/src/__tests__/pglite-db.ts`) for parity.

### CSV / catalogue parser
- [x] Split a `retail` alias group (`retailprice`, `sellingprice`, `sellprice`, `rrp`, `saleprice`) out of the `cost` alias list in `workers/src/upload/catalogue-parser.ts`; persist `retailPrice` when present (optional, excluded from required-column check).
- [x] Keep cost-only uploads valid; threaded `retailPrice` through both worker upsert paths (`catalogue-import.ts` bulk + `upload-handlers.ts` per-row). Worker import tests pass.
- [x] Backend Express importer parity: split Retail/Selling Price aliases into optional `retail`, exclude it from required-column checks, and thread `retailPrice` through create/update without clobbering existing retail on cost-only re-imports.

### Backend config service + routes
- [x] `MarkdownConfigRepository` (`findByOrganizationId`, `upsert`, `hasRetailData`) + `MarkdownConfigService` (`getMatrix` row-or-default, `getConfig`, `updateConfig`).
- [x] Zod validation (`markdownConfigSchema`): percentage 0-100, basis enum, non-decreasing bands; service rejects `retail` basis when org has no retail data.
- [x] Admin-gated (`requireManager`), org-from-auth `GET`/`PUT /markdown-config` (controller + routes + mounted in `index.ts`).
- [x] Service unit tests (defaults, mapping, retail-without-data rejection, valid save). (`markdown-config.service.test.ts`)

### Wire org matrix into price paths
- [x] Thread org matrix + retail into `calculateInventoryMarkdownPrice` (now delegates to the shared resolver) and its caller `InventoryService.calculateMarkdownPrice`.
- [x] Expose `retailPrice` on the product read model (`product.model.ts` + `mapPrismaToModel`) so the calculator's retail path has data.
- [~] Reports: band **counts** are day-window based (unchanged); no per-item dollar-price path exists in reports today, so no report price wiring needed for v1. Cost-based "loss" sums intentionally unchanged (see proposal).
- [~] Dual-backend conformance: the resolver is pure shared TS imported by both backends, so parity holds by construction and is covered by `markdown-matrix.test.ts`; the existing SQL band-count conformance harness is unchanged.

### Frontend
- [x] Settings section: 3 rows (percentage input + cost/retail toggle); retail disabled with tooltip until `hasRetailData`; wired to GET/PUT. (`MarkdownMatrixSettings.tsx`, embedded in `SettingsPage.tsx`)
- [x] Consume org matrix in `MarkdownCalculator.tsx` (removed the inline 30/60/90 ladder; now uses shared resolver + retail).
- [x] Frontend tests: settings load/gating/monotonic/save (`MarkdownMatrixSettings.test.tsx`); calculator still green.
- [ ] **DEFERRED**: Scan page + detailed expiry report price displays still use the cost-only `utils.calculateMarkdownPrice`. Wire them to the org matrix in a follow-up.

### Completion checks
- [x] Backend `tsc` clean; frontend `tsc` clean for new files (pre-existing unrelated errors remain).
- [x] Affected backend tests (102) + frontend markdown tests (35) + worker import tests (12) pass.
- [ ] Run full `npm run lint` (backend + frontend) before PR.
- [x] `npx openspec validate add-user-configurable-markdown-matrix --strict` is valid.

## Deferred follow-ups (tracked)
1. Scan page + detailed expiry report price displays consume the org matrix.
2. v2: snapshot resolved markdown price for frozen history; configurable day windows / >3 bands.
