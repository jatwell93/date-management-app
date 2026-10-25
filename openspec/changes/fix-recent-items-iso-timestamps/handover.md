# Handover: fix-recent-items-iso-timestamps

Updated: 2026-10-25 · main at a09c8655

## State

Tasks 1.1 (#716) and 1.2 (#717) are merged. Task 1.3 done on `feature/factory-fix-recent-items-iso-timestamps-1.3`: `processExpiredItem` returns `transactionDate` as ISO-8601 UTC, with a real-SQL test in `workers/src/database.disposition.pglite.node.test.ts`. Waiting on the owner's merge.

## Next

- 1.4: ISO-8601 timestamps from the credit-claim reads in `workers/src/credit-claim-database.ts`, plus the `parseDbTimestamp` doc comment.

## Open PRs

- Task 1.3 PR (label `factory:fix-recent-items-iso-timestamps`).

## Waiting on the user

- Merge of the task 1.3 PR.

## Learnings

- The pglite harness applies the real migrations, so a query change needs no harness change.
- Run `npm ci --prefix workers` before `npm run test:db` on a fresh checkout.
- The only frontend consumer of the recent-items read is `formatTimestampSafe` (`frontend/src/pages/scan/ScanPageSections.tsx:374`), which reads the new value unchanged.
- The user reads are tested through `createWorkersDatabase` with the pglite-backed `sql`, as the rest of `database.org-audit.pglite.node.test.ts` does.
- To compare against the stored instant in a test, use `extract(epoch FROM col) * 1000`: it reads a naive timestamp as UTC.
