## 0. Planning Guardrails

- [ ] 0.1 Lock the initial migration order for the backend areas that matter most so the implementation sequence stays explicit.
- [ ] 0.2 Capture baseline metrics for the work being changed, including coverage runtime, skipped tests, and the route/service areas being touched.
- [ ] 0.3 Record the invariants that must not change during the refactor: external route contracts, database provider support, and production behavior.

## 1. Baseline and Wiring

- [ ] 1.1 Map the current route-to-controller-to-service flow for the highest-impact backend areas and confirm the first slice to migrate.
- [ ] 1.2 Add the DI and reflection dependencies needed for container-based wiring.
- [ ] 1.3 Create the backend composition root and register the shared Prisma client.
- [ ] 1.4 Register the first pass of repositories and services in the composition root without changing external route behavior.
- [ ] 1.5 Add shared domain error types and a structured logger entry point for backend-wide use.

## 2. Controller Migration

- [ ] 2.1 Introduce controller modules for the highest-traffic route groups and move request/response handling out of routes.
- [ ] 2.2 Add controller unit tests for the migrated route groups, covering success, validation-failure, and dependency-error responses.
- [ ] 2.3 Update the remaining route files to delegate to controllers instead of calling services directly.
- [ ] 2.4 Verify the route layer is thin by removing any leftover domain logic from route handlers and keeping response shapes stable.

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
- [ ] 5.4 Re-run the service-size and dependency review before starting any fourth decomposition so the next target is deliberate.

## 6. Repository Layer

- [ ] 6.1 Add repositories for the core models that still query Prisma directly from services.
- [ ] 6.2 Migrate service read/write operations to the new repositories and remove routine Prisma calls from business logic.
- [ ] 6.3 Add repository tests for the model-specific query paths that were extracted from services.
- [ ] 6.4 Confirm the repository layer can be injected through the composition root and mocked cleanly in tests.
- [ ] 6.5 Remove duplicate query code from services after repository coverage is in place.

## 7. Type Safety and Error Handling

- [ ] 7.1 Replace untyped external payload handling with explicit interfaces, unions, or guarded unknowns in the webhook and CSV paths.
- [ ] 7.2 Remove approved production `any` usages from the changed backend modules.
- [ ] 7.3 Centralize error translation in middleware and remove service-level HTTP response formatting.
- [ ] 7.4 Replace ad hoc console logging in production code with structured logger usage.
- [ ] 7.5 Confirm error responses remain shape-compatible with existing clients after middleware centralization.

## 8. Test Suite Hygiene

- [ ] 8.1 Update test setup to work with the new composition root and injected dependencies.
- [ ] 8.2 Fix open handles, forced exits, and async cleanup issues in the backend coverage path.
- [ ] 8.3 Remove or repair skipped backend tests that are now expected to pass under the migrated architecture.
- [ ] 8.4 Add or adjust regression tests around the migrated seams so the new architecture is protected.
- [ ] 8.5 Verify backend coverage and changed-test runs complete within the intended feedback budget.
- [ ] 8.6 Record the final coverage/runtime result so the next implementation wave has a clear before/after comparison.

## 9. DevOps and Release Readiness

- [ ] 9.1 Reconfirm the development, test, and production runtime matrix against the current docs and environment files so the refactor does not drift from SQLite/local storage in dev and Neon/R2/Workers in production.
- [ ] 9.2 Update the backend deployment and environment documentation to match the current production model and remove stale PM2/SQLite deployment guidance.
- [ ] 9.3 Verify the CI coverage for backend tests, secrets scanning, workers deployment guardrails, and unchanged frontend/pages deployment paths.
- [ ] 9.4 Add a release-readiness checklist for local dev, `test:dev`, `test:prod`, `test:both`, production smoke tests, and rollback verification.
- [ ] 9.5 Confirm the worker deployment constraints remain intact after the backend refactor, including required secrets, allowed production origin values, and production bundle checks.
