# Proposal: Master-catalogue seed provenance, entry retirement & a platform-admin triage surface

## Why

The provider-curated master catalogue (`add-brand-supplier-mapping`, #358) is maintained from a
curated workbook and loaded by `SeedService.seedMasterCatalogue`. As the app approaches its first
in-store trial, the operator (a single platform admin) has **no way to answer basic stewardship
questions from inside the app**:

- **"When did I last update the base, and what changed?"** The seed computes
  `inserted / updated / skipped` counts (`backend/src/services/seed.service.ts:166-197`) but only
  returns them to the caller's stdout — nothing is persisted. There is no version, no history, no
  record of which workbook was loaded when.
- **"What vanished between one version and the next?"** Today: nothing ever does. The seed is a
  pure upsert-by-barcode with **no delete path and no reverse comparison** — it only walks rows
  present in the *new* workbook (`seed.service.ts:173-195`). A product removed from the curated
  sheet lingers in the database forever, still matching store uploads and still tagging items with a
  brand the operator deliberately retired. "A match is available but not current" is exactly this
  orphan class, and it is currently invisible and undetectable.
- **"What have stores flagged?"** The crowd-sourced correction loop is captured and the review API
  exists and is locked to the platform allowlist (`platformCatalogueCorrectionRouter`,
  `backend/src/routes/supplier-credit.routes.ts:174-186`), but there is **no UI** — corrections can
  only be triaged with curl/Postman today.

## What changes

Close the seed → review → re-seed loop for the platform operator, in three parts:

- **Persisted seed-run provenance.** Every successful live `seedMasterCatalogue` run records a `CatalogueSeedRun`
  row: a monotonic `version`, `seededAt`, `sourceFileName`, and the full diff
  (`inserted / updated / unchanged / retired / reinstated / errorCount`). The
  `MasterCatalogueSeedResult` also separates benign `skippedBlankRows` from unchanged catalogue
  entries and carries structured validation errors. Under the v1 fail-closed policy, invalid live
  attempts abort before writing, so persisted `errorCount` is always zero.
- **Retirement instead of orphaning (decision (b)).** A barcode present in the database but **absent
  from the newly seeded workbook** is soft-retired: a nullable `retiredAt` is stamped on
  `MasterCatalogueEntry`. Retired entries are **excluded from all import matching** in both backends
  but preserved for audit; a later seed that reintroduces the barcode clears `retiredAt`
  (reinstates it). This makes "what vanished" a first-class, reversible, reportable event — the
  honest form of the staleness signal — rather than a silent superset that only grows.
- **A platform-admin triage surface (frontend for the existing API).** One admin surface, two
  panels: **(1) catalogue provenance/version history** — latest version, when, from which file, and
  the per-run diff including retirements; and **(2) correction triage** — the `PENDING`
  `CatalogueCorrection` queue with batch accept/reject, wrapping the existing
  `platformCatalogueCorrectionRouter`. Gated by the existing `PLATFORM_ADMIN_USER_IDS` allowlist;
  no new auth primitive.

## Scope (v1)

- **Schema (triplicated — golden rule 6):**
  - `MasterCatalogueEntry.retiredAt` (nullable timestamp).
  - New global `CatalogueSeedRun` table: `version` (monotonic int), `seededAt`, `sourceFileName`,
    `inserted`, `updated`, `unchanged`, `retired`, `errorCount`. **Not org-scoped** — the master
    catalogue is global read-only reference data and seeding is a platform operation, so no
    `organizationId` (a deliberate, documented exception to golden rule 1, consistent with
    `MasterCatalogueEntry` already being global).
  - Prisma base + production, Neon SQL `0009_add_catalogue_provenance` (+ rollback), runtime SQLite
    migration `019-add-catalogue-provenance`, pglite harness.
- **Seed safety guardrail (dry-run + retirement threshold):** `seedMasterCatalogue` accepts a
  **dry-run** mode that parses the workbook, computes the full diff (including the exact set that
  would be retired), and returns it **without mutating the catalogue or recording a run** — so the
  operator can inspect "this will retire N entries" before committing. A live run whose retirement
  set exceeds a **configurable proportion of the active catalogue** (default 10%) SHALL **abort
  without any mutation** unless explicitly confirmed, guarding against the foot-gun of accidentally
  seeding a partial/wrong workbook and mass-retiring real entries. The guard only engages when a
  prior catalogue exists (the first seed retires nothing). Exposed as service options
  (`{ dryRun, confirmRetirements }`) and a minimal npm-backed operator command supporting
  `--dry-run` and `--confirm-retirements`.
- **Workbook validation is fail-closed:** blank rows are counted separately, while malformed rows
  and duplicate normalized barcodes are reported by dry-runs but abort live runs before any write
  transaction or provenance insert.
- **Seed service:** compute the retired set (DB-active barcodes minus workbook barcodes) and stamp
  `retiredAt`; clear `retiredAt` when a retired barcode reappears; persist one `CatalogueSeedRun`
  per run with the full diff and next `version`. `retired` and `reinstated` counts added to
  `MasterCatalogueSeedResult`.
- **Matching excludes retired entries (dual-backend, golden rule 5):** `matchByBarcode` and
  `matchByWholesalerSku` in `shared/domain/*` skip `retiredAt != null`; Worker SQL adds
  `AND retired_at IS NULL`; Express's raw enrichment SQL parenthesizes its barcode-or-SKU predicate
  and combines it with `retired_at IS NULL`; conformance tests cover a retired barcode and a
  retired wholesaler-SKU hit falling through to "needs brand".
- **Read endpoint (backend + worker parity):** platform-admin-gated catalogue provenance read —
  latest run plus recent history (version, seededAt, sourceFileName, diff counts). Reuses the
  `PLATFORM_ADMIN_USER_IDS` allowlist authorization already applied to `platformCatalogueCorrectionRouter`.
- **Bootstrap capability:** both organization-bootstrap responses expose `isPlatformAdmin`, derived
  from the bootstrapped numeric database user ID using one shared fail-closed allowlist helper. This
  is a presentation capability only; every platform endpoint remains independently authorized.
- **Frontend:** a platform-admin surface with the provenance/version-history panel and the
  correction triage queue (list `PENDING`, accept/reject, batch select), reusing the existing
  correction endpoints and the allowlist-gated route guard.

## Out of scope / deferred

- **Match-rate / coverage-health dashboard** — deferred until there are several weeks of real trial
  flags to aggregate (operator is on-site weekly; qualitative review of the raw queue is enough for
  v1).
- **Redistribution of accepted corrections to other orgs** — remains deferred exactly as in #358;
  accepting a correction still only flips its status, and folding it into the catalogue stays a
  manual re-seed.
- **In-app workbook upload / editing.** Seeding stays an explicit operator-run command against a
  supplied workbook path; this change records what that run did, it does not move the upload into
  the browser.
- **A new "stale match" correction *kind*.** Staleness is handled structurally via retirement, not
  as a user-flag type, so `CatalogueCorrection.kind` is unchanged.

## Relationship to prior changes

**Modifies** #358's "Master catalogue seeding is explicit and idempotent" requirement (adds
persisted provenance and retirement-on-drop-out) and its matching requirement (retired entries never
match). **Adds** the seed-run provenance history and the platform-admin triage/provenance surface.
Does **not** touch the claim lifecycle, brand/supplier resolution, correction *capture*, or the
`PLATFORM_ADMIN_USER_IDS` authorization contract from #358 — it only adds a read endpoint and a UI
on top of the existing allowlist.

