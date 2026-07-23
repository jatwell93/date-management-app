# Tasks: Credit-scoped markdown matrices

## 1. Shared domain

- [x] 1.1 `shared/domain/markdown.ts`: add `CREDIT_SCOPES` / `CreditScope`, `MarkdownMatrixSet`,
      `DEFAULT_FULL_CREDIT_MARKDOWN_MATRIX` (20/20/20 off cost), `DEFAULT_MARKDOWN_MATRIX_SET`,
      `selectMatrix(set, scope)`, and `resolveMarkdown(item, days, set, scope)` returning
      `{ price, band, scope }`. Leave `calculateMarkdownPrice` / `getMarkdownBandConfig` /
      `getMarkdownLevelForDays` signatures untouched so existing call sites keep compiling.
- [x] 1.2 `shared/domain/supplier-policy.ts`: add `CREDIT_TYPES` / `CreditType`, add `creditType` to
      `SupplierPolicyRecord`, to the `POLICY_FIELDS` array, and to `CREATE_BASELINE`; add
      `creditScopeForSupplier(supplier)` returning `FULL_CREDIT` only for an explicitly full-credit
      supplier and `NO_CREDIT` for null / unclassified / unknown.
- [x] 1.3 Unit tests: `selectMatrix` and `resolveMarkdown` per scope, including the unchanged
      out-of-window (`> 90` days) and expired (`<= 0` days) null returns and the retail-to-cost
      per-product fallback on both matrices; `creditScopeForSupplier` fail-safe cases;
      `isPolicyWrite` now trips on a `creditType`-only change while an unchanged value does not.
- [x] 1.4 Extract product-supplier/brand-state selection from the credit-claim rollup into one shared
      resolver, preserving claimability behaviour. Add `CreditScopeReason` and
      `MarkdownCreditContext`; direct product suppliers are authoritative and `REFERENCE` brands can
      never select `FULL_CREDIT`. Reject/fail safe on unknown enum values.

## 2. Schema (triplicated — golden rule 6)

- [x] 2.1 Prisma: `Supplier.creditType String @default("NONE") @map("credit_type")` in
      `backend/prisma/schema.prisma` and `backend/prisma/production/schema.prisma`.
- [x] 2.2 Prisma: `OrganizationMarkdownConfig.creditScope String @default("NO_CREDIT") @map("credit_scope")`;
      replace `@@unique([organizationId])` with `@@unique([organizationId, creditScope])` in both
      schemas, and rename the `Organization` relation to plural `markdownConfigs`.
- [x] 2.3 Neon SQL: `backend/prisma/neon-sql/0008_add_credit_scoped_markdown_matrix.sql` + rollback —
      add both columns, backfill existing rows to `'NONE'` / `'NO_CREDIT'`, drop and recreate the
      unique constraint, and add checks for allowed values. Rollback deletes `FULL_CREDIT` rows
      before restoring single-organization uniqueness and dropping the new columns.
- [x] 2.4 Register SQLite migration `018-add-credit-scoped-markdown-matrix` in
      `backend/src/migrations/migration.service.ts`, following `011-add-organization-markdown-config-table`
      and `017-add-supplier-policy-fields`; recreate the table to change the unique key while
      preserving rows, timestamps, foreign keys, checks, and indexes. Prove the upgrade idempotent.
- [x] 2.5 pglite harness and `workers/src/database.ts` shapes updated for both new columns.
- [x] 2.6 Migration test: existing config rows and suppliers backfill to `'NO_CREDIT'` / `'NONE'`, and
      prices resolved before and after the migration are identical — the behaviour-neutrality proof.

## 3. Backend (Express)

- [x] 3.1 `markdown-config.repository.ts`: `findAllByOrganizationId` returning both scope rows;
      `upsert(organizationId, creditScope, data)` keyed on the composite unique. `hasRetailData`
      unchanged.
- [x] 3.2 `markdown-config.service.ts`: `getMatrixSet()` falling back per-scope to
      `DEFAULT_MARKDOWN_MATRIX_SET`, `getMatrix(scope)`, and `updateConfig(set)` writing both scopes in
      one `$transaction`; extend the existing retail-data guard to every band across both matrices.
      Legacy bare-matrix updates write only `NO_CREDIT` and preserve an existing `FULL_CREDIT` row.
- [x] 3.3 `backend/src/schemas/index.ts`: extend `markdownConfigSchema` to accept
      `{ matrices: { NO_CREDIT, FULL_CREDIT } }`, reusing `markdownBandSchema` and applying the
      existing non-decreasing refinement per scope; keep the legacy bare-matrix body accepted as
      `NO_CREDIT`-only.
- [x] 3.4 `GET /markdown-config` returns `{ matrices, hasRetailData }` with `matrix` retained as a
      deprecated `NO_CREDIT` alias so nothing breaks mid-deploy; `PUT` stays manager/admin-gated.
- [x] 3.5 Thread `creditType` through the existing supplier create / `PATCH` / `PUT` path — no new
      endpoint, since `POLICY_FIELDS` membership supplies admin gating, diffing, and `policyUpdatedAt`.
- [x] 3.6 Derive `creditScope` server-side (`resolveSupplier` → `creditScopeForSupplier`) onto
      `GET /products/by-barcode/:barcode` and `/by-sku/:sku`, the expiry-entry rows, and the
      detailed-expiry-report rows; include the resolved supplier name and the reason for a fallback
      scope so the UI can render its warning.
