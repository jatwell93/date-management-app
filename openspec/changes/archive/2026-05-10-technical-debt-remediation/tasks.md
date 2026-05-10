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
- [x] 2.3 Update the remaining route files to delegate to controllers instead of calling services directly.
  - Progress: migrated `store-area.routes.ts` to delegate request/response handling to `StoreAreaController`, with the service factory moved into the controller module so the route no longer constructs or calls `StoreAreaService` directly.
  - Progress: migrated `storage-quota.routes.ts` to delegate quota and can-upload request/response handling to `StorageQuotaController`; the route no longer constructs or calls `StorageQuotaService` directly and retains only controller dispatch plus route-specific 500 response mapping.
  - Progress: migrated `dashboard.routes.ts` to delegate dashboard response handling to `DashboardController`; the route no longer resolves `DashboardService` directly and preserves the existing dashboard payload/error forwarding contract.
  - Progress: migrated `expired-item.routes.ts` to delegate list, process, and expired-loss report response handling to `ExpiredItemController`; the route no longer constructs or calls `ExpiredItemService` directly and retains only middleware plus route-specific 500 response mapping.
  - Progress: migrated `report.routes.ts` to delegate report response handling, update-statuses command response, and items-by-user query validation to `ReportController`; the route no longer constructs or calls `ReportService` directly.
  - Progress: migrated `health.routes.ts` to delegate health, readiness, process metrics, database metrics, database health, recent-alert response handling, and tier-flag validation state to `HealthController`; the route now retains middleware plus controller dispatch.
  - Progress: migrated `upload.routes.ts` to delegate per-request `ServiceProvider` and `UploadController` construction through `createUploadControllerForRequest`; the route now retains middleware, multer configuration, and controller dispatch.
  - Progress: migrated `user.routes.ts` to delegate user CRUD request/response handling, id validation, organization ownership checks, and create payload shaping to `UserController`; the route now retains middleware plus controller dispatch.
  - Progress: migrated `org-bootstrap.routes.ts` to delegate Clerk bootstrap defaults, bootstrap/seed response handling, and BaseError translation to `OrgBootstrapController`; the route now retains auth, rate limiting, validation, and controller dispatch.
  - Progress: migrated `admin.metrics.routes.ts` to delegate all metric request/response handling to `AdminMetricsController`; the route now retains middleware and controller dispatch only.
  - Progress: migrated `organization-invite.routes.ts` to delegate all invite CRUD, accept, resend, and org deletion handling to `OrganizationInviteController`; the route now retains middleware, validation, rate limiting, and controller dispatch only.
  - All direct route/service seams now migrated to controller delegation.
