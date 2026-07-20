# Proposal: Fix Subscription Settings 404s

## Analysis

**Current**: `workers/src/index-minimal.ts`

- Production deploys the minimal Worker route table, which currently registers `/api/subscription/trial-status` but not the frontend subscription settings reads.
- The `/subscription` frontend calls `GET /api/subscription/current` and `GET /api/organization/usage`, so the minimal Worker returns route-not-found 404s before auth or DB logic runs.
- Existing Worker auth and database helpers should be reused through `authenticateApiRequest`, `createWorkersDatabase`, and the existing subscription/usage tables.

**Affected**: `workers/src/minimal-api-routes.test.ts`, `workers/src/workers-deployment.test.ts`, `workers/src/index-minimal.ts`

- Prior expired-loss work already added route-table and build-artifact smoke coverage for production route drift. This change extends that pattern for subscription settings routes.

**Affected**: `backend/src/routes/subscription.routes.ts`, `backend/src/controllers/subscription.controller.ts`, `backend/src/repositories/subscription.repository.ts`, `backend/src/tests/unit/subscription.routes.test.ts`

- Express has `GET /subscription/trial-status` but lacks `GET /subscription/current`.
- Subscription data access already lives in `SubscriptionRepository`; the controller should stay thin and delegate current-subscription and usage lookups there.

## Reuse Strategy

- Extend `workers/src/index-minimal.ts` rather than creating a new Worker router because production uses this entrypoint.
- Extend `backend/src/routes/subscription.routes.ts` and `backend/src/controllers/subscription.controller.ts`; do not add a parallel controller or service layer.
- Reuse `SubscriptionRepository.getOrCreateUsage()` for Express organization usage and add only focused repository read helpers if current behavior is not already exposed.
- Reuse shared subscription tier limit semantics; no schema, migration, mock production data, or new persistence layer is required.

## Implementation Steps

1. Add failing Worker route-table, handler, unauthenticated smoke, and build-artifact route-string tests for `GET /api/subscription/current` and `GET /api/organization/usage`.
2. Add failing backend route tests for `GET /subscription/current` and `GET /organization/usage` using the existing DI/test app pattern.
3. Implement Worker handlers that authenticate requests, scope by `auth.organizationId`, query subscription/usage tables, and return frontend-compatible shapes.
4. Implement Express parity by extending subscription routes/controller and the existing organization-mounted route surface while keeping controllers thin.
5. Validate OpenSpec and run focused Worker/backend verification commands.
