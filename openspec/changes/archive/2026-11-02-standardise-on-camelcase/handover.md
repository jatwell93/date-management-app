# Handover: standardise-on-camelcase

Updated: 2026-11-02 · main at 00946b7e

## State

Tasks 1.1, 2.1 and 3.1 are done on branch `feature/factory-standardise-on-camelcase-1.1` (the per-change PR #772, `WIP:`). Inventory item create reads only `productId`, `expiryDate` and `locationId`. Store area create/update read only `subDepartment` and `parentId`; walk check create (`handleRecordBayCheck`) reads only `storeAreaId`, `checkedAt` and `itemsAddedCount` (`workers/src/index-minimal.ts`). Rejection and ignoring are asserted in `workers/src/store-area-handlers.test.ts`. The frontend contract test `frontend/src/tests/api-contract-compatibility.test.ts` now asserts a snake_case-only body is rejected and snake_case next to camelCase is ignored.

## Next

No unchecked task is left: the next run archives the change.

## Open PRs

- #772, the per-change PR for this change: checks pending after task 3.1.

## Waiting on the user

Nothing.

## Learnings

- `.claude/` files are marked skip-worktree in the runner checkout; read them with `git show HEAD:<path>`.
- Run a single Worker test with `npm run test:workers:integration --prefix workers -- <name-filter>`; `workers/node_modules` needs `npm ci --prefix workers` first. The frontend gate needs `npm ci --prefix frontend` first.
- Run `npx prettier --write` on touched files before pushing: CI's `Check formatting` step failed PR #772 once on a test file.
- The frontend contract test mocks `apiService`, so its snake_case rejection case uses a mock that mirrors the Worker (reads `productId` only).