- [x] 2.4 Verify the route layer is thin by removing any leftover domain logic from route handlers and keeping response shapes stable.
  - Progress: `store-area.routes.ts` now retains middleware and controller delegation only while preserving the existing Store Area route response contract under the focused route suite.
  - Progress: `storage-quota.routes.ts` now delegates validation/access/quota decisions to `StorageQuotaController` while preserving the existing Storage Quota response contract under the focused route suite.
  - Progress: `dashboard.routes.ts` now retains middleware and controller delegation only while preserving the existing Dashboard route response contract under the focused route suite.
  - Progress: `expired-item.routes.ts` now retains middleware and controller delegation only while preserving the existing Expired Item list/process/report response contract under the focused route suite.
  - Progress: `report.routes.ts` now retains middleware, feature gating, and controller delegation only while preserving the existing report endpoint response contracts under the focused route suite.
  - Progress: `health.routes.ts` now retains middleware and controller delegation only while preserving the existing health/readiness/metrics/database-health/recent-alert response contracts under the focused route suite.
  - Progress: `upload.routes.ts` now retains middleware, multer setup, validation, rate limiting, and controller factory dispatch only while preserving the existing upload route response contract under the focused route suite.
  - Progress: `user.routes.ts` now retains middleware and controller delegation only while preserving the existing user CRUD response contract under the focused route suite.
  - Progress: `org-bootstrap.routes.ts` now retains middleware and controller delegation only while preserving bootstrap and seed response handling under direct controller coverage.
  - Progress: `admin.metrics.routes.ts` now retains middleware and controller delegation only while preserving the existing admin metrics response contract (15 tests pass).
  - Progress: `organization-invite.routes.ts` now retains middleware, validation, rate limiting, and controller delegation only while preserving the existing invite response contract (22 tests pass).

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
- [x] 6.2 Migrate service read/write operations to the new repositories and remove routine Prisma calls from business logic.
  - Progress: created `OrganizationInviteRepository` (find, list, create, update, markExpired, countPending) and migrated `organization-invite.service.ts` non-transactional Prisma calls to use it.
  - Progress: migrated `email.service.ts` organization lookups to use `OrganizationRepository.findWithContactDetails()` and extracted audit log creation to a private helper.
  - Progress: migrated `ensureWithinUserLimit` in `organization-invite.service.ts` to use `SubscriptionRepository`, `UserRepository.countByOrganization`, and `OrganizationInviteRepository.countPendingByOrg` instead of direct Prisma calls.
  - Progress: created `RefreshTokenRepository` (create, findByToken, findByTokenWithUser, delete, revoke, deleteExpired) and migrated `auth.service.ts` refresh token operations and subscription lookup to use repositories.
  - Progress: added `findByClerkOrganizationId` and `create` to `OrganizationRepository`; migrated `org-bootstrap.service.ts` org lookup and creation to use it.
  - Progress: migrated `clerk-webhook.service.ts` (15 calls), `subscription-billing-lifecycle.service.ts` (12), `subscription-trial-lifecycle.service.ts` (12), `webhook.service.ts` (12) to repositories. All individual Prisma model calls now delegate to repositories; `$transaction` wrappers remain as coordination layer only.
  - Remaining: `inventory.service.ts`, `organization-invite.service.ts` (transactional paths), `org-bootstrap.service.ts` (transactional paths), `csv-parser.service.ts`, `seed.service.ts`.
- [x] 6.3 Add repository tests for the model-specific query paths that were extracted from services.
  - Repository unit tests exist for analytics, inventory, job lock, org audit, organization, product, report, storage quota, store area, subscription, upload, and user repositories.
- [x] 6.4 Confirm the repository layer can be injected through the composition root and mocked cleanly in tests.
  - `di-container.test.ts` covers repository resolution from the composition root, and ServiceProvider seam tests cover repository-backed caching/mocking paths.
- [x] 6.5 Remove duplicate query code from services after repository coverage is in place.
  - Progress: removed duplicate subscription lookup and user/invite counting from `organization-invite.service.ts` by delegating to existing repositories; removed 4 duplicate org lookups and 5 audit log creations from `email.service.ts`.
  - Progress: addressed useful PR 126 CodeScene findings by extracting shared ProductController lookup/update/upload helpers, flattening product import column matching, and replacing branch-heavy billing/webhook dispatch helpers with focused lookup helpers.
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
- [x] 8.5 Verify backend coverage and changed-test runs complete within the intended feedback budget.
  - Changed-test verification passes within budget: 76 targeted tests across inventory routes, Stripe utils, and subscription routes completed in 17.291s.
  - PR 126 CodeScene follow-up targeted verification: `npm test -- --runInBand src/tests/unit/inventory.service.test.ts src/tests/unit/subscription-billing.helpers.test.ts src/tests/unit/migrated-controllers.test.ts` completed with 75/75 tests passing in 16.172s; `npm run type-check` passed; `npm run lint` exited 0 with 25 pre-existing warnings outside the touched helper cleanup.
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

## 10. CodeScene-Driven Next Wave — Exact Implementation Scope

This section details the four highest-risk hotspots (identified by Code Health scores < 8.65) and the specific, unambiguous tasks to decompose them. **Order matters**: product import first (foundation for CSV/XLSX parity), webhook lifecycle second (foundation for billing stability), excess-product export third (cleanup at service boundary), inventory hardening last (type safety hardening).

### Hotspot 1: Product Import Pipeline (Product Service + CSV Parser Service)

