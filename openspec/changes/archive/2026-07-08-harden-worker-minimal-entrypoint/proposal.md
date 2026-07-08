## Why

`workers/src/index-minimal.ts` has accumulated routing, response shaping, rate limiting, upload completion, and catalogue import logic in one high-churn entrypoint. This change reduces entrypoint complexity while preserving the current Worker behavior that recent upload, CORS, compression, and authorization fixes depend on.

## What Changes

- Add characterization coverage around the current minimal Worker entrypoint for routing, CORS-on-error responses, rate-limit headers, upload completion queue/sync paths, and R2 object disappearance cases.
- Extract native Worker response helpers, rate limiting, upload routing, upload completion handlers, and catalogue parsing/import helpers into focused modules under existing `workers/src` structure.
- Replace the inline API route decision block in the fetch handler with a small route table/helper that preserves all existing paths and methods.
- Keep Clerk bootstrap and webhook extraction out of scope for this pass unless this refactor does not sufficiently reduce entrypoint complexity.

## Capabilities

### New Capabilities

- `cloudflare-workers-api`: Documents the behavior-preservation contract for the minimal Cloudflare Worker API entrypoint during complexity remediation.

### Modified Capabilities

None. Existing API behavior must remain unchanged.

## Impact

- Affected code: `workers/src/index-minimal.ts`, new focused Worker utility/upload modules under `workers/src/utils` and `workers/src/upload`, and existing Worker test files.
- APIs: No route, response-shape, queue, upload, or catalogue import contract changes.
- Dependencies: No new runtime dependencies.
