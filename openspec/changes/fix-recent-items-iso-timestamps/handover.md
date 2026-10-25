# Handover: fix-recent-items-iso-timestamps

Updated: 2026-10-25 · main at 75b05374

## State

Tasks 1.1 (#716), 1.2 (#717) and 1.3 (#718) are merged. Task 1.4 done on `feature/factory-fix-recent-items-iso-timestamps-1.4`: the credit-claim reads in `workers/src/credit-claim-database.ts` return `sentAt`, `nextFollowUpAt`, `settledAt`, `supplier_policy_updated_at` and the events' `createdAt` as ISO-8601 UTC, with a real-SQL test and a `parseDbTimestamp` case for the `...Z` shape in `workers/src/database.credit-claim-write.pglite.node.test.ts`. The `parseDbTimestamp` doc comment is rewritten. Waiting on the owner's merge.

## Next

- 1.5: static test that fails on `_at::text`, `transaction_date::text` or `trial_end_date::text` in non-comment lines under `workers/src` (with the two `trial_end_date::text` exemptions), then comment on #672 with the PR links.

## Open PRs

- Task 1.4 PR (label `factory:fix-recent-items-iso-timestamps`).

## Waiting on the user

- Merge of the task 1.4 PR.

## Learnings

- The pglite harness applies the real migrations, so a query change needs no harness change.
- Run `npm ci --prefix workers` before `npm run test:db` on a fresh checkout.
- The only frontend consumer of the recent-items read is `formatTimestampSafe` (`frontend/src/pages/scan/ScanPageSections.tsx:374`), which reads the new value unchanged.
- The user reads are tested through `createWorkersDatabase` with the pglite-backed `sql`, as the rest of `database.org-audit.pglite.node.test.ts` does.
- To compare against the stored instant in a test, use `extract(epoch FROM col) * 1000`: it reads a naive timestamp as UTC.
- `supplier.policyUpdatedAt` is typed `string | Date | null`, so a format test must widen its tuple type to pass the workers typecheck.