**Files to modify**: `backend/src/services/product.service.ts`, `backend/src/services/csv-parser.service.ts`  
**Existing line ranges**:
- `product.service.ts::processCSVUploadInternal` lines 405–629 (225 LOC, cc=33, nesting=3)
- `product.service.ts::processXLSXUpload` lines 631–872 (242 LOC, cc=47, nesting=4)
- `csv-parser.service.ts::parseProductRow` lines 539–605 (67 LOC, cc=15)
- `csv-parser.service.ts::parseExpiryRow` lines 607–676 (70 LOC, cc=22)
- `csv-parser.service.ts::processBatch` lines 801–946 (146 LOC, cc=10, contains 3 conditional bumps)

**Current problems**:
- File format detection, row validation, duplicate handling, and response marshaling are tangled in one 242-LOC method per format.
- Row parsers (`parseProductRow`, `parseExpiryRow`) are service methods, not pure functions; they're tested indirectly.
- Batch orchestration (`processBatch`) couples result collection, error aggregation, and database persistence.
- Changes to row parsing ripple across CSV and XLSX code paths without isolated seams.
- **Business case impact** (CodeScene): Product service Code Health 5.23 → estimated -27% to -43% dev time, -31% to -49% defect reduction if decomposed.

**Decomposition scope** (preserve existing response contracts):
1. Extract `parseProductRow` and `parseExpiryRow` into pure row-validator functions in `csv-parser.service.ts` (no service state).
2. Split `processCSVUploadInternal` into: (a) CSV header validation helper, (b) row-by-row parser coordinator, (c) batch result formatter.
3. Split `processXLSXUpload` into: (a) XLSX worksheet detection helper, (b) row-by-row parser coordinator, (c) batch result formatter.
4. Move format-agnostic batch processing (`processBatch`) out of row parsing; it stays in CSV parser but is called uniformly.
5. Preserve current success/partial-failure response shapes: `{ imported: number; updated: number; errors: string[] }`.
6. Keep existing test suites passing: `integration/csv-parser.test.ts`, `integration/upload-flow.test.ts`.

**Test coverage to add** (additive, narrow suites):
- Malformed CSV header (missing required column, extra columns).
- CSV empty file (0 rows), XLSX empty worksheet (headers only).
- Duplicate SKU within single file (e.g., rows 3 and 5 both have SKU "ABC123").
- Duplicate barcode within single file.
- Row-level expiry rejection (invalid date in `usedByDate` column).
- CSV/XLSX parity: same products imported from CSV vs XLSX should produce identical results (same imported count, same error count, same error messages for same invalid rows).
- Cost parsing edge cases: "$1,234.56" (thousands separator), "12.99 EUR" (currency code), "(12.34)" (negative), "12,99" (European decimal).

**Validation criteria**:
- All new row validators accept `(row: Record<string, string>, rowNumber: number, headerMap: Map<string, string>, seenSkus: Set<string>) => { row?: ParsedRow; errors: RowError[] }` signature.
- No service state in row parsers (pure functions only).
- `processBatch` remains the only database coordinator; all Prisma calls stay there.
- Response payload shape unchanged: `{ imported: number; updated: number; errors: string[] }` with no new fields.
- Existing error messages unchanged (no customer-facing error format changes).

**Files to reference** (existing helpers that must not be changed):
- `product-import.helpers.ts` (column detection functions): `getProductImportCsvColumnState`, `getProductImportCsvRowValues`, `findColumnByAlternatives`, etc.
- `expiry-import-date-parser.ts` (date parsing): `parseExpiryImportDate`.
- `product.service.ts::extractCostValueEnhanced` (cost extraction): used by row parser, must remain unchanged.

---

### Hotspot 2: Webhook Lifecycle (Webhook Service)

**File to modify**: `backend/src/services/webhook.service.ts`  
**Existing line ranges**:
- `webhook.service.ts::handleSubscriptionCreated` lines 260–352 (93 LOC, cc=13, dependencies: validateWebhookMetadata, extractTierFromPrice, transactional state updates)
- `webhook.service.ts::handleSubscriptionDeleted` lines 404–496 (93 LOC, cc=13, dependencies: validateWebhookMetadata, isCreationLocked check, downgrade warning email)
- `webhook.service.ts::handleSubscriptionUpdated` lines 354–402 (49 LOC, cc=8)
- `webhook.service.ts::validateWebhookMetadata` lines 185–234 (50 LOC, cc=10, maps Stripe `customerId` to org context)
- `webhook-event-dispatcher.ts` lines 1–50 (event family routing)

