## 0. Planning Guardrails

- [x] 0.1 Lock the initial migration order for the backend areas that matter most so the implementation sequence stays explicit.
  - Migration order is captured in the proposal/design and later task sequencing: controller/service decomposition first, repository slices next, test hygiene, then DevOps readiness.
- [x] 0.2 Capture baseline metrics for the work being changed, including coverage runtime, skipped tests, and the route/service areas being touched.
  - Baseline and follow-up evidence is recorded in this checklist: targeted route regression runtime, skipped-test audit, full coverage OOM at 616.4s, and follow-up coverage timeout attempts.
- [x] 0.3 Record the invariants that must not change during the refactor: external route contracts, database provider support, and production behavior.
  - Invariants are recorded in `proposal.md`, `design.md`, and the refreshed runtime docs: route contracts stay stable, dev/test remains SQLite/local storage, and production remains Workers/Neon/R2/Pages.

## 1. Baseline and Wiring

- [x] 1.1 Map the current route-to-controller-to-service flow for the highest-impact backend areas and confirm the first slice to migrate.
  - Reconfirmed with `codemap .` and `codemap --deps`: high-impact backend routes now include product, inventory, subscription, webhook, upload, dashboard, and report seams.
- [x] 1.2 Add the DI and reflection dependencies needed for container-based wiring.
  - `backend/package.json` includes `tsyringe` and `reflect-metadata`.
- [x] 1.3 Create the backend composition root and register the shared Prisma client.
  - `backend/src/di/container.ts` imports `reflect-metadata`, initializes the tsyringe container, and registers the shared `PrismaClient`.
- [x] 1.4 Register the first pass of repositories and services in the composition root without changing external route behavior.
  - `backend/src/di/container.ts` registers the current repository set plus product, inventory, subscription, and Stripe factories; route contracts remain delegated through existing route files.
- [x] 1.5 Add shared domain error types and a structured logger entry point for backend-wide use.
  - `backend/src/errors/index.ts` defines shared domain/HTTP errors, and `backend/src/utils/logger.ts` provides structured logger methods.

## 2. Controller Migration

- [x] 2.1 Introduce controller modules for the highest-traffic route groups and move request/response handling out of routes.
  - Controller modules exist for inventory, product, subscription, webhook, upload, and database backup; migrated product/inventory/subscription/webhook routes delegate to controller factories.
- [x] 2.2 Add controller unit tests for the migrated route groups, covering success, validation-failure, and dependency-error responses.
  - Added direct migrated-controller coverage for ProductController, InventoryController, SubscriptionController, and WebhookController success, validation/auth/header failure, non-recoverable/dependency-error, and conflict paths. UploadController and DatabaseBackupController are protected by existing focused controller tests.
- [ ] 2.3 Update the remaining route files to delegate to controllers instead of calling services directly.
  - Progress: migrated `store-area.routes.ts` to delegate request/response handling to `StoreAreaController`, with the service factory moved into the controller module so the route no longer constructs or calls `StoreAreaService` directly.
  - Progress: migrated `storage-quota.routes.ts` to delegate quota and can-upload request/response handling to `StorageQuotaController`; the route no longer constructs or calls `StorageQuotaService` directly and retains only controller dispatch plus route-specific 500 response mapping.
  - Progress: migrated `dashboard.routes.ts` to delegate dashboard response handling to `DashboardController`; the route no longer resolves `DashboardService` directly and preserves the existing dashboard payload/error forwarding contract.
  - Progress: migrated `expired-item.routes.ts` to delegate list, process, and expired-loss report response handling to `ExpiredItemController`; the route no longer constructs or calls `ExpiredItemService` directly and retains only middleware plus route-specific 500 response mapping.
  - Progress: migrated `report.routes.ts` to delegate report response handling, update-statuses command response, and items-by-user query validation to `ReportController`; the route no longer constructs or calls `ReportService` directly.
  - Progress: migrated `health.routes.ts` to delegate health, readiness, process metrics, database metrics, database health, recent-alert response handling, and tier-flag validation state to `HealthController`; the route now retains middleware plus controller dispatch.
  - Progress: migrated `upload.routes.ts` to delegate per-request `ServiceProvider` and `UploadController` construction through `createUploadControllerForRequest`; the route now retains middleware, multer configuration, and controller dispatch.
  - Remaining direct route/service seams from the latest audit: admin metrics, org bootstrap, organization invite, and user routes.
