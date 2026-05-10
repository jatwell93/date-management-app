## Context

The backend has grown into a large Express/TypeScript system with substantial functional breadth but weak architectural boundaries. Routes often reach directly into services, services frequently compose other services ad hoc, and data access remains embedded in business logic. The result is a codebase that is hard to change safely, slow to test, and prone to regressions when behavior spans multiple concerns.

The remediation work is intentionally cross-cutting. It touches HTTP handling, business logic, persistence, error handling, logging, and tests. The existing application already supports multiple environments and database providers, so the design must preserve runtime behavior while reducing coupling and improving determinism.

Primary stakeholders are backend developers, test maintainers, and anyone shipping route or service changes. The design also needs to respect the current production surface: external API contracts should remain stable while internal structure changes.

## Goals / Non-Goals

**Goals:**

- Introduce a consistent controller layer between routes and services.
- Break oversized services into focused units with clear responsibility boundaries.
- Centralize persistence behind repositories and reduce direct Prisma access in services.
- Replace manual service wiring and singleton-style initialization with explicit dependency injection.
- Remove unsafe `any` usage from production code where practical.
- Consolidate error handling and logging so failures are observable and consistent.
- Reduce test runtime and stabilize async behavior so local feedback is usable again.

**Non-Goals:**

- Rewriting the backend into a different framework.
- Changing external API shapes unless a hidden bug forces a compatible fix.
- Replacing Prisma or the database providers.
- Reworking frontend UX as part of this change.
- Optimizing every service equally; the first pass focuses on the highest-risk, highest-cost areas.

## Decisions

### 1. Introduce controllers as the HTTP orchestration layer

Routes will become thin adapters that bind URL structure to controller methods. Controllers will own request parsing, validation coordination, HTTP status selection, and response shaping. Business logic stays in services.

Alternatives considered:

- Keep routes calling services directly. Rejected because it preserves the current leakage of HTTP concerns into business code.
- Put more logic in middleware. Rejected because middleware is best for cross-cutting concerns, not domain orchestration.

Why this choice: it creates the smallest meaningful boundary that makes route code predictable without forcing a framework rewrite.

### 2. Split large services by responsibility, not by file count

The biggest services will be decomposed along stable responsibility seams: webhook verification vs event dispatch, CSV detection vs parsing vs transformation, subscription state vs access control, and product CRUD vs import/validation. The target is not simply smaller files; it is lower coupling and testable units.

Alternatives considered:

- Split every service immediately. Rejected because it maximizes churn and introduces avoidable merge risk.
- Leave large services intact and add helper functions. Rejected because it does not address dependency entanglement.

Why this choice: the current service shapes show clear responsibility clusters, so decomposition can follow existing behavior rather than inventing new abstractions.

### 3. Use repositories for persistence access, with a thin service-to-repository boundary

Each domain area that currently mixes queries with business logic will move query logic into repositories. Services will depend on repositories for data retrieval and mutation, keeping business rules separate from persistence details.

Alternatives considered:

- Keep Prisma in services and add helper wrappers. Rejected because query logic remains scattered and hard to mock.
- Introduce a generic repository abstraction for every model. Rejected because overly generic repositories tend to hide useful domain-specific operations.

Why this choice: it preserves Prisma while restoring a predictable shape for persistence logic.

### 4. Adopt lightweight dependency injection with a composition root

The design uses a small DI container rather than a hand-rolled service locator or a heavy framework. A single composition root will register the database client, repositories, services, and controllers. Constructors should declare dependencies explicitly; default self-wiring should be removed where it obscures testability.

Alternatives considered:

- Continue with optional constructor args plus internal fallbacks. Rejected because that keeps hidden default wiring and singleton pressure.
- Use a heavier enterprise DI framework. Rejected because the application does not need the complexity.

Why this choice: the system needs predictable object graphs more than advanced DI features.

### 5. Replace `any` with typed external boundaries and guarded unknowns