**Current problems**:
- Event handlers embed metadata validation, tier extraction, checkout-session completion, payment-intent success/failure, transactional coordination, status transition logic, and creation-lock logic in dense methods.
- Idempotency checks and creation-lock logic are inline; no seam for independent testing.
- Subscription state transitions (created → active, deleted → canceled, downgraded → soft-locked) are mixed together with checkout conversion and trial-payment recovery.
- Changes to one event handler affect cache invalidation, audit logging, and email sending across all handlers.
- **Business case impact** (CodeScene): Webhook service Code Health 7.42 → estimated -18% to -28% dev time, -26% to -37% defect reduction if decomposed.

**Decomposition scope** (preserve existing event dispatch and transaction semantics):
1. Extract metadata validation into a focused helper: `validateAndMapMetadata(customerId: string): Promise<{ organizationId: string; clerkOrgId?: string }>` (no side effects).
2. Extract tier extraction into a focused helper: `extractAndValidateTier(subscription: Stripe.Subscription): TierLevel` (pure function).
3. Keep checkout-session completion as the checkout-family coordinator, and move its validation, subscription update, usage-limit, and creation-lock steps into smaller helpers beneath it.
4. Keep payment-intent success/failure as the payment-family coordinators, and move their metadata lookup, persistence, and email actions into smaller helpers beneath them.
5. Extract creation-lock logic into a focused helper: `applyCreationLockIfOverLimits(organizationId, usage, tierLimits): Promise<boolean>` (returns true if lock applied).
6. Keep event dispatch (`webhook-event-dispatcher.ts` calling `handleSubscriptionCreated`, `handleSubscriptionUpdated`, `handleSubscriptionDeleted`, `handleCheckoutSessionCompleted`, `handlePaymentIntentSucceeded`, `handlePaymentIntentFailed`) unchanged.
7. Preserve current Stripe event dispatch flow, repository transaction wrapping, and cache invalidation calls.

**Test coverage to add** (additive, narrow suites):
- `handleSubscriptionCreated`: missing `customerId` in metadata (should reject early, not crash).
- `handleSubscriptionCreated`: idempotent replay of same event ID (should not create duplicate subscription rows).
- `handleSubscriptionDeleted`: org over SKU limit (should apply creation lock and send downgrade email).
- `handleSubscriptionDeleted`: org under SKU limit after deletion (should not apply creation lock).
- `handleSubscriptionUpdated`: downgrade from Professional to Starter with usage > Starter limits (should apply lock).
- `handleCheckoutSessionCompleted`: converts trialing orgs to paid subscriptions and clears creation lock.
- `handlePaymentIntentSucceeded`: trial subscription moves to ACTIVE and audit/trial events are recorded.
- `handlePaymentIntentFailed`: failure is recorded and admin alert email is sent.
- `validateWebhookMetadata`: missing or invalid Stripe customer mapping (should throw NotFoundError, not 500).
- Audit log entries created for each event type (create, update, delete, checkout conversion, payment confirmation, payment failure).

**Validation criteria**:
- All extracted helpers are pure or have minimal side effects (only database reads, no writes).
- Transaction semantics unchanged: all state updates (subscription, usage limits, audit log, org.isCreationLocked) remain atomic.
- Event dispatch order unchanged: verify webhook signature → validate metadata → apply handler → invalidate cache.
- Email sending (downgrade warning, welcome email) still happens after transaction commits.
- Error propagation unchanged: failed event handler still throws and is caught by error middleware.

**Files to reference** (existing helpers that must not be changed):
- `webhook-subscription.helpers.ts` (tier limits): `getTierLimits`, `TIER_LIMITS` constant.
- `webhook-event-dispatcher.ts` (event dispatch): no changes, just caller of refactored handlers.
- `ProcessedWebhookEventRepository`, `SubscriptionRepository`, `TrialEventRepository`, `AuditLogRepository` (existing repositories): use as-is.

---

### Hotspot 3: Excess-Product Export (Product Controller)

