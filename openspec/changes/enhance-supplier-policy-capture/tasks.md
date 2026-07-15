# Tasks: Richer supplier policy capture, admin-gated editing & review views

## 1. Shared domain

- [x] 1.1 Add `shared/domain/supplier-policy.ts`: `hasPolicy(supplier)`,
      `brandPolicyStatus(brand, resolvedSupplier)`, `isPolicyWrite(payload, existing)`,
      `validatePolicyWrite(payload, existing)`.
- [x] 1.2 Unit tests: attached / missing / whitespace-only instructions; policy-write detection
      (unchanged note ≠ policy write); validation pass/fail on each contact-method combination.

## 2. Schema (triplicated — golden rule 6)

- [x] 2.1 Prisma: add `representativeName`, `representativeEmail`, `contactPhone`, `policyUpdatedAt`
      (all nullable) to `model Supplier` in `backend/prisma/schema.prisma`.
- [x] 2.2 Neon SQL: `backend/prisma/neon-sql/0007_add_supplier_policy_fields.sql` + rollback.
- [x] 2.3 Register SQLite migration `017-add-supplier-policy-fields` in
      `backend/src/migrations/migration.service.ts`, with conditional `updatedAt` backfill.
- [x] 2.4 pglite harness + `workers/src/database.ts` supplier shape updated for the new columns.
- [x] 2.5 Dual-backend conformance test for `brandPolicyStatus` / `hasPolicy` (Neon/pglite vs SQLite,
      including row order and org isolation).

## 3. Backend (Express)

- [x] 3.1 Extend `SupplierInput` (repository/types) and `createSupplier` / `updateSupplier` to carry
      the new fields.
- [x] 3.2 Add create and merge-update normalization paths; preserve full `PUT` and add partial `PATCH`.
- [x] 3.3 Apply `validatePolicyWrite` server-side using a structured `PolicyValidationError` (422);
      perform normalized diff, canonical-role authorization, validation, and write transactionally.
- [x] 3.4 Stamp `policyUpdatedAt` only when a normalized policy field value actually changes; add an
      admin-only clear-policy operation that preserves contact fields and resets cadence to 7.
- [x] 3.5 Policy-review read endpoint (brands + resolved supplier + policy status + `policyUpdatedAt`
      + representative) with brand/supplier/status filters and oldest-first sort.
- [x] 3.6 Bulk-attach-policy endpoint (admin): confirm one supplier across many brands in one
      transaction, emitting `SUPPLIER_OVERRIDE` corrections (reuse #358 `confirmBrandSupplier`).
- [x] 3.7 Bulk-link-SKUs endpoint: upsert brand + link many products in one transaction, emitting one
      `BRAND_ADDED` correction per SKU (reuse #358 `addBrand`).
- [x] 3.8 Enforce 1–500 raw positive IDs before deduplication. Return `{ attached, unchanged,
      corrections }` and `{ brandId, linked, alreadyLinked, corrections }`; reject a different-brand
      SKU with `409` and roll back everything.

## 4. Workers (parity)

- [x] 4.1 Parity handlers + routes for extended supplier create/update (validation + admin gate),
      policy-review read, bulk-attach, bulk-link.
- [x] 4.2 SQL policy status (`length(trim(credit_policy_note)) > 0`) checked against the shared helper
      via the contract test from 2.5.

## 5. Frontend

- [ ] 5.1 Add `react-markdown` and `remark-breaks` (raw HTML disabled — no `rehype-raw`) restricted to
      paragraphs, line breaks, bullet/ordered lists, and bold/italic; wrap it in a reusable
      `PolicyMarkdown` component used by both the dialogue preview and the dashboard row expansion.
- [ ] 5.2 Enrich the add/edit supplier dialogue (`AssignSupplierModal` + edit mode): Store Instructions
      textarea with markdown preview toggle, representative name/email, contact phone; render
      instructions read-only (preview-only) for non-admins; mirror policy validation inline.
- [ ] 5.3 Supplier Policy Review Dashboard tab: brand rows (supplier, status, last updated, rep),
      filters (brand/supplier/status), oldest-first sort, admin bulk-attach action.
- [ ] 5.4 Extend `CatalogueReviewPanel` with the SKU matching mode: SKU/product/brand/policy/last-updated
      columns, unmatched red-highlight, group-by-brand, single manual link, and bulk-link selection.
- [ ] 5.5 Service methods in `supplierCreditService.ts` for the new endpoints.

## 6. Tests

- [x] 6.1 Shared-domain units (task 1.2).
- [x] 6.2 Dual-backend conformance (task 2.5).
- [x] 6.3 Backend + worker route tests, including edge cases:
      - policy validation 422: instructions without any contact method; whitespace-only instructions
        treated as empty.
      - `isPolicyWrite` edges: payload with `creditPolicyNote` **unchanged** does not gate/bump;
        `contactPhone`-only change is neither gated nor a bump but satisfies the contact rule.
      - admin gating: changed policy returns 403 for non-admins; unchanged normalized policy is open,
        does not validate, and does not bump; bare-supplier create by non-admin succeeds.
      - `policyUpdatedAt` bump-vs-no-bump.
      - bulk-attach: success + corrections; 422 for policy-less supplier; atomic (no partial attach).
      - bulk-link: success + one correction per SKU; already-linked reported as skipped (not failed);
        oversized request rejected 422; org-scoping.
- [ ] 6.4 Frontend tests: dialogue validation (inline field errors, 422) vs admin-gating read-only
      (403 → permission notice, not input error); markdown preview renders lists and **strips/ignores
      raw HTML** (e.g. a `<script>`/`<img onerror>` in instructions is not executed); dashboard
      filters/sort/bulk-attach picker disabled for policy-less supplier; matching view unmatched
      highlighting, bulk-link selection cap, and skipped-already-linked summary.

## 7. Completion

- [ ] 7.1 `rtk lint` on affected packages.
- [ ] 7.2 Affected tests: `rtk vitest run` (frontend/backend), `npm run test:db`, worker conformance.
- [ ] 7.3 `rtk tsc` across affected packages.
- [ ] 7.4 `npx openspec validate enhance-supplier-policy-capture --strict`.