Payloads from third-party systems and loose parsers will be represented with explicit interfaces, union types, or `unknown` plus guards. `any` is only acceptable as a last-resort compatibility shim during migration, and only in isolated adapter code.

Alternatives considered:

- Leave `any` where runtime behavior already works. Rejected because it prevents the compiler from helping with refactors.
- Overfit every external payload into one mega-type. Rejected because it creates a brittle pseudo-schema that is hard to maintain.

Why this choice: typed boundaries preserve safety without pretending all external inputs are trustworthy.

### 6. Centralize error handling and logging

Services should throw domain or validation errors rather than converting everything into local catch blocks. Controllers and global middleware will translate errors into HTTP responses. Logging should be structured and centralized, with console usage limited to test or bootstrap contexts.

Alternatives considered:

- Keep try-catch in every service. Rejected because it duplicates response mapping and swallows context.
- Log and rethrow everywhere. Rejected because it produces noise and does not standardize behavior.

Why this choice: one error pipeline is easier to reason about and easier to test.

### 7. Make test determinism a design constraint, not a cleanup task

The test suite will be optimized by reducing hidden async work, eliminating open handles, and pushing more behavior into fast unit tests. Shared infrastructure should be explicit and closed in setup/teardown. Integration tests remain valuable, but only for boundaries that truly require them.

Alternatives considered:

- Increase Jest timeouts. Rejected because it masks the underlying instability.
- Keep broad integration coverage and accept the runtime. Rejected because the feedback loop is already too slow.

Why this choice: the current 13+ minute coverage run is itself a productivity bug.

## Risks / Trade-offs

- [Large refactor surface] → Use incremental extraction, keep public route contracts stable, and land controller/service/repository changes in small batches.
- [DI wiring mistakes] → Keep a single composition root and cover it with targeted smoke tests before broad rollout.
- [Circular dependency regressions] → Establish dependency direction rules early: routes depend on controllers, controllers depend on services, services depend on repositories, repositories depend on Prisma.
- [Over-splitting services] → Preserve cohesive boundaries and avoid creating one-file abstractions that only proxy calls.
- [Test churn during refactor] → Convert the highest-value tests first, then backfill focused regression tests around the moved seams.
- [Type migration friction] → Allow temporary adapter-layer typing for third-party payloads, but track and retire `any` usage as part of the change.

## Migration Plan

1. Add the controller layer for the highest-traffic route groups first so the route-to-controller pattern is established early.
2. Split the largest and most fragile services next, starting with areas already coupled to multiple concerns such as webhook processing, subscription management, and CSV parsing.
3. Introduce repositories in parallel for the models that are already strongly isolated, then migrate the services that currently embed the most query logic.
4. Add the DI composition root and convert constructors to explicit injection once the primary service graph is stable.
5. Replace error handling and logging after controller/service boundaries are in place so the new exception flow is not immediately reworked.
6. Refactor tests alongside each code slice, prioritizing the suites that currently time out or rely on open handles.

Rollback strategy:

- Keep route contracts unchanged during migration so individual slices can be reverted without API changes.
- Land each major slice behind focused test coverage before moving on to the next layer.
- If DI wiring introduces instability, temporarily keep a narrow factory path for a single slice while the rest of the architecture remains migrated.

## Detailed Wave Plan

### Wave 1: Product Import and CSV Parsing

The product import path is the highest-risk area in the current CodeScene data. `processCSVUploadInternal` and `processXLSXUpload` both combine file-format detection, row validation, duplicate handling, batch accounting, and response shaping. The first pass should extract pure row-level helpers and then isolate batch orchestration so that file parsing failures no longer share the same control path as persistence.

Recommended sequence:

1. Extract pure mappers for product rows and expiry rows so the parsing logic returns normalized values instead of mutating upload state inline.
2. Move file-format detection and worksheet selection into a small dispatcher that chooses the parser, not the import workflow.
3. Keep row validation and batch coordination in a dedicated orchestration service with explicit inputs and outputs.
4. Preserve the current success, partial-failure, and error payload shapes until the new test coverage is in place.

