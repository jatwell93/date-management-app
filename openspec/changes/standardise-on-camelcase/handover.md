# Handover: standardise-on-camelcase

Updated: 2026-11-01 · main at 00946b7e

## State

Task 1.1 is done on branch `feature/factory-standardise-on-camelcase-1.1` (the per-change PR, opened as `WIP:`). Inventory item create reads only `productId`, `expiryDate` and `locationId` (`workers/src/index-minimal.ts`, `handleCreateInventoryItem`). `workers/src/utils/inventory-field-mapping.ts` and its test `workers/src/__tests__/api-contract-compatibility.test.ts` are deleted. Rejection and ignoring are asserted in `workers/src/inventory-item-handlers.test.ts` (`POST /api/inventory-items`).

## Next

Task 2.1: store area create/update and walk check create in `workers/src/index-minimal.ts` (grep `sub_department`, `parent_id`, `store_area_id`, `checked_at`, `items_added_count`).

## Open PRs

- The per-change PR for this change: opened with task 1.1; checks pending.

## Waiting on the user

Nothing.

## Learnings

- `.claude/` files are marked skip-worktree in the runner checkout; read them with `git show HEAD:<path>`.
- Run a single Worker test with `npm run test:workers:integration --prefix workers -- <name-filter>`; `workers/node_modules` needs `npm ci --prefix workers` first.
- The frontend contract test (`frontend/src/tests/api-contract-compatibility.test.ts`) still accepts snake_case: task 3.1.
