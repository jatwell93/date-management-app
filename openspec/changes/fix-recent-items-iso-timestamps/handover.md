# Handover: fix-recent-items-iso-timestamps

Updated: 2026-10-25 · main at 96432b25

## State

Task 1.1 is merged (#716). Task 1.2 done on `feature/factory-fix-recent-items-iso-timestamps-1.2`: `listUsers`, the role-change read and the user-create read return `createdAt` as ISO-8601 UTC, with one real-SQL test per read in `workers/src/database.org-audit.pglite.node.test.ts`. Waiting on the owner's merge.

## Next

- 1.3: ISO-8601 `transactionDate` from the expired-item transaction write.

## Open PRs

- Task 1.2 PR (label `factory:fix-recent-items-iso-timestamps`).

## Waiting on the user

- Merge of the task 1.2 PR.

## Learnings

- The pglite harness applies the real migrations, so a query change needs no harness change.
- Run `npm ci --prefix workers` before `npm run test:db` on a fresh checkout.
- The only frontend consumer of the recent-items read is `formatTimestampSafe` (`frontend/src/pages/scan/ScanPageSections.tsx:374`), which reads the new value unchanged.
- The user reads are tested through `createWorkersDatabase` with the pglite-backed `sql`, as the rest of `database.org-audit.pglite.node.test.ts` does.