- [ ] 2.4 Verify the route layer is thin by removing any leftover domain logic from route handlers and keeping response shapes stable.
  - Progress: `store-area.routes.ts` now retains middleware and controller delegation only while preserving the existing Store Area route response contract under the focused route suite.
  - Progress: `storage-quota.routes.ts` now delegates validation/access/quota decisions to `StorageQuotaController` while preserving the existing Storage Quota response contract under the focused route suite.
  - Progress: `dashboard.routes.ts` now retains middleware and controller delegation only while preserving the existing Dashboard route response contract under the focused route suite.
  - Progress: `expired-item.routes.ts` now retains middleware and controller delegation only while preserving the existing Expired Item list/process/report response contract under the focused route suite.
  - Progress: `report.routes.ts` now retains middleware, feature gating, and controller delegation only while preserving the existing report endpoint response contracts under the focused route suite.
  - Progress: `health.routes.ts` now retains middleware and controller delegation only while preserving the existing health/readiness/metrics/database-health/recent-alert response contracts under the focused route suite.
  - Progress: `upload.routes.ts` now retains middleware, multer setup, validation, rate limiting, and controller factory dispatch only while preserving the existing upload route response contract under the focused route suite.

## 3. Service Decomposition Wave 1

- [x] 3.1 Split webhook verification from webhook event handling into separate units with focused tests.
- [x] 3.2 Extract any shared subscription-related helpers needed by webhook processing so the new units stay isolated.
- [x] 3.3 Replace the old webhook service entry points with the new smaller units and keep the webhook contract unchanged.

## 4. Service Decomposition Wave 2

- [x] 4.1 Split product import and CSV parsing into focused services or collaborators.
- [x] 4.2 Keep file detection, parsing, and row mapping independently testable after the split.
- [x] 4.3 Update the product upload path to use the new decomposed workflow.
- [x] 4.4 Preserve the current CSV upload error reporting and row-level validation behavior during the split.

## 5. Service Decomposition Wave 3

- [x] 5.1 Split subscription lifecycle logic into smaller units for trial setup, billing state, and access checks.
- [x] 5.2 Move any remaining mixed-responsibility logic out of the subscription service once the split is in place.
- [x] 5.3 Refactor any other oversized service that still mixes unrelated responsibilities after the first three decompositions.
- [x] 5.4 Re-run the service-size and dependency review before starting any fourth decomposition so the next target is deliberate.

## 6. Repository Layer

- [x] 6.1 Add repositories for the core models that still query Prisma directly from services.
  - Repository modules now cover analytics, inventory, job locks, org audit, organization, product, report, storage quota, store area, subscription, upload, and user.
- [ ] 6.2 Migrate service read/write operations to the new repositories and remove routine Prisma calls from business logic.
- [x] 6.3 Add repository tests for the model-specific query paths that were extracted from services.
  - Repository unit tests exist for analytics, inventory, job lock, org audit, organization, product, report, storage quota, store area, subscription, upload, and user repositories.
- [x] 6.4 Confirm the repository layer can be injected through the composition root and mocked cleanly in tests.
  - `di-container.test.ts` covers repository resolution from the composition root, and ServiceProvider seam tests cover repository-backed caching/mocking paths.
- [ ] 6.5 Remove duplicate query code from services after repository coverage is in place.
- [x] 6.6 Move dashboard summary SQLite reads into `ReportRepository` and wire `DashboardService` through `ServiceProvider`.
- [x] 6.7 Move SaaS metrics snapshot and webhook metric persistence paths into `AnalyticsRepository`.
- [x] 6.8 Move remaining SaaS metrics subscription and usage read paths into `AnalyticsRepository`.
- [x] 6.9 Move daily report metrics snapshot comparison reads into `AnalyticsRepository`.

## 7. Type Safety and Error Handling

- [x] 7.1 Replace untyped external payload handling with explicit interfaces, unions, or guarded unknowns in the webhook and CSV paths.
- [x] 7.2 Remove approved production `any` usages from the changed backend modules.
- [x] 7.3 Centralize error translation in middleware and remove service-level HTTP response formatting.
- [x] 7.4 Replace ad hoc console logging in production code with structured logger usage.
- [x] 7.5 Confirm error responses remain shape-compatible with existing clients after middleware centralization.

