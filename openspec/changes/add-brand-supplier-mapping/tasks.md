# Tasks: Brand-mediated supplier mapping & self-improving master catalogue

## 1. Shared domain (parity foundation)

- [ ] 1.1 Add `shared/domain/brand-supplier.ts`: `BrandSource` and `CorrectionKind` const-unions
      (mirroring `shared/domain/disposition.ts`).
- [ ] 1.2 Pure `resolveSupplier(product, brand)` → `product.supplierId ?? brand?.supplierId ?? null`.
- [ ] 1.3 Pure catalogue match helpers `matchByBarcode(entries, barcode)` and
      `matchByWholesalerSku(entries, sku)` (tries API / Sigma / CH2 SKU).
- [ ] 1.4 Unit tests (named edge cases): resolution precedence — override-wins-over-brand,
      brand-default-when-no-override, null-when-neither; matching — barcode hit beats SKU, SKU-fallback
      when barcode absent, barcode-mismatch-but-SKU-hit still matches, no-match → needs-brand;
      collision — same barcode two wholesaler SKUs picks barcode; empty/whitespace barcode is a miss,
      not a false hit.

## 2. Schema (triplicated — golden rule 6)

- [ ] 2.1 Prisma base (`backend/prisma/schema.prisma`): `Brand`, `MasterCatalogueEntry`,
      `CatalogueCorrection`; add `Product.brandId` (nullable) + back-relations. Keep `Product.supplierId`.
- [ ] 2.2 Mirror into `backend/prisma/production/schema.prisma`.
- [ ] 2.3 Neon SQL migration (+ rollback): tables, FKs (cascade on tenant FKs), unique
      `MasterCatalogueEntry.barcode`, unique `(organizationId, name)` on `Brand`, indexes on
      `Product.brandId` and correction `status`.
- [ ] 2.4 Runtime SQLite migration (next number after 015).
- [ ] 2.5 Update pglite harness (`workers/src/__tests__/pglite-db.ts`) with the new tables.
- [ ] 2.6 Dual-backend conformance test: `resolveSupplier` + enrich rollup identical across
      Neon/pglite and SQLite, including row order and org isolation.

## 3. Backend (Express — layered)

- [ ] 3.1 Catalogue enrich step hooked into the existing import pipeline: match by barcode →
      wholesaler-SKU fallback; upsert `Brand (source=REFERENCE)`; set `Product.brandId`; emit
      `UNMATCHED` corrections for misses.
- [ ] 3.2 Brand repository/service/controller/routes: list brands + suggested suppliers; confirm a
      brand→supplier (source → CONFIRMED); add a missing brand (source → USER_ADDED + correction).
- [ ] 3.3 Supplier-override endpoint: set `Product.supplierId`; emit `SUPPLIER_OVERRIDE` correction.
- [ ] 3.4 Correction record + central review read/accept/reject (admin-scoped); acceptance does not
      mutate other orgs.
- [ ] 3.5 Claimable-pool listing consumes `resolveSupplier`; surfaces `pending confirmation` state.
- [ ] 3.6 Routes mounted in `backend/src/index.ts`; controller + service tests (named edge cases):
      org-scoping (org A cannot read org B's brands/corrections); resolution precedence end-to-end;
      correction capture on brand-add and supplier-override; central accept flips status without
      touching a second org's rows; enrich failure on one row does not fail the import batch.

## 4. Workers (parity)

- [ ] 4.1 Parity handlers in `workers/src/database.ts` + routes in `workers/src/index.ts` sharing the
      `shared/domain` resolvers (enrich, brand list/confirm/add, correction record).
- [ ] 4.2 Worker db conformance for `resolveSupplier` + enrich — see 2.6.

## 5. Catalogue seed

- [ ] 5.1 Seed `MasterCatalogueEntry` from the curated sheet (barcode, apiSku, sigmaSku, ch2Sku,
      brand, manufacturer, category, prices). CH2 column tolerated as nullable until data arrives.

## 6. Frontend

- [ ] 6.1 Post-upload **review screen**: matched items grouped by suggested supplier + a "needs brand"
      bucket; complete-onboarding CTA that requires no policy entry.
- [ ] 6.2 Inline brand-add + supplier-confirm from the "needs brand" bucket and per item.
- [ ] 6.3 Just-in-time policy prompt: first time a brand's item enters the claimable pool, confirm
      supplier + capture policy inline.
- [ ] 6.4 Two-CTA disposition on the Supplier Credits triage board: "Begin claim" vs
      "Dispose (auto-flagged) — confirm"; `pending confirmation` badge; never blocks a claim.
- [ ] 6.5 Component tests: review-screen grouping + needs-brand bucket, two-CTA disposition render,
      pending-confirmation badge.

## 7. Completion checks

- [ ] 7.1 Lint clean on all new files (backend + frontend).
- [ ] 7.2 Affected tests pass (shared-domain, conformance, backend, workers, frontend).
- [ ] 7.3 `tsc --noEmit` clean: backend, workers typecheck, frontend (new files).
- [ ] 7.4 `npx openspec validate add-brand-supplier-mapping --strict` passes.