- [x] 3.7 `inventory.service.ts` markdown price resolution uses the item's scope instead of always the
      org matrix.
- [x] 3.8 Tests: composite-key upsert; per-scope default fallback; retail guard across both matrices;
      org-scoping (org from auth only); `403` on a non-admin `creditType` write; `creditScope` present
      and correct on each read payload.
- [x] 3.9 Select direct supplier, brand state, and brand supplier in each original org-scoped query,
      project all four credit-context fields through the shared resolver without N+1 queries, and
      test malformed/cross-organization supplier references cannot affect pricing.
- [x] 3.10 Reject invalid `creditType` values; valid non-admin classification writes return `403`
      rather than being silently stripped. Clearing a supplier policy resets `creditType` to `NONE`.

## 4. Workers (parity)

- [x] 4.1 `workers/src/index-minimal.ts`: `handleGetMarkdownConfig` / `handleUpdateMarkdownConfig` and
      `markdownConfigRowToMatrix` become set-aware, with the same legacy alias and validation. Write
      both matrices atomically with one multi-row `INSERT ... ON CONFLICT` statement.
- [x] 4.2 Select `credit_scope` / `credit_type` into the product-lookup and expiry read SQL and derive
      the scope through the shared helper.
- [x] 4.3 Extend the existing dual-backend conformance test so SQLite and Postgres/pglite agree on the
      returned matrix set and every row's `creditScope`, including row order (golden rule 5).
- [x] 4.4 Worker route tests mirroring the Express validation, admin-gating, and org-isolation cases.
- [x] 4.5 Extend Neon/SQLite expiry queries with org-scoped joins for direct and brand suppliers;
      map via the shared resolver and preserve deterministic row ordering.

## 5. Frontend

- [x] 5.1 `useMarkdownMatrix.ts`: add `useMarkdownMatrices(token)` returning
      `{ matrices, status, error, retry }`; keep `useMarkdownMatrix` only as a deprecated source-
      compatibility wrapper. Pricing surfaces render no markdown price before `ready` and show a
      retryable no-price error on failure.
- [x] 5.2 `MarkdownMatrixSettings.tsx`: two matrix editors — "No credit policy" and "Full credit" —
      reusing the existing band-row markup and `isNonDecreasing` check per scope, with a hint that many
      stores run the full-credit matrix off retail.
- [x] 5.3 Save confirmation dialog: new prices apply everywhere immediately; already-stickered items
      will show the new price on the worklist and need re-stickering. Save only on confirm.
- [x] 5.4 `ScanPage.tsx`: price via `resolveMarkdown` and render the read-only scope badge —
      full credit with supplier name, no credit policy on file, supplier unconfirmed, or no brand
      matched — linking the incomplete cases to the supplier and catalogue review surfaces.
- [x] 5.5 `ExpiryEntriesPage.tsx` (3 call sites) and `DetailedExpiryReportPage.tsx`: pass each row's
      `creditScope` through `resolveMarkdown` and add a compact scope indicator to the markdown column.
- [x] 5.6 `MarkdownCalculator.tsx`: use the looked-up product's scope with the same badge — this is the
      surface for manually re-pricing already-stickered stock after a matrix change.
- [x] 5.7 Supplier policy dialogue (`SupplierPolicyFields` / `supplierPolicyDraft` /
      `supplierPolicyInput`): credit-type selector, read-only for non-admins like the other policy
      fields, with the existing `403` / `422` handling.
- [x] 5.8 Tests: settings saves both matrices and shows the confirm dialog; a full-credit SKU prices at
      the full-credit band and an unclassified one at the no-credit band, each with the right badge;
      non-admin controls remain read-only.
- [x] 5.9 Reuse one compact scope badge/action across Scan, Expiry Entries, Detailed Expiry Report,
      and Markdown Calculator. Deep-link `NO_POLICY` to policy review and
      `PENDING_CONFIRMATION`/`NEEDS_BRAND` to catalogue review, extending Supplier Credits query
      handling to select the relevant tab and supplier where available.
- [x] 5.10 Settings tracks the originally loaded matrix set, validates each editor independently, and
      enables save only when dirty and valid. Cancel sends no request; confirm sends exactly one and
      explains immediate repricing/re-stickering using the existing accessible alert-dialog pattern.

## 6. Completion

- [x] 6.1 `rtk lint`.
- [ ] 6.2 `doppler run -- npm run test:backend:diff`, plus a no-Doppler run of the markdown-config and
      supplier-policy suites for CI parity on secret-absence paths.
- [ ] 6.3 `npm run test:frontend:diff` and `npm run test:db`.
- [x] 6.4 `rtk tsc` across backend, frontend, and workers.
- [x] 6.5 `npx openspec validate add-credit-scoped-markdown-matrices --strict`.
- [ ] 6.6 Browser QA: configure both matrices, classify a supplier as full credit, scan one of its
      SKUs and an unclassified SKU, and confirm the detailed expiry report re-prices live with no
      migration.
- [ ] 6.7 Regenerate Prisma; validate both Prisma schemas; run root compile, frontend/Worker builds,
      strict change validation and `openspec validate --all`. Document rollout order as migration →
      APIs → frontend and log the completed feature to project memory.