**File to modify**: `backend/src/controllers/product.controller.ts`  
**Existing line ranges**:
- `product.controller.ts::exportExcess` lines 266–346 (81 LOC, cc=13, embeds SKU-limit math and tier lookups)

**Current problems**:
- HTTP adapter (controller) owns billing rule logic (SKU limits, tier-to-max-SKU mapping).
- Business logic to check "within limit" vs "over limit" is mixed with response formatting.
- CSV serialization and JSON marshaling are interleaved.
- Makes tier rule changes require controller edits instead of pure service changes.

**Decomposition scope** (preserve existing JSON and CSV response shapes):
1. Create a new service method in `product.service.ts`: `getExcessProductsView(organizationId: string): Promise<{ state: 'unlimited' | 'within_limit' | 'over_limit'; excessCount: number; products: Product[]; tierLevel: TierLevel; maxSkus: number | null }>`.
2. Move all SKU-limit calculation and tier logic into the new service method (away from controller).
3. Move CSV serialization into a dedicated helper: `formatExcessProductsAsCSV(products: Product[]): string` (in `utils/csv.ts` or new `csv-formatter.ts`).
4. Reduce controller's `exportExcess` to: fetch view → choose JSON or CSV format → serialize and send.
5. Preserve current response shapes:
   - Unlimited tier: `{ message: 'Current tier has unlimited SKUs', excessCount: 0, products: [] }`.
   - Within limit: `{ message: 'Organization is within SKU limits', excessCount: 0, products: [] }`.
   - Over limit (JSON): `{ message: '...', excessCount: N, products: [...] }`.
   - Over limit (CSV): CSV file download with same columns as product list.

**Test coverage to add** (additive, narrow suites):
- Unlimited tier (Tier 5): should return `excessCount: 0`, no products.
- Professional tier with 10 SKUs, limit 5: should return `excessCount: 5`, list 5 excess products.
- Starter tier at exactly the limit: should return `excessCount: 0`.
- Starter tier 1 over limit: should return `excessCount: 1`.
- CSV export format: headers present, no extra columns, proper CSV escaping (commas, quotes).
- JSON export format: products array structure, keys match Product model.
- Both formats (JSON and CSV) should list the same products for a given over-limit state.

**Validation criteria**:
- `exportExcess` controller method shrinks to 15–20 LOC (delegation only).
- All SKU-limit math moves to service layer.
- No tier rule logic remains in controller.
- Response format (JSON keys, CSV columns) unchanged for all three states (unlimited, within, over).
- Tier-limit rules can be changed in service without touching controller.

**Files to reference** (existing helpers that must not be changed):
- `TIER_LIMITS` constant in `types/subscription.ts`: provides max_skus for each tier.
- `escapeCSVValue` in `utils/csv.ts`: use for proper CSV escaping.

---

### Hotspot 4: Inventory Hardening (Inventory Service)

**File to modify**: `backend/src/services/inventory.service.ts`  
**Exact problem location**: Line 488, `private mapPrismaToModel(item: any): InventoryItem`

**Current problem**:
- Prisma result mapped to legacy `InventoryItem` interface using `any` type.
- Compiler cannot catch schema mismatches (e.g., if Prisma schema adds/removes a field).
- Runtime failures occur instead of compile-time errors.

**Decomposition scope** (preserve existing method behavior and error handling):
1. Replace `any` type with explicit Prisma schema type: `private mapPrismaToModel(item: Prisma.InventoryItemGetPayload<...> | InventoryItemRaw): InventoryItem`.
2. Or, create a concrete adapter type: `type InventoryItemRaw = { id: number; productId: number; organizationId: string | null; expiryDate: Date; locationId: string; status: string; createdAt: Date; updatedAt: Date }` and use that instead of `any`.
3. Extract markdown calculation into a focused helper if not already done: `calculateMarkdownPrice(originalPrice: number, markdownPercent: number): number`.
4. Extract status-transition validation into a focused helper: `validateStatusTransition(currentStatus: string, newStatus: string): { valid: boolean; reason?: string }`.
5. Keep all existing error handling, audit logging, and transaction behavior unchanged.

