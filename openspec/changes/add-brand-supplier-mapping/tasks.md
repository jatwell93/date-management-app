# Tasks: Brand-mediated supplier mapping & self-improving master catalogue

## 1. Shared domain (parity foundation)

- [x] 1.1 Add `shared/domain/brand-supplier.ts`: `BrandSource`, `CorrectionKind`, and
      `CorrectionStatus` const-unions
      (mirroring `shared/domain/disposition.ts`).
- [x] 1.2 Pure `resolveSupplier(product, brand)` → `product.supplierId ?? brand?.supplierId ?? null`.
- [x] 1.3 Pure barcode-first catalogue matching with normalized API / Sigma / CH2 SKU fallback;
      ambiguous SKU fallback produces no match.
- [x] 1.4 Unit tests (named edge cases): resolution precedence — override-wins-over-brand,
      brand-default-when-no-override, null-when-neither; matching — barcode hit beats SKU, SKU-fallback
      when barcode absent, barcode-mismatch-but-SKU-hit still matches, no-match → needs-brand;
      collision — same barcode two wholesaler SKUs picks barcode; empty/whitespace barcode is a miss,
      not a false hit.

## 2. Schema (triplicated — golden rule 6)

- [x] 2.1 Prisma base (`backend/prisma/schema.prisma`): `Brand`, `MasterCatalogueEntry`,
      `CatalogueCorrection`; add `Product.brandId` and `ExpiredItemTransaction.creditDisposition`.
      Store `Brand.suggestedSupplierName` separately from confirmed `supplierId`.
- [x] 2.2 Mirror into `backend/prisma/production/schema.prisma`.
- [x] 2.3 Neon SQL migration (+ rollback): tables, FKs (cascade on tenant FKs), unique
      `MasterCatalogueEntry.barcode`, unique `(organizationId, name)` on `Brand`, indexes on
      `Product.brandId` and correction `status`.
- [x] 2.4 Runtime SQLite migration (next number after 015).
- [x] 2.5 Update pglite harness (`workers/src/__tests__/pglite-db.ts`) with the new tables.
- [x] 2.6 Dual-backend conformance tests: shared supplier resolution plus catalogue-match contract
      cases agree across Neon/pglite and SQLite, including row order and org isolation.

## 3. Backend (Express — layered)

- [x] 3.1 Catalogue enrich step hooked into the existing import pipeline: match by barcode →
      wholesaler-SKU fallback; upsert `Brand (source=REFERENCE)`; set `Product.brandId`; emit
      `UNMATCHED` corrections for misses.
- [x] 3.2 Brand repository/service/controller/routes: list brands + suggested suppliers; confirm a
      brand→supplier (source → CONFIRMED); add a missing brand (source → USER_ADDED + correction).
- [x] 3.3 Supplier-override endpoint: set `Product.supplierId`; emit `SUPPLIER_OVERRIDE` correction.
- [x] 3.4 Correction record + central review read/accept/reject protected by fail-closed
      `PLATFORM_ADMIN_USER_IDS`; acceptance only changes correction status.
- [x] 3.5 Claimable-pool listing exposes `NEEDS_BRAND`, `PENDING_CONFIRMATION`, `CLAIMABLE`, and
      `NO_POLICY`; excludes disposed and claimed transactions.
- [x] 3.6 Idempotent dispose endpoint persists `DISPOSED` on an unclaimed expired transaction and
      returns conflict after claim entry.
- [x] 3.7 Routes mounted in `backend/src/index.ts`; controller + service tests (named edge cases):
      org-scoping (org A cannot read org B's brands/corrections); resolution precedence end-to-end;
      correction capture on brand-add and supplier-override; central accept flips status without
      touching a second org's rows; enrich failure on one row does not fail the import batch.

## 4. Workers (parity)

- [x] 4.1 Parity methods in `workers/src/database.ts` + deployed routes in
      `workers/src/index-minimal.ts` conforming to the `shared/domain` contracts (enrich, brand
      list/review/confirm/add, correction review, disposal).
- [x] 4.2 Worker db conformance for `resolveSupplier` + enrich — see 2.6.

## 5. Catalogue seed

- [x] 5.1 Extend the existing seed infrastructure with an explicit workbook path; normalize and
      idempotently upsert by barcode with inserted/updated/skipped/error counts. Use the 100-row
      sample only for tests/development; production requires an explicit full workbook.

## 6. Frontend

- [x] 6.1 Cursor-paginated post-upload **review screen** over the org's current enriched catalogue:
      matched items grouped by suggested supplier + a "needs brand" bucket; complete-setup CTA that
      requires no policy entry.
- [x] 6.2 Inline brand-add + supplier-confirm from the "needs brand" bucket and per item.
- [x] 6.3 Just-in-time policy prompt: first time a brand's item enters the claimable pool, confirm
      supplier + capture policy inline.
- [x] 6.4 Two-CTA disposition on the Supplier Credits triage board: "Begin claim" vs
      "Dispose (auto-flagged) — confirm"; `pending confirmation` badge; never blocks a claim.
- [x] 6.5 Component tests: review-screen grouping + needs-brand bucket, two-CTA disposition render,
      pending-confirmation badge.

## 7. Completion checks

- [x] 7.1 Lint clean on all new files (backend + frontend).
- [x] 7.2 Affected tests pass (shared-domain, conformance, backend, workers, frontend).
- [x] 7.3 `tsc --noEmit` clean: backend, workers typecheck, frontend (new files).
- [x] 7.4 `npx openspec validate add-brand-supplier-mapping --strict` passes.

## 8. Review hardening

- [x] 8.1 Make the shared supplier resolver part of the production claim rollup and cover the
      Express and Worker catalogue match implementations with the same contract cases.
- [x] 8.2 Add best-effort brand enrichment to the layered Express import path, including org-scoped
      brand reuse, ambiguous-SKU handling, unmatched corrections, and per-row failure isolation.
- [x] 8.3 Replace the unsupported barcode-less scenario with the supported no-barcode-match SKU
      fallback and cover it in integration tests.
- [x] 8.4 Separate catalogue-review state from claimability state, validate its strict const-union in
      both backends, and use `CONFIRMED` rather than the policy-dependent term `CLAIMABLE`.
- [x] 8.5 Standardize central correction responses across Express and Worker, including the nested
      organization identity required by central review.
- [x] 8.6 Count unchanged seed rows as skips and changed existing rows as updates.
- [x] 8.7 Make correction acceptance/rejection a terminal transition from `PENDING`, returning a
      conflict for already-reviewed corrections.
