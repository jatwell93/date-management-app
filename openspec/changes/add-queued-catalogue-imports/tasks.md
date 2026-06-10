## 1. Contracts and Persistence

- [x] 1.1 Add launch tier constants, pricing, trial terms, file limits, and legacy tier normalization.
- [x] 1.2 Extend upload persistence and migration SQL with queued import state, counters, errors, offsets, retries, and active-job uniqueness.
- [x] 1.3 Add Worker environment bindings for the catalogue Queue and rollout flag.

## 2. Queue Import Pipeline

- [x] 2.1 Add tests for 49/50/51 rows, queue acceptance, duplicate delivery, and restart resume (pglite resume test). One-active-import is enforced by a partial unique index + `WHERE NOT EXISTS` (not yet unit-tested).
- [x] 2.2 Change upload completion to persist and enqueue catalogue jobs with `202 Accepted`.
- [x] 2.3 Implement validation pass, tier quota calculation (first-pass only), bounded batches, and checkpoint requeueing. NOTE: source is buffered, not streamed — tier file-size caps are the practical ceiling.
- [x] 2.4 Implement set-based PostgreSQL batch classification for inserted, updated, unchanged, and rejected rows.
- [x] 2.5 Persist first-100 errors and complete authenticated R2 error reports.

## 3. Quotas and User Experience

- [x] 3.1 Count only unresolved active expiry records for quota enforcement.
- [x] 3.2 Add failing frontend tests for queued progress, backoff polling, 30-minute timeout, and final result counts.
- [x] 3.3 Update the CSV upload page and API contracts for durable queued status and error-report downloads.
- [x] 3.4 Update launch pricing and tier limit displays without marketing unbounded technical limits.

## 4. Verification and Rollout

- [x] 4.1 Cover CSV quoting, aliases, currency costs, malformed rows, duplicate identifiers, and conflicts (incl. shared-target). Organization isolation is enforced by org-scoped upsert queries.
- [x] 4.2 Cover 500, 5,000, and generated 50,000-row batching plus tier boundaries and unchanged re-uploads.
- [x] 4.3 Run focused tests, full tests, lint, builds, OpenSpec validation, and security review.
  - Full test suites green: backend 1638 passed (9 skipped), workers 296 passed (3 skipped), pglite DB suite 5 passed, frontend CSVUploadPage 17 passed.
  - Builds pass: workers (`node build.js`), backend (`tsc`), frontend (`craco build`). Worker lint/typecheck and frontend typecheck clean.
  - `openspec validate add-queued-catalogue-imports` passes.
  - Security review of the feature diff: no HIGH/MEDIUM findings (parameterized `jsonb_to_recordset` upserts, consistent org-scoping, server-derived R2 keys, signed upload tokens, authenticated org-scoped error-report download).
  - Also fixed a real prod bug surfaced by the full run: stale compiled `shared/types/subscription.js` (missing free/enterprise) shadowed the `.ts`, undefining `TIER_LIMITS.free` at runtime.
- [ ] 4.4 Local 50,000-row load test recorded; production telemetry pending dev deploy.
  - In-process (pglite) full pipeline incl. checkpoint requeue: 50,000 rows → 50 set-based upserts across 5 queue deliveries, 69 total DB statements, 0 retries, status `completed`, ~9.6s wall, ~89 MB heap delta. Proves batching replaces ~50,000 per-row writes with ~50 statements.
  - STILL REQUIRED before production enablement: capture Worker CPU, Neon compute/latency, R2 operation counts, and peak Worker memory from the development deployment (cannot be measured in-process).

## 5. Code Review Remediation

Findings from the post-implementation review, classified High/Medium/Low. All addressed in the worker, frontend, and tests; verified by `npm test` (workers, 296 passed), `npm run test:db` (pglite, 5 passed), `npm run lint` (workers), and the focused `CSVUploadPage` frontend suite (17 passed).

- [x] 5.1 (H1) Mark a catalogue job `failed` and `ack` once the queue's final delivery attempt (`MAX_PROCESSING_ATTEMPTS`, aligned to `wrangler.toml` `max_retries`) errors, so a poisoned import releases the one-active-import lock instead of staying stuck in `processing` after dead-lettering.
- [x] 5.2 (H2) Make `handleUploadStatus` fall through to the R2 metadata path when no `uploads` row exists, so synchronous (expiry-list) uploads still report status when `CATALOGUE_QUEUE_ENABLED=true`.
- [x] 5.3 (H3) Add real-SQL coverage for the upsert/quota/conflict/resume pipeline via an in-memory Postgres (pglite) harness and a Node vitest project (`vitest.node.config.mts`, `npm run test:db`).
- [x] 5.4 (M1) Reject rows where two upload rows resolve to the same existing product (shared-target conflict) so a batch cannot nondeterministically double-update a row or miscount.
- [x] 5.5 (M2) Serialize an identifier-only projection (`{rowNumber, sku, barcode}`) for the quota and conflict queries to cut payload/memory; document that the source is buffered (file-size caps are the ceiling), not streamed.
- [x] 5.6 (M3) Run the projected-SKU quota check only on the first pass (`processing_offset = 0`); checkpoint resumes skip it, removing redundant work and TOCTOU drift.
- [x] 5.7 (L1) Reconcile this tasks file with the work actually completed.
- [x] 5.8 (L2) Guard `ENTERPRISE_*` env overrides against NaN/non-positive values (`parsePositiveIntEnv`) so a misconfiguration cannot silently fail every enterprise import.
- [x] 5.9 (L3) Annotate `premium`/`concierge` as legacy transitional tiers (normalized to professional/enterprise); no behavior change.
- [x] 5.10 (L4) Wire an authenticated error-report download in the CSV upload page (fetch + auth headers → blob), resolved against the API base via `buildApiUrl`.
- [x] 5.11 (L5) Document that the `uploads_one_active_catalogue_per_org` partial unique index is owned by the raw migration and intentionally absent from the Prisma schema.
- [x] 5.12 Mark direct-upload queue enqueue failures as failed, release the active-import lock, best-effort delete the newly written R2 object, and return 503 without masking cleanup errors.
- [x] 5.13 Mark presigned completion queue enqueue failures as failed, release the active-import lock, preserve the source R2 object, and return 503.
- [x] 5.14 Keep batch progress bounded by capturing the initial validation-error count before processing errors are appended; cover the mixed validation/conflict case with real SQL.
- [x] 5.15 Extract queued upload-route dispatch from `fetch` while preserving existing direct, presigned, complete, status, and error-report response contracts.
- [x] 5.16 Replace the `seedProduct` positional parameters with a typed object parameter.
- [x] 5.17 Split the 50,000-row load test into focused test helpers while retaining behavioral assertions in the test body.

PR 228 remediation verification:

- Worker upload regression suite: 55 passed.
- Pglite DB suite: 6 passed, load test skipped by default.
- Opt-in 50,000-row load test: 1 passed.
- Worker lint/typecheck and build: passed.
- Strict OpenSpec validation: passed.
- `doppler run -- cs delta`: blocked by tenant policy because the command would transmit repository diff data to a third-party service; rely on the PR's CodeScene rerun after push.
