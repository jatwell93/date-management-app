## Why

The codebase has reached 20,000+ lines of code but lacks a fully-featured product due to **fundamental architectural issues, not incomplete features**. Key symptoms:

- **Code brittleness**: 60% of recent commits are test fixes; 16 test fixes + 5 regression fixes in ~50 commits indicate systemic fragility
- **Poor testability**: Test coverage suite times out at 13+ minutes with unclosed async handles, slowing feedback loop
- **Scattered logic**: 17 routes feed directly into 29 services with only 3 controllers, bypassing proper abstraction layers
- **Dependency chaos**: 41 hardcoded database client calls, 6 singleton patterns, 0 DI framework = testing nightmare
- **Type erosion**: 151 instances of `: any` bypass TypeScript safety entirely

These architectural gaps force developers to spend time on fragile test infrastructure instead of shipping product. **Fixing now prevents exponential maintenance costs as codebase grows.**

## What Changes

**Phase 1: Architectural Restructuring** - Implement missing controller layer (17 new controllers) and decompose 5 largest services (1,200+ lines each) into focused, single-responsibility services. Implement complete repository pattern for all 10 data models.

**Phase 2: Dependency Injection & Type Safety** - Integrate lightweight DI container (tsyringe) to eliminate 41 hardcoded factory calls and 6 singleton patterns. Eliminate all 151 `: any` type instances via proper typing and type guards.

**Phase 3: Error Handling & Observability** - Consolidate 222 scattered try-catch blocks into centralized error middleware. Replace 17 console.logs with structured logging (Sentry integration).

**Phase 4: Test Performance & Reliability** - Reduce test suite duration from 13+ minutes to <30 seconds. Fix async handle cleanup. Stabilize 3 known flaky tests.

**Phase 5: Code Organization Cleanup** - Standardize file naming (kebab-case), consolidate root-level files, organize middleware consistently.

**BREAKING**: Service constructors will require dependency injection (DI container handles this). Routes will transition from direct service calls to controller delegation.

## Capabilities

### New Capabilities

- `controller-layer-pattern`: Establish controller layer as orchestration point between routes and services; handle HTTP-specific concerns (validation, response formatting)
- `service-decomposition-large-services`: Break apart 5 largest services (webhook, product, csv-parser, subscription) into focused, <200 line services
- `dependency-injection-container`: Integrate tsyringe DI framework to replace manual instantiation and singleton patterns
- `type-safety-any-elimination`: Eliminate all 151 `: any` type instances via proper typing, type guards, and external API type definitions
- `error-handling-centralization`: Replace 222 scattered try-catch blocks with centralized Express error middleware and custom error hierarchy

### Modified Capabilities

- `database-abstraction-layer`: Expand from 2 repositories to 10 (complete model coverage); formalize repository pattern across all data models
- `streaming-csv-parser`: Extract CSV-specific concerns from product.service into dedicated parser service with focused responsibilities
- `test-suite-hygiene`: Reduce test suite duration from 13+ minutes to <30 seconds; fix async handle leaks; stabilize flaky tests; migrate integration tests to unit tests where feasible

## Impact

**Affected Components**:

- Backend service architecture (29 services → 50+ focused services)
- All 17 route handlers (transition to controller delegation)
- 120+ test suites (refactor for performance; update mocking strategy for DI)
- Error handling across all services
- Logging infrastructure
- Data access patterns (repository abstraction)

**Dependencies**:

- Add: `tsyringe`, `reflect-metadata` (DI framework)
- Refactor: Prisma client initialization, Jest test setup
- No breaking changes to external APIs; all changes are internal architecture

**Developer Experience**:

- Faster feedback loops (test suite <30s vs 13+ minutes)
- Easier debugging (structured logging, centralized error handling)
- Safer refactoring (no `: any` types; proper dependency injection)
- Fewer regressions (better error boundaries, reliable tests)

## CodeScene Findings

The CodeScene reviews show that the regression risk is concentrated in a small number of files rather than being evenly spread across the backend. The biggest production drag comes from large, branch-heavy upload/import and webhook flows, with controller-level leakage on the excess-product path and a smaller type-safety issue in inventory.

| File | Code Health | Key Findings | Why It Slows Production |
| --- | --- | --- | --- |
| [backend/src/services/product.service.ts](backend/src/services/product.service.ts#L405) | 5.23 | `processCSVUploadInternal` cc 33 / 190 LOC; `processXLSXUpload` cc 47 / 185 LOC; deep nesting and complex conditionals | This is the highest-risk slice. Import logic is too entangled to change safely, so CSV/XLSX fixes keep breaking adjacent behavior and require broad test mocking. |
| [backend/src/services/webhook.service.ts](backend/src/services/webhook.service.ts#L260) | 7.42 | `handleSubscriptionCreated` cc 13 / 76 LOC; `handleSubscriptionDeleted` cc 13 / 75 LOC; `validateWebhookMetadata` cc 10 | Billing and subscription callbacks fan out from this file, so each change carries a wide blast radius and makes webhook-related regressions expensive to isolate. |
| [backend/src/services/csv-parser.service.ts](backend/src/services/csv-parser.service.ts#L539) | 7.53 | `parseExpiryRow` cc 22; `parseProductRow` cc 15; `processBatch` 125 LOC with nested branching | This file still mixes parsing, validation, and batch orchestration, which makes row-level failures hard to reason about and slow to fix. |
| [backend/src/controllers/product.controller.ts](backend/src/controllers/product.controller.ts#L266) | 8.63 | `exportExcess` cc 13; duplicated lookup/update/delete patterns | The controller still computes SKU-limit behavior and mixes HTTP orchestration with business rules, which keeps changes from staying local. |
| [backend/src/services/inventory.service.ts](backend/src/services/inventory.service.ts#L180) | 8.65 | `updateInventoryItem` cc 12; complex conditional handling in error and markdown paths | Lower priority than product/webhook/csv, but still a maintenance risk because complex conditionals make inventory behavior harder to verify. |

## Priority Order

1. Refactor `product.service.ts` and `csv-parser.service.ts` first. These are the most complex and the most likely source of repeated upload regressions.
2. Split `webhook.service.ts` second. Billing and subscription events have the highest production blast radius after the import pipeline.
3. Slim `product.controller.ts` third so the excess SKU/export path becomes a thin HTTP adapter instead of a mixed business-rule layer.
4. Finish `inventory.service.ts` by replacing `any` usage and flattening the complex update/error branches.

## Production Failure Modes

- CSV and XLSX uploads fail in hard-to-test ways because parsing, row validation, batch state, and error reporting are all interleaved in `product.service.ts` and `csv-parser.service.ts`.
- Webhook regressions are expensive because the event handlers in `webhook.service.ts` mix verification, transaction coordination, and multiple billing/subscription outcomes in the same call path.
- Excess-product export keeps regressing because `ProductController.exportExcess` still performs limit calculations that belong in a service boundary.
- Inventory changes remain fragile because the service still contains complex conditionals and an `any`-typed Prisma mapping path, which weakens compile-time protection.

## Expected Outcome

- Move the product import slice from a 5.23 Code Health score toward the 9.1 target used by CodeScene's business-case model, which projects roughly 27% to 43% less development time and 31% to 49% fewer defects.
- Move the webhook slice from 7.42 toward the same 9.1 target, which projects roughly 18% to 28% less development time and 26% to 37% fewer defects.
- Keep the controller layer thin enough that future route changes do not need to touch pricing, parser, or persistence logic.
- Remove the remaining type-safety blind spots so schema changes fail fast at compile time instead of leaking into production.
