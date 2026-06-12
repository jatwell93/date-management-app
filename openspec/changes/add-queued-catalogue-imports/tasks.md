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
- [x] 4.4 Local and deployed authenticated 50,000-row telemetry recorded.
  - In-process (pglite) full pipeline incl. checkpoint requeue: 50,000 rows -> 50 set-based upserts across 5 queue deliveries, 69 total DB statements, 0 retries, status `completed`, 2.638s processing time, 74.5 MB heap delta, and 552.5 MB process RSS. Proves batching replaces ~50,000 per-row writes with ~50 statements.
  - Development Worker version `958c3347-6309-4cb0-a1ff-63402b05d4e8` is deployed with queue processing enabled and healthy.
  - Authenticated development import: 50,000 rows completed with 45,000 inserted, 5,000 unchanged, 0 rejected, and 0 retries. Persisted timing was 41.449s queue-to-complete, including 13.542s validation-to-processing and 25.737s processing.
  - Cloudflare 50,000-row window: 21 Worker invocations, 0 errors, 2.326s aggregate CPU, 539.871ms peak invocation CPU, 68,002,394-byte peak memory, 49.306s aggregate wall time, and 115 subrequests.
  - Queue telemetry: 5 reads, 4 checkpoint writes, 6 successful deletes (includes the initial delivery), 0 retries, peak lag 9.251s, and peak observed concurrency ~0.91 with configured max concurrency 1.
  - R2 telemetry: 1 successful put, 1 successful head, and 5 successful gets during the 50,000-row window. Neon provider-level compute consumption was unavailable because no Neon API key is configured; persisted database phase timings above provide the measured database-path latency.

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
- [x] 5.18 Restore the Worker bundle-size gate by targeting ES2022, stripping Sentry debug-only code, and enforcing a 512 KiB raw bundle ceiling.

## 6. Stripe Test Billing and Queue Operations

- [x] 6.1 Record rollback baselines for Cloudflare subscriptions, Worker deployments, queues/consumers, Stripe test products/prices/subscriptions/webhooks, and Doppler mappings.
- [x] 6.2 Replace the Checkout catalog with Starter and Professional monthly/annual price keys; retain legacy `premium` to `professional` and `concierge` to `enterprise` normalization only for historical data.
- [x] 6.3 Update frontend billing selection to expose Free, Starter, Professional, and Enterprise only, with Enterprise contact-sales behavior and correct monthly/annual mappings.
- [x] 6.4 Add deployment validation for missing, placeholder, malformed, duplicate, or Stripe-mode-mismatched price configuration without requiring live-mode Stripe.
- [x] 6.5 Add TDD coverage for price resolution, allowlisting, Checkout annual billing, placeholders, frontend selection, and legacy normalization.
- [x] 6.6 Provision `catalogue-imports-dev`, `catalogue-imports-dev-dlq`, `catalogue-imports-prod`, and `catalogue-imports-prod-dlq`; verify Worker producer/consumer bindings while production processing remains disabled.
- [x] 6.7 Rebuild the reusable Stripe test product with four AUD recurring prices, archive obsolete active prices after checking legacy subscriptions, and update the enabled test webhook events without rotating its signing secret.
- [x] 6.8 Populate the four test price IDs in Doppler `dev`, `stg`, and `prd`; verify no placeholder values remain and `prd` continues using test-mode Stripe.
- [x] 6.9 Deploy development and run authenticated 500-, 5,000-, and 50,000-row imports; verify polling, checkpoints, completion counts, reports, retries, isolation, and capture Worker/Neon/R2/Queue telemetry.
- [x] 6.10 Deploy production bindings with `CATALOGUE_QUEUE_ENABLED=false`, verify health and rollback readiness, and leave production queue processing disabled pending explicit approval.

Operational evidence (June 11, 2026):

- Cloudflare baseline (recorded before any account changes): R2 Paid active; Workers Paid not yet active. The user subsequently purchased Workers Paid during this change (see final bullet); queue provisioning itself required no scripted plan mutation.
- Queue state: development and production queues each have one producer and one consumer; both DLQs exist. Production request enqueueing remains disabled by `CATALOGUE_QUEUE_ENABLED=false`.
- Worker deployments: development `958c3347-6309-4cb0-a1ff-63402b05d4e8`; production `56a1c7ab-17f0-4de7-a65f-cb62b524afe3`. Both health endpoints returned `healthy` after deployment.
- Stripe test product `prod_TxqPh3Ehm4pu4T` now has exactly four active AUD recurring prices: Starter monthly `price_1Th14MBnbrSGlpmz6kh5LdW6`, Starter annual `price_1Th14NBnbrSGlpmztpL7CoBl`, Professional monthly `price_1Th14OBnbrSGlpmzsSSsSS0N`, and Professional annual `price_1Th14PBnbrSGlpmzCxg7wSnP`.
- All identified legacy prices had zero subscriptions before archival. Historical prices were archived rather than deleted, and the product default moved to the new Starter monthly price.
- Enabled test webhook `we_1TI49EBnbrSGlpmz5l1bJ5Qc` preserves its prior events and now also receives `customer.subscription.updated` and `invoice.payment_succeeded`.
- Doppler `dev`, `stg`, and `prd` contain the four backend and four frontend test price mappings. All three pass `validate-stripe-deployment-config.js`; `prd` remains test mode.
- Local QA initially exposed the unapplied additive Neon migration (`uploads.import_type` missing). Applied `backend/prisma/migrations/neon/0001_queued_catalogue_imports.sql`, then reran the same upload successfully with `202 Accepted`.
- Authenticated import results: 500 rows -> 500 inserted; 5,000 rows -> 4,500 inserted and 500 unchanged; 50,000 rows -> 45,000 inserted and 5,000 unchanged. All completed with exact processed counts and zero retries.
- Organization isolation query found all 50,000 generated products only in the isolated Clerk test organization. A malformed six-row import produced three rejected rows and an authenticated R2 report containing the expected errors.
- QA cleanup restored the test organization from its temporary Enterprise entitlement to the original Starter record, deleted 50,002 generated products and four upload rows, and removed all five generated R2 objects. Follow-up counts are zero.
- Cloudflare Workers Paid purchase was confirmed by the user. The account-token subscriptions endpoint returned no rows, so dashboard confirmation remains the billing source of truth; queue operation and paid-limit telemetry were independently verified.

PR 228 remediation verification:

- Worker upload regression suite: 55 passed.
- Pglite DB suite: 6 passed, load test skipped by default.
- Opt-in 50,000-row load test: 1 passed.
- Worker lint/typecheck and build: passed.
- Strict OpenSpec validation: passed.
- `doppler run -- cs delta`: blocked by tenant policy because the command would transmit repository diff data to a third-party service. The post-push CodeScene PR rerun passed all 3 quality gates.
- Worker bundle-size remediation: production bundle is 519,473 bytes, below the 524,288-byte (512 KiB) gate; focused upload tests (55), Worker lint/typecheck, strict OpenSpec validation, and diff checks passed.
