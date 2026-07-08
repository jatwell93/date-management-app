# Proposal: Fix Organization Usage Timestamp Insert

## Analysis

**Current**: `workers/src/index-minimal.ts`

- Production now routes `GET /api/organization/usage` to the minimal Worker handler.
- The handler creates a default `organization_usage` row when one does not exist, but the insert omits `created_at` and `updated_at`.
- The production PostgreSQL schema marks `organization_usage.updated_at` as NOT NULL, so first-time usage reads throw before the Worker can return a JSON response.

**Affected**: `workers/src/minimal-api-routes.test.ts`, `workers/src/index-minimal.ts`

- Existing Worker route tests cover the response shape but do not assert the insert satisfies timestamp columns.
- Express already delegates usage creation to `SubscriptionRepository.getOrCreateUsage()` and is not the production failure path.

## Reuse Strategy

- Extend the existing minimal Worker handler in `workers/src/index-minimal.ts`; production uses this entrypoint.
- Reuse the existing authenticated route test helper in `workers/src/minimal-api-routes.test.ts`.
- Do not add schema changes, a parallel repository, or production mock data.

## Implementation Steps

1. Add a failing Worker regression test proving default `organization_usage` creation includes required timestamp columns.
2. Update the Worker insert to supply `created_at` and `updated_at` with `NOW()`.
3. Run focused Worker tests, typecheck/build verification, OpenSpec validation, and record memory.
