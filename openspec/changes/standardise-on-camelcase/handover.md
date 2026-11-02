# Handover: standardise-on-camelcase

Updated: 2026-11-02 · main at 00946b7e

## State

Tasks 1.1 and 2.1 are done on branch `feature/factory-standardise-on-camelcase-1.1` (the per-change PR #772, `WIP:`). Inventory item create reads only `productId`, `expiryDate` and `locationId`. Store area create/update read only `subDepartment` and `parentId`; walk check create (`handleRecordBayCheck`) reads only `storeAreaId`, `checkedAt` and `itemsAddedCount` (`workers/src/index-minimal.ts`). Rejection and ignoring are asserted in `workers/src/store-area-handlers.test.ts`.

## Next

Task 3.1: the frontend contract test `frontend/src/tests/api-contract-compatibility.test.ts` must reject snake_case and match the Worker contract.

## Open PRs

- #772, the per-change PR for this change: checks pending after task 2.1.

## Waiting on the user

Nothing.

## Learnings

- `.claude/` files are marked skip-worktree in the runner checkout; read them with `git show HEAD:<path>`.
- Run a single Worker test with `npm run test:workers:integration --prefix workers -- <name-filter>`; `workers/node_modules` needs `npm ci --prefix workers` first.
- Run `npx prettier --write` on touched Worker files before pushing: CI's `Check formatting` step failed PR #772 once on a test file.
- The frontend contract test (`frontend/src/tests/api-contract-compatibility.test.ts`) still accepts snake_case: task 3.1.
