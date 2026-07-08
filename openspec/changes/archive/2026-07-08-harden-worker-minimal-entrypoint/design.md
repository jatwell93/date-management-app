## Context

The minimal Worker entrypoint intentionally avoids importing the backend Express adapter and runs native Worker `Request`/`Response` flows. Existing Worker modules under `workers/src/handlers`, `workers/src/middleware`, and `workers/src/utils` provide useful patterns, but the entrypoint-specific CORS, compression, rate-limit, and upload completion behavior must be extracted without changing public routes or upload processing semantics.

## Goals / Non-Goals

**Goals:**

- Reduce `workers/src/index-minimal.ts` complexity by moving cohesive Worker-only logic into focused modules.
- Preserve native Worker behavior for CORS, JSON/error responses, gzip `encodeBody: manual`, rate-limit KV/fallback behavior, upload completion queueing, synchronous upload processing, and catalogue import summaries.
- Keep each extracted helper directly testable without global request-scoped state.

**Non-Goals:**

- No API contract changes.
- No Clerk bootstrap or webhook module extraction in this pass.
- No replacement of Worker bindings with REST calls.
- No new data model, migration, or deployment setting changes.

## Decisions

- Extract Worker helpers into `workers/src/utils` and upload logic into `workers/src/upload` rather than backend or Express middleware. The minimal Worker does not use Express request/response objects, so backend middleware reuse would add adapter coupling and risk behavior drift.
- Keep queue dispatch explicitly awaited or passed through the existing `ctx.waitUntil` pattern where already used. This follows Cloudflare guidance to avoid floating promises and keeps critical upload completion behavior observable.
- Add characterization tests before moving code. Refactoring a high-churn Worker entrypoint needs behavior lock-in for recent fixes such as CORS-on-errors, manual gzip, upload summary metadata, and R2 head/get races.
- Use a route table/helper for fetch dispatch, not a framework. The route set is fixed and native Worker dispatch keeps bundle size and cold-start risk low.

## Risks / Trade-offs

- Extraction can accidentally change response headers or status codes -> mitigate with targeted characterization tests before production code edits.
- Upload completion branches are tightly coupled to Env bindings and R2 metadata -> mitigate by splitting parse/auth/queue/sync helpers and using existing test env stubs.
- Moving code may expose circular imports from `index-minimal.ts` -> mitigate by moving shared types/constants with the extracted modules and keeping imports one-way into the entrypoint.
- CodeScene validation may require external service access through Doppler -> keep local verification complete and leave Doppler CodeScene as an operator-run gate if escalation is not approved.
