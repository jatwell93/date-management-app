# Handover: fix-recent-items-iso-timestamps

Updated: 2026-10-25 · main at 52cf4021

## State

Tasks 1.1 (#716), 1.2 (#717), 1.3 (#718) and 1.4 (#719) are merged. Task 1.5 done on `feature/factory-fix-recent-items-iso-timestamps-1.5`: `workers/src/no-text-timestamp-casts.node.test.ts` fails on any non-comment `_at::text`, `transaction_date::text` or `trial_end_date::text` under `workers/src`, except the three exempt `trial_end_date::text` lines (matched by file and count). Checked that it fails when a cast is added back. Waiting on the owner's merge. Every task is now ticked.

## Next

- After the 1.5 PR merges: the owner archives the change (`openspec archive fix-recent-items-iso-timestamps --yes`).

## Open PRs

- Task 1.5 PR (label `factory:fix-recent-items-iso-timestamps`).

## Waiting on the user

- Merge of the task 1.5 PR, then archive.

## Learnings

- The pglite harness applies the real migrations, so a query change needs no harness change.
- Run `npm ci --prefix workers` before `npm run test:db` on a fresh checkout.
- The only frontend consumer of the recent-items read is `formatTimestampSafe` (`frontend/src/pages/scan/ScanPageSections.tsx:374`), which reads the new value unchanged.
- To compare against the stored instant in a test, use `extract(epoch FROM col) * 1000`: it reads a naive timestamp as UTC.
- The static cast test counts lines, so a second cast on an exempt line is not caught; keep one cast per line.
