# Tasks: Master-catalogue seed provenance, entry retirement & platform-admin triage

## 1. Schema and shared foundations

- [x] 1.1 Add failing schema/migration tests before implementation.
- [x] 1.2 Prisma: add `retiredAt DateTime?` and global `CatalogueSeedRun` with manually assigned
      unique `version` to both schemas.
- [x] 1.3 Add Neon `0009_add_catalogue_provenance.sql` + rollback and reversible runtime SQLite
      migration `019-add-catalogue-provenance`.
- [x] 1.4 Update the pglite harness and Worker database shapes; regenerate Prisma and validate both
      schemas.
- [x] 1.5 Add shared `CatalogueSeedRunDto` / provenance response types and one fail-closed
      `isPlatformAdminUser` helper; replace duplicated Express and Worker allowlist parsing.

## 2. Seed service and operator command

- [x] 2.1 Add failing seed tests for separated counters, retirement, reinstatement, unchanged reruns,
      versioning, provenance counts/source basename, and atomic rollback.
- [x] 2.2 Preflight parsing: preserve blank-row counting, detect duplicate normalized barcodes, return
      validation errors and prospective diff in dry-run, and throw `CatalogueSeedValidationError`
      before a live write transaction.
- [x] 2.3 Treat a matched-but-`retiredAt`-set entry as a reinstatement: refresh its fields from the
      workbook while preserving row identity and brand linkage, clear `retiredAt`, and require an
      active entry in the unchanged fast path.
- [x] 2.4 Compute active database barcodes minus workbook barcodes and stamp one captured
      `seededAt` on the retirement set.
- [x] 2.5 Assign `max(version) + 1` inside the transaction and persist exactly one
      `CatalogueSeedRun` with the source basename and full diff; verify rollback is atomic.
- [x] 2.6 Return `inserted`, `updated`, `unchanged`, `retired`, `reinstated`, `skippedBlankRows`,
      `errorCount`, `errors`, sorted `retiredBarcodes`, and `dryRun`; preserve idempotency.
- [x] 2.7 Dry-runs compute the complete diff but mutate no catalogue row, create no provenance row,
      and consume no version.
- [x] 2.8 Strictly validate `MASTER_CATALOGUE_RETIREMENT_THRESHOLD` (default `0.10`); when a prior
      catalogue exists and `retired / activeBefore` is strictly greater than it, throw structured
      `RetirementThresholdExceeded` unless confirmed. Equality and first seeds are allowed.
- [x] 2.9 Add `npm run seed:master-catalogue -- <path> [--dry-run|--confirm-retirements]`; print
      JSON, exit non-zero for validation/threshold errors, and test argument parsing, dry-run,
      confirmation, invalid configuration, and production sample-workbook rejection.

## 3. Retired-aware matching in every path

- [x] 3.1 Add shared matcher tests for retired barcode/SKU, active-vs-retired shared SKU, ambiguous
      active SKUs, and row-order independence; filter retired entries before candidate matching.
- [x] 3.2 Update Express `SupplierCreditRepository.enrichImportedProduct`: parenthesize the full
      barcode-or-SKU predicate and combine it with `retired_at IS NULL`.
- [x] 3.3 Update both Worker catalogue-import CTE joins to require `retired_at IS NULL`.
- [x] 3.4 Add dual-backend conformance fixtures proving retired matches create unmatched corrections
      while an active shared-SKU entry wins.

## 4. Platform capability and provenance APIs

- [x] 4.1 Extend Express and Worker organization bootstrap responses and frontend types with
      `isPlatformAdmin`, evaluated from the bootstrapped numeric database user ID.
- [x] 4.2 Add repository/database reads ordered by `version DESC`, fetching 21 global rows and
      normalizing dates/numeric fields into the shared DTO.
- [x] 4.3 Add platform-admin-gated `GET /api/platform/catalogue/provenance` in Express router /
      controller / service layers and the equivalent Worker route.
- [x] 4.4 Test missing, blank, zero, negative, mixed-validity, and non-numeric allowlists; empty,
      one-run, more-than-21-run ordering/history; date serialization; global reads; and parity.

## 5. Frontend

- [x] 5.1 Add a lazy `/platform/catalogue` route and navigation shown only when bootstrap returns
      `isPlatformAdmin`; direct non-platform access redirects to the signed-in landing page.
- [x] 5.2 Add a focused platform-catalogue service and types rather than mixing operator APIs into
      tenant supplier-credit calls.
- [x] 5.3 Provenance panel: latest version, seeded time, source filename, all diff counts, prominent
      retirement warning, prior history, and loading/empty/retryable-error states.
- [x] 5.4 Correction panel: list only `PENDING` rows with kind, barcode, entered brand, chosen
      supplier, organization, and age; support single actions and current-page selection.
- [x] 5.5 Batch actions call existing single-item PATCH endpoints with `Promise.allSettled`, clear
      successes, retain/report failures, refresh, disable in-flight actions, and confirm rejection.
- [x] 5.6 Add component, service, route, navigation, access-denied, empty, error, and partial batch
      failure tests, then verify the route in a real browser.

## 6. Completion

- [x] 6.1 Run `npm run test:backend:diff`, `npm run test:frontend:diff`, and `npm run test:db`.
- [x] 6.2 Run `npm run lint`, `npm run compile`, `npm run build:frontend`, and
      `npm run build:workers`.
- [ ] 6.3 Run `openspec validate --all`.
- [x] 6.4 Record the feature and safety decisions with `mem-log`, and present the human approval
      summary before any push or PR. Do not archive before merge.
