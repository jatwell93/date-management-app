# Handover: fix-recent-items-iso-timestamps

Updated: 2026-10-25 · main at 64ab16fa

## State

Task 1.1 done on `feature/factory-fix-recent-items-iso-timestamps-1.1`: `findRecentInventoryItemsByProductId` returns `createdAt` as ISO-8601 UTC, with a real-SQL format test. Waiting on the owner's merge.

## Next

- 1.2: ISO-8601 `createdAt` from `listUsers`, the role-change read and the user-create read.

## Open PRs

- Task 1.1 PR (label `factory:fix-recent-items-iso-timestamps`).

## Waiting on the user

- Merge of the task 1.1 PR.

## Learnings

- The pglite harness applies the real migrations, so a query change needs no harness change.
- Run `npm ci --prefix workers` before `npm run test:db` on a fresh checkout.
- The only frontend consumer is `formatTimestampSafe` (`frontend/src/pages/scan/ScanPageSections.tsx:374`), which reads the new value unchanged.
