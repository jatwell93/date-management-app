# Proposal: Extract Worker Clerk and Catalogue Import Logic

## Analysis

**Current**: `workers/src/index-minimal.ts`

- Minimal Worker entrypoint still owns high-complexity Clerk bootstrap/webhook handling around `handleOrganizationBootstrap`, `handleClerkWebhook`, `processClerkWebhookEvent`, and related persistence helpers.
- Minimal Worker entrypoint also owns catalogue import processing around `processCatalogueImportJob`, `upsertProductBatch`, stored upload processing, and synchronous product import helpers.
- Existing Worker upload modules already provide the right destination pattern: `workers/src/upload/catalogue-import.ts`, `workers/src/upload/upload-handlers.ts`, and `workers/src/upload/upload-router.ts`.

**Affected**: `workers/src/index-minimal.ts`, `workers/src/clerk/*`, `workers/src/upload/*`, `workers/src/health.test.ts`, `workers/src/__tests__/catalogue-import-upsert.node.test.ts`, `workers/src/upload/upload-router.test.ts`

**Pattern**: Preserve native Worker `Request`/`Response`, `Env`, R2, Queue, and database bindings. Keep `index-minimal.ts` as route orchestration only.

## Reuse Strategy

- Extend `workers/src/upload/catalogue-import.ts` instead of creating a parallel catalogue pipeline.
- Keep upload completion helpers in `workers/src/upload/upload-handlers.ts` and move only cohesive upload-processing internals there.
- Create a focused `workers/src/clerk/` module set because no Worker Clerk module currently owns Svix verification, bootstrap orchestration, or webhook event dispatch.
- Reuse existing Worker response helpers from `workers/src/utils/worker-response.ts` for all extracted handlers.
- Reuse existing characterization coverage in `workers/src/health.test.ts` and `workers/src/__tests__/catalogue-import-upsert.node.test.ts` before moving code.

## Implementation Steps

1. Add characterization tests for Clerk bootstrap/webhook behavior and upload router dispatch.
2. Extract Clerk Svix signature helpers and webhook event persistence into Worker Clerk modules.
3. Extract organization bootstrap and webhook request handlers into Worker Clerk modules.
4. Move catalogue import job processing and product batch upsert into `workers/src/upload/catalogue-import.ts`.
5. Move synchronous stored upload processing into `workers/src/upload/upload-handlers.ts`.
6. Simplify upload route dispatch with table-driven route matching while preserving exact responses.
7. Re-run Workers tests, build, lint, and OpenSpec validation.

