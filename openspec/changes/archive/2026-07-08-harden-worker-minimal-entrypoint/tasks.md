## 1. Characterization

- [x] 1.1 Review Worker module docs, existing handlers/middleware/utils, and current `index-minimal.ts` upload/routing/response sections for reuse boundaries.
- [x] 1.2 Add failing characterization tests for Worker fetch routing, CORS-on-error responses, rate-limit headers, upload queue completion, sync completion, and missing/disappearing R2 object behavior.

## 2. Extraction

- [x] 2.1 Extract CORS, JSON/error response, compression, `Vary`, and final response wrapping helpers to `workers/src/utils/worker-response.ts`.
- [x] 2.2 Extract rate limiting to `workers/src/utils/minimal-rate-limit.ts` with unchanged KV and in-memory fallback behavior.
- [x] 2.3 Extract upload route dispatch to `workers/src/upload/upload-router.ts`.
- [x] 2.4 Extract upload completion, catalogue import, catalogue parsing, and CSV parsing logic to focused `workers/src/upload/*` modules.
- [x] 2.5 Split upload completion into parse, auth/ownership, queue, and sync-processing helpers with direct test seams.
- [x] 2.6 Replace inline API route dispatch in fetch with a route table/helper while preserving existing paths and methods.

## 3. Verification

- [x] 3.1 Run targeted Worker tests for health and authorized-party coverage.
- [x] 3.2 Run Worker type build.
- [x] 3.3 Run real SQL Worker tests or record the exact blocker.
- [x] 3.4 Validate OpenSpec change and update project memory for the completed refactor pattern.