Validation targets:

- malformed header and missing-column rejection
- duplicate SKU and barcode detection
- CSV/XLSX parity for success cases
- row-level rejection behavior for expiry imports
- unchanged import summary counts and error arrays

### Wave 2: Webhook Lifecycle

The webhook service has already had repository access cleaned up, but the event handlers are still too dense. `handleSubscriptionCreated`, `handleSubscriptionDeleted`, `handlePaymentIntentSucceeded`, `handlePaymentIntentFailed`, `handleCreationLock`, and `validateWebhookMetadata` should be separated by event family so the side effects, status transitions, and idempotency checks can be reasoned about independently.

Recommended sequence:

1. Extract metadata validation into one helper that only validates request context and returns a typed metadata object.
2. Split subscription creation and deletion into separate handlers with shared transaction helpers.
3. Split payment success and payment failure into dedicated event handlers so lock handling and billing state changes are not interleaved.
4. Keep idempotency and creation-lock logic in small shared helpers that are called by the event handlers instead of embedded inside them.

Validation targets:

- missing metadata rejection
- duplicate event replay rejection
- creation-lock enforcement
- subscription status transition coverage
- payment failure and payment success replay coverage

### Wave 3: Excess-Product Export

`ProductController.exportExcess` still performs business-rule math that belongs in the service layer. The controller should only resolve request context, ask a service for an excess-product view model, and serialize JSON or CSV. Moving the SKU-limit logic out of the controller will make the API easier to test and reduce future regressions when tier rules change.

Recommended sequence:

1. Move SKU-limit and excess-count calculations into a service method that accepts organization context and returns a structured export model.
2. Move CSV row formatting into a dedicated serializer so the controller no longer owns export formatting.
3. Keep the controller as a thin adapter that chooses response format and delegates all domain logic.
4. Preserve the current JSON and CSV response payloads for unlimited tiers, within-limit tiers, and over-limit tiers.

Validation targets:

- unlimited tier returns zero excess products
- within-limit organizations return the current limit metadata without product rows
- over-limit organizations return the same counts and row shape as today
- JSON and CSV export output stays contract-compatible

### Wave 4: Inventory Hardening

Inventory is lower risk than the import and webhook paths, but it still has type-safety and branch-complexity problems. The remaining `any`-typed Prisma mapping path should be replaced with a concrete payload type, and the update/error branches should be flattened into named helpers so schema drift is visible at compile time.

Recommended sequence:

1. Replace the `any` mapping with a Prisma payload type or a guarded adapter type that matches the generated schema.
2. Extract markdown and update-condition checks into named helpers so the update method stays short.
3. Keep error translation centralized so HTTP status mapping stays unchanged.
4. Add a narrow regression test that fails on schema drift or bad payload mapping.

Validation targets:

- `tsc` or backend type-check passes after the type change
- inventory update and markdown edge cases keep the same status mapping
- schema-sensitive mapping fails in compile-time checks instead of at runtime

## Recommended Answers to Open Questions

- Migrate the most entangled service areas first: product import, CSV parsing, and webhook processing. They have the highest regression cost and the strongest CodeScene evidence.
- Roll out repositories in the same order as service decomposition so each new repository immediately backs a reduced service surface.
- Formalize DTOs now for row import and webhook payload boundaries, then defer broader DTO cleanup until the service splits are complete.
- Keep long-running integration coverage for cross-tenant boundaries, webhook idempotency, and upload pipelines; move the rest toward targeted unit tests and focused regression tests.

## Open Questions

- Which route groups should be migrated first: the highest-traffic user flows, or the most entangled service areas?
- Should repository rollout happen strictly by domain model, or by the order in which services are decomposed?
- Do we want to formalize controller return types and DTOs in the first pass, or defer that until the service split is complete?
- Are there any long-running integration tests that should remain as end-to-end coverage even after unit test migration?