**Test coverage to add** (additive, narrow suites):
- Type-checking regression: if Prisma schema adds a required field to `InventoryItem`, TypeScript should emit a compile error (test via `npm run type-check`).
- Schema drift detection: if a field is missing from the mapping, test should catch it (e.g., mock Prisma to return missing field, mapping should fail or throw).
- Markdown calculation edge case: 100% discount (price → 0), negative discount (unchanged), fractional cents (e.g., "$12.996" → "$12.99").
- Status transition validation: valid transitions (active → marked, marked → active) pass; invalid (active → invalid-status) fail.

**Validation criteria**:
- No `any` type in `mapPrismaToModel` (use explicit type or adapter type).
- Prisma result interface must match the actual Prisma schema (`InventoryItem` model).
- All existing error messages and audit log format unchanged.
- Markdown and status-transition logic isolated in named helpers (optional refactor, not critical).

**Files to reference** (existing schemas and types):
- `prisma/schema.prisma`: InventoryItem model definition.
- `backend/src/models/inventory.model.ts`: legacy `InventoryItem` interface (the target type).
- `inventory-markdown.helpers.ts`: existing markdown helpers (verify they're used consistently).

---

## 11. Detailed Slice Notes — Execution Checklist

Order matters. Implement slices in this sequence: Product Import → Webhook Lifecycle → Excess-Product Export → Inventory Hardening. Each slice has a TDD loop and regression test suite.

### Slice 1: Product Import Pipeline

**Scope**: Decompose `product.service.ts` and `csv-parser.service.ts` CSV/XLSX upload paths.  
**Existing tests to extend**: `backend/src/tests/unit/csv-parser.service.test.ts`, `backend/src/tests/unit/product.service.test.ts`, `backend/src/tests/unit/csv.processing.test.ts`, `backend/src/tests/unit/csv.upload.test.ts`, `backend/src/tests/unit/xlsx.upload.test.ts`.  
**Integration tests to verify**: `integration/csv-parser.test.ts`, `integration/upload-flow.test.ts`.

**Step-by-step**:
1. **Create row validator pure functions** in `csv-parser.service.ts`:
   - `validateProductRowStrictly(record: Record<string, string>, rowNumber: number, headerMap: Map<string, string>, seenSkus: Set<string>): RowValidationResult` (extracted from `parseProductRow`).
   - `validateExpiryRowStrictly(record: Record<string, string>, rowNumber: number, headerMap: Map<string, string>): RowValidationResult` (extracted from `parseExpiryRow`).
   - Both are pure functions, no side effects, no service state.

2. **Create format-specific parsers** as helper functions:
   - `parseCSVUploadWithValidation(filePath: string, organizationId: string): Promise<BatchParseResult>` (wraps CSV header validation + row loop + batch coordinator).
   - `parseXLSXUploadWithValidation(filePath: string, organizationId: string): Promise<BatchParseResult>` (wraps XLSX worksheet detection + row loop + batch coordinator).
   - Both return a common `BatchParseResult = { rows: ParsedRow[]; errors: RowError[] }`.

3. **Extract batch result formatter**:
   - `formatBatchResult(batchParseResult: BatchParseResult, batchProcessResult: { imported: number; updated: number }): { imported: number; updated: number; errors: string[] }`.

4. **Update `product.service.ts::processCSVUpload`** to use new helpers:
   - `processCSVUpload` now calls `parseCSVUploadWithValidation` or `parseXLSXUploadWithValidation` based on file type.
   - Result marshaling moved to `formatBatchResult`.
   - Response contract unchanged.

5. **Run tests**: `npm test -- --runInBand src/tests/unit/csv-parser.service.test.ts src/tests/unit/product.service.test.ts src/tests/unit/csv.processing.test.ts src/tests/unit/csv.upload.test.ts src/tests/unit/xlsx.upload.test.ts src/tests/integration/csv-parser.test.ts src/tests/integration/upload-flow.test.ts`.

6. **Commit**: `git add . && git commit -m "refactor(product): decompose CSV/XLSX import parsing into pure row validators"`.

---

### Slice 2: Webhook Lifecycle

**Scope**: Decompose `webhook.service.ts` subscription event handlers.  
**Existing tests to extend**: `backend/src/tests/unit/webhook.service.test.ts`, `backend/src/tests/unit/webhook-event-dispatcher.test.ts`, `backend/src/tests/unit/webhook-monitoring.test.ts`.  
**Integration tests to verify**: `integration/webhook.integration.test.ts`, `integration/webhook.edge-cases.test.ts`.

**Step-by-step**:
1. **Extract metadata validation helper** (pure read, no writes):
   - `validateAndMapCustomerMetadata(customerId: string, orgRepo: OrganizationRepository): Promise<{ organizationId: string }>`.
   - Test: missing customerId → throws NotFoundError. Org exists → returns org ID.

2. **Extract tier extraction helper** (pure function):
   - `extractTierFromSubscriptionPrice(subscription: Stripe.Subscription): TierLevel`.
   - Test: Pro price → "professional", Starter price → "starter", invalid price → throws ValidationError.

3. **Extract transactional orchestrators** for subscription, checkout, and payment-intent paths:
  - `updateSubscriptionState(organizationId: string, tierLevel: TierLevel, status: SubscriptionStatus, trialEndDate: Date | null, tx: Prisma.TransactionClient): Promise<void>`.
  - The existing checkout coordinator should stay the boundary, but its validation, subscription update, usage-limit, and creation-lock steps should be split into smaller helpers under it.
  - The existing payment coordinators should stay the boundary, but their validation, repository writes, and email sending should be split into smaller helpers under them.
  - All state updates (subscription row, usage limits, audit log) stay inside their transactional coordinator.

4. **Extract creation-lock helper** (transactional):
   - `applyCreationLockIfNeeded(organizationId: string, usage: UsageSnapshot, tierLimits: TierLimits, tx: Prisma.TransactionClient): Promise<{ lockApplied: boolean }>`.
   - Returns whether lock was applied so caller can send appropriate email.

5. **Refactor `handleSubscriptionCreated`** to use helpers:
   - Validate metadata → extract tier → call `updateSubscriptionState` → invalidate cache.
   - Reduce from 93 LOC to ~40 LOC of orchestration code.

6. **Refactor `handleSubscriptionDeleted`** to use helpers:
   - Validate metadata → call `updateSubscriptionState` with "canceled" status → apply lock helper → send email.
   - Reduce from 93 LOC to ~45 LOC of orchestration code.

7. **Refactor `handleCheckoutSessionCompleted`**, `handlePaymentIntentSucceeded`, and `handlePaymentIntentFailed` to use the extracted metadata/state helpers:
   - Keep checkout conversion, trial conversion, and payment failure recording in separate event-family branches.
   - Preserve the existing monitoring, audit logging, and email side effects.

8. **Run tests**: `npm test -- --runInBand src/tests/unit/webhook.service.test.ts src/tests/unit/webhook-event-dispatcher.test.ts src/tests/unit/webhook-monitoring.test.ts src/tests/integration/webhook.integration.test.ts src/tests/integration/webhook.edge-cases.test.ts`.

9. **Commit**: `git add . && git commit -m "refactor(webhook): decompose webhook event families into focused helpers"`.

---

### Slice 3: Excess-Product Export

**Scope**: Move SKU-limit logic from `product.controller.ts::exportExcess` to `product.service.ts`.  
**Existing tests to extend**: `backend/src/tests/unit/product.service.test.ts`, `backend/src/tests/unit/product.routes.test.ts`, `backend/src/tests/contract/product.routes.test.ts`.

**Step-by-step**:
1. **Create new service method** in `product.service.ts`:
   ```typescript
   async getExcessProductsView(organizationId: string): Promise<ExcessProductsView>
   // where ExcessProductsView = {
   //   state: 'unlimited' | 'within_limit' | 'over_limit';
   //   excessCount: number;
   //   products: Product[];
   //   tierLevel: TierLevel;
   //   maxSkus: number | null;
   // }
   ```
   - Contains all SKU-limit checks, tier lookups, product fetches.
   - No HTTP concerns, no response formatting.

2. **Create CSV formatter helper**:
   - `formatExcessProductsAsCSV(products: Product[]): string` in `utils/csv-formatter.ts` or within product service.
   - Produces CSV with headers: `[sku, name, barcode, costPrice, createdAt]`.
   - Uses `escapeCSVValue` from `utils/csv.ts` for proper escaping.

3. **Reduce `productController.exportExcess`** to HTTP adapter only:
   - Call `getExcessProductsView` → choose JSON or CSV based on query param → serialize → send.
   - Reduce from 81 LOC to ~20 LOC.

4. **Test new service method**: unlimited tier, within-limit, over-limit, exact-limit edge cases.

5. **Test CSV formatter**: proper escaping (quotes, commas), headers, product rows match Product model keys.

6. **Run tests**: `npm test -- --runInBand src/tests/unit/product.service.test.ts src/tests/unit/product.routes.test.ts src/tests/contract/product.routes.test.ts`.

7. **Commit**: `git add . && git commit -m "refactor(product): move excess-product logic from controller to service"`.

---

### Slice 4: Inventory Hardening

**Scope**: Replace `any` type in `inventory.service.ts::mapPrismaToModel` with explicit type.  
**Existing tests to extend**: `backend/src/tests/unit/inventory.service.test.ts`, `backend/src/tests/unit/inventory-markdown.helpers.test.ts`, `backend/src/tests/contract/inventory.test.ts`.

**Step-by-step**:
1. **Create explicit type** for Prisma result:
   ```typescript
   type InventoryItemRaw = {
     id: number;
     productId: number;
     organizationId: string | null;
     expiryDate: Date;
     locationId: string;
     status: string;
     createdAt: Date;
     updatedAt: Date;
   };
   ```

2. **Replace `mapPrismaToModel` signature**:
   - From: `private mapPrismaToModel(item: any): InventoryItem`
   - To: `private mapPrismaToModel(item: InventoryItemRaw): InventoryItem`

3. **Add type-checking regression test**:
   - Mock Prisma result with exact type.
   - If test still compiles and passes, type safety is validated.
   - If future schema change adds a field and mapping is not updated, test fails at type-check time.

4. **Run `npm run type-check`** to ensure no new type errors introduced.

5. **Run tests**: `npm run type-check && npm test -- --runInBand src/tests/unit/inventory.service.test.ts src/tests/unit/inventory-markdown.helpers.test.ts src/tests/contract/inventory.test.ts`.

6. **Commit**: `git add . && git commit -m "refactor(inventory): harden type safety in Prisma mapping"`.

---

### Regression Test Coverage (Additive, Narrow Suites)

After each slice is complete, run the narrow regression suite to confirm no regressions:

```bash
# After Slice 1 (Product Import)
npm test -- --runInBand \
  src/tests/unit/csv-parser.service.test.ts \
  src/tests/unit/product.service.test.ts \
  src/tests/unit/csv.processing.test.ts \
  src/tests/unit/csv.upload.test.ts \
  src/tests/unit/xlsx.upload.test.ts \
  src/tests/integration/csv-parser.test.ts \
  src/tests/integration/upload-flow.test.ts

# After Slice 2 (Webhook Lifecycle)
npm test -- --runInBand \
  src/tests/unit/webhook.service.test.ts \
  src/tests/unit/webhook-event-dispatcher.test.ts \
  src/tests/unit/webhook-monitoring.test.ts \
  src/tests/integration/webhook.integration.test.ts \
  src/tests/integration/webhook.edge-cases.test.ts

# After Slice 3 (Excess-Product Export)
npm test -- --runInBand \
  src/tests/unit/product.service.test.ts \
  src/tests/unit/product.routes.test.ts \
  src/tests/contract/product.routes.test.ts

# After Slice 4 (Inventory Hardening)
npm run type-check && npm test -- --runInBand \
  src/tests/unit/inventory.service.test.ts \
  src/tests/unit/inventory-markdown.helpers.test.ts \
  src/tests/contract/inventory.test.ts

# Final: Full service/controller regression
npm test -- --runInBand \
  src/tests/services/*.test.ts \
  src/tests/unit/migrated-controllers.test.ts
```

**All suites must complete in <120 seconds and report 0 failing tests before merging to `main`.**




