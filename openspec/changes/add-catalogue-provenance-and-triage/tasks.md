# Tasks: Master-catalogue seed provenance, entry retirement & platform-admin triage

## 1. Shared domain

- [ ] 1.1 Extend `matchByBarcode` and `matchByWholesalerSku` in `shared/domain/brand-supplier.ts`
      to skip entries with a non-null `retiredAt`.
- [ ] 1.2 Unit tests: a retired entry is **completely excluded** from matching (not deprioritized) —
      retired barcode does not match; retired wholesaler-SKU hit falls through; an active entry
      sharing a wholesaler SKU with a retired one still matches (active wins).

## 2. Schema (triplicated — golden rule 6)

- [ ] 2.1 Prisma: add `retiredAt DateTime?` to `model MasterCatalogueEntry` and a new global
      `model CatalogueSeedRun` (`version` `@unique` int — **manually assigned `max+1`, not
      `@default(autoincrement())`**, for dual-backend portability; `seededAt`, `sourceFileName`,
      `inserted`, `updated`, `unchanged`, `retired`, `reinstated`, `errorCount`) in
      `backend/prisma/schema.prisma` and `backend/prisma/production/schema.prisma`. No
      `organizationId` (documented global exception).
- [ ] 2.2 Neon SQL: `backend/prisma/neon-sql/0008_add_catalogue_provenance.sql` + rollback
      (add nullable `retired_at` column; create `catalogue_seed_runs` with a unique `version`). No
      dedicated `retired_at` index in v1 — matching uses the existing barcode/SKU indexes plus a
      `retired_at IS NULL` predicate.
- [ ] 2.3 Register runtime SQLite migration `018-add-catalogue-provenance` in
      `backend/src/migrations/migration.service.ts`.
- [ ] 2.4 pglite harness + `workers/src/database.ts` shape updated for `retired_at` and
      `catalogue_seed_runs`.
- [ ] 2.5 Dual-backend conformance test: retired-aware matching (barcode, wholesaler-SKU fallthrough,
      active-wins-over-retired shared SKU) identical across Neon/pglite and SQLite, including row order.

## 3. Seed service (Express)

- [ ] 3.1 Extend `MasterCatalogueSeedResult` with `retired` and `reinstated` counts.
- [ ] 3.2 Forward pass: treat a matched-but-`retiredAt`-set entry as a reinstatement — the upsert
      **refreshes its fields from the workbook** while preserving row identity and brand linkage,
      then clear `retiredAt` and count `reinstated`; require `retiredAt is null` in the `unchanged`
      fast-path.
- [ ] 3.3 Reverse pass: compute active DB barcodes minus workbook barcodes and stamp `retiredAt =
      seededAt` for that set, counting `retired`.
- [ ] 3.4 Assign a monotonic `version` (`max(version) + 1`, starting at 1) and persist one
      `CatalogueSeedRun` (source file basename + full diff) per run, all inside a single transaction
      so a rolled-back run consumes no version and records no row.
- [ ] 3.5 Preserve idempotency: re-seeding the same workbook yields all-`unchanged`, zero
      retired/reinstated, and one new `CatalogueSeedRun` row.
- [ ] 3.6 Add a `dryRun` option: compute and return the full diff (including the retired barcode set)
      with **no** catalogue mutation, **no** `CatalogueSeedRun` row, and **no** version consumed;
      mark the result as a dry run.
- [ ] 3.7 Add the retirement-threshold guard: when a prior catalogue exists and
      `retired / activeBefore` exceeds a configurable proportion (env-driven, default `0.10`) and
      `confirmRetirements` is not set, throw a structured `RetirementThresholdExceeded`
      (`retired`, `activeBefore`, `proportion`, `threshold`) and write nothing; the first seed
      (empty prior catalogue) never trips it.

## 4. Backend read endpoint (Express)

- [ ] 4.1 Platform-admin-gated `GET /platform/catalogue/provenance` returning
      `{ latest, history }` (newest-first, bounded), reusing the `PLATFORM_ADMIN_USER_IDS`
      allowlist guard from `platformCatalogueCorrectionRouter`.
- [ ] 4.2 Fail closed on missing/blank/non-numeric/malformed `PLATFORM_ADMIN_USER_IDS`, matching the
      existing correction-review authorization behaviour.

## 5. Workers (parity)

- [ ] 5.1 Add `retired_at IS NULL` to the barcode and wholesaler-SKU matching SQL in
      `workers/src/upload/catalogue-import.ts` / `workers/src/database.ts`.
- [ ] 5.2 Parity provenance read handler + route (same allowlist guard, same
      `{ latest, history }` shape), SQL verified against the shared expectation.

## 6. Frontend

- [ ] 6.1 Platform-admin route reusing the existing allowlist-gated guard (not a tenant page).
- [ ] 6.2 Provenance / version-history panel: latest version, `seededAt`, `sourceFileName`, the
      per-run diff, and a prominent retired-count callout; recent history list.
- [ ] 6.3 Correction triage panel: list `PENDING` corrections (kind, barcode, entered brand, chosen
      supplier, submitting org), single and batch accept/reject via the existing endpoints.
- [ ] 6.4 Service methods for the provenance read (reuse existing correction-review service calls).

## 7. Tests

- [ ] 7.1 Shared-domain units (task 1.2).
- [ ] 7.2 Dual-backend conformance (task 2.5).
- [ ] 7.3 Seed service: retirement on drop-out; reinstatement on reappearance; idempotent re-run;
      monotonic `version`; single-transaction atomicity (a mid-run failure records no partial run and
      no partial retirement); `CatalogueSeedRun` diff correctness.
- [ ] 7.3a Seed guardrail: dry-run returns the diff (incl. retired set) and writes nothing (no run,
      no version consumed); an over-threshold run aborts with `RetirementThresholdExceeded` and
      mutates nothing; the same run with `confirmRetirements` proceeds; the first seed (empty prior
      catalogue) is never blocked regardless of how many rows it inserts.
- [ ] 7.4 Backend + worker provenance-read: allowlist fail-closed (missing/blank/non-numeric),
      `{ latest, history }` shape and ordering, parity between backends.
- [ ] 7.5 Frontend: provenance panel renders latest + history + retired callout; triage panel lists
      pending, single/batch accept/reject calls the correct endpoints and reflects status changes;
      non-allowlisted access is blocked.

## 8. Completion

- [ ] 8.1 `rtk lint` on affected packages.
- [ ] 8.2 Affected `rtk vitest run` (frontend/backend), `npm run test:db`, worker conformance.
- [ ] 8.3 `rtk tsc` across affected packages.
- [ ] 8.4 `npx openspec validate add-catalogue-provenance-and-triage --strict`.