## 8. Test Suite Hygiene

- [x] 8.1 Update test setup to work with the new composition root and injected dependencies.
  - Updated migrated route tests to register DI/container seams directly, including inventory and subscription route coverage.
- [x] 8.2 Fix open handles, forced exits, and async cleanup issues in the backend coverage path.
  - Added `closeDb()` teardown for the legacy better-sqlite3 handle and removed Jest `forceExit`; targeted suites now exit without the forced-exit warning.
- [x] 8.3 Remove or repair skipped backend tests that are now expected to pass under the migrated architecture.
  - Audited backend skips on 2026-05-07: remaining skips are environment-gated suites only (`Neon PostgreSQL`, multi-tenant load, R2 storage, upload load).
- [x] 8.4 Add or adjust regression tests around the migrated seams so the new architecture is protected.
  - Added DI composition-root coverage and ServiceProvider repository-backed seam caching coverage; repaired migrated inventory route seam coverage.
- [ ] 8.5 Verify backend coverage and changed-test runs complete within the intended feedback budget.
  - Changed-test verification passes within budget: 76 targeted tests across inventory routes, Stripe utils, and subscription routes completed in 17.291s.
  - Full coverage still needs follow-up: `npm run test:coverage -- --runInBand --silent --coverageReporters=text-summary` passed tests up to 148/150 suites but hit Node heap OOM after 616.4s during coverage collection.
  - Follow-up attempts on 2026-05-07 did not produce an acceptable full-suite coverage lane: `--coverageProvider=babel` timed out after 904s, `--workerIdleMemoryLimit=512MB` timed out after 904s, and the corrected fast-lane coverage regex timed out after 604s. The narrower services/controllers/contracts coverage slice completed in 105.091s with 121/121 tests passing but cannot satisfy global source thresholds alone.
- [x] 8.6 Record the final coverage/runtime result so the next implementation wave has a clear before/after comparison.
  - Coverage before OOM reported global 81.93% statements, 73.46% branches, 84.04% functions, 81.93% lines; full coverage runtime is still outside target due V8 coverage heap pressure.

## 9. DevOps and Release Readiness

- [x] 9.1 Reconfirm the development, test, and production runtime matrix against the current docs and environment files so the refactor does not drift from SQLite/local storage in dev and Neon/R2/Workers in production.
  - Reconciled `backend/.env.example`, `frontend/.env.example`, `workers/wrangler.toml`, Workers docs, and backend docs: local/dev remains SQLite plus local storage; production remains Neon PostgreSQL, R2, Cloudflare Workers, and Pages/frontend static deployment.
- [x] 9.2 Update the backend deployment and environment documentation to match the current production model and remove stale PM2/SQLite deployment guidance.
  - Replaced stale PM2/Nginx/production-SQLite deployment guidance with Workers/Neon/R2 deployment, rollback, runtime matrix, and troubleshooting guidance.
- [x] 9.3 Verify the CI coverage for backend tests, secrets scanning, workers deployment guardrails, and unchanged frontend/pages deployment paths.
  - Reviewed `.github/workflows/backend-test.yml`, `secrets-scan.yml`, `workers-deploy.yml`, `frontend-test.yml`, and `pages-deploy.yml`; CI still covers backend test/coverage, secret scanning, Workers type/build/deploy guardrails, frontend tests, and Pages deploy guardrails.
- [x] 9.4 Add a release-readiness checklist for local dev, `test:dev`, `test:prod`, `test:both`, production smoke tests, and rollback verification.
  - Added the release-readiness checklist to `backend/docs/deployment.md`.
- [x] 9.5 Confirm the worker deployment constraints remain intact after the backend refactor, including required secrets, allowed production origin values, and production bundle checks.
  - Confirmed `workers/wrangler.toml` keeps production R2, Hyperdrive, KV, Analytics, and required secret comments; `workers-deploy.yml` blocks non-prod Clerk keys and non-canonical production frontend origins; `workers/README.md` now documents Clerk webhook/secret requirements, `WORKERS_SENTRY_DSN`, production CORS origin constraints, and bundle measurement before deploy.