## Reuse strategy

- **Extend `SeedService.seedMasterCatalogue`** in place; persist the `MasterCatalogueSeedResult` it
  already returns. No parallel seed path.
- **Reuse `platformCatalogueCorrectionRouter`** and its allowlist guard for both the correction
  triage UI and the new provenance read — one authorization primitive.
- **Extend `matchByBarcode` / `matchByWholesalerSku`** in `shared/domain/*` with a retired filter;
  do not fork a second matcher. Worker SQL adds one predicate.
- **Frontend:** a platform-admin route guarded by the bootstrap `isPlatformAdmin` capability;
  provenance and
  triage as sibling panels rather than a new app section.

## Guardrails

- `CatalogueSeedRun` and `MasterCatalogueEntry.retiredAt` are global reference data; the exception
  to org-scoping is deliberate and documented (both are read-only to tenants; only the platform
  seed writes them).
- Retirement is **soft and reversible** — no hard delete; a reappearing barcode is reinstated with
  its history intact.
- The platform read/triage endpoints fail closed on missing/malformed `PLATFORM_ADMIN_USER_IDS`,
  identically to the existing correction-review route.
- `MASTER_CATALOGUE_RETIREMENT_THRESHOLD` defaults to `0.10`; malformed, negative, or greater-than-1
  values are configuration errors rather than silently falling back.
- Retirement changes matching in **both** backends together, guarded by a dual-backend conformance
  test (golden rule 5); schema stays triplicated (golden rule 6).

## Implementation steps

1. Schema (triplicated): `MasterCatalogueEntry.retiredAt`, `CatalogueSeedRun`; Neon SQL `0009`
   (+ rollback), SQLite `019`, pglite harness.
2. Shared domain and production matching: retired-aware shared matchers, Express raw SQL, Worker
   barcode and SKU CTEs; dual-backend conformance for retired matching.
3. Seed service: retired-set computation + reinstatement + `CatalogueSeedRun` persistence with
   monotonic `version`; extend `MasterCatalogueSeedResult` with `retired` / `reinstated`; add the
   dry-run mode and the retirement-threshold guard (`{ dryRun, confirmRetirements }`).
4. Operator command: npm-backed seed script with dry-run and confirmation flags.
5. Backend and Workers: shared platform-admin helper, bootstrap capability, and parity provenance
   read (latest + at most 20 prior history rows).
6. Frontend: platform-admin surface — provenance/version-history panel + correction triage queue.
7. Tests: shared units; dual-backend conformance (retired matching); seed-run provenance +
   retirement + reinstatement; provenance-read auth (allowlist fail-closed); frontend panels.
8. Completion: `rtk lint`, affected `rtk vitest run`, `npm run test:db`, worker conformance,
   `rtk tsc`, `npx openspec validate add-catalogue-provenance-and-triage --strict`.
