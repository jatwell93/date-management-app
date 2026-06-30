## 1. Tests First

- [x] 1.1 Add Clerk characterization coverage for bootstrap invalid/missing auth and webhook missing/invalid/idempotent cases.
- [x] 1.2 Add upload-router characterization coverage before table-driven simplification.
- [x] 1.3 Verify new/changed tests fail for the expected missing extracted APIs or behavior lock.

## 2. Clerk Extraction

- [x] 2.1 Extract Clerk signature verification helpers into `workers/src/clerk/webhook-signature.ts`.
- [x] 2.2 Extract Clerk organization/user/trial persistence helpers into `workers/src/clerk/clerk-persistence.ts`.
- [x] 2.3 Extract webhook event dispatch and request handling into `workers/src/clerk/webhook-handler.ts`.
- [x] 2.4 Extract organization bootstrap handler into `workers/src/clerk/bootstrap-handler.ts`.
- [x] 2.5 Update `workers/src/index-minimal.ts` to import Clerk handlers and keep public routes unchanged.

## 3. Catalogue Extraction

- [x] 3.1 Move queued catalogue import job processing into `workers/src/upload/catalogue-import.ts`.
- [x] 3.2 Move synchronous stored upload processing into `workers/src/upload/upload-handlers.ts`.
- [x] 3.3 Update `workers/src/index-minimal.ts` and catalogue tests to import moved upload functions.

## 4. Light Simplification

- [x] 4.1 Table-drive repetitive upload route dispatch in `workers/src/upload/upload-router.ts`.
- [x] 4.2 Keep parser/rate-limit modules unchanged unless a small behavior-preserving simplification is obvious under existing tests.

## 5. Verification

- [x] 5.1 Run `npm run test --prefix workers`.
- [x] 5.2 Run `npm run test:db --prefix workers -- --maxWorkers=1` after the default parallel run timed out starting multiple pglite harnesses.
- [x] 5.3 Run `npm run build --prefix workers`.
- [x] 5.4 Run `npm run lint`.
- [x] 5.5 Run `openspec validate extract-worker-clerk-catalogue-import --strict`; `openspec validate --all` still fails on unrelated active changes.
