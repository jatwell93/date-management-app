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
