# Handover: fix-recent-items-iso-timestamps

Updated: 2026-10-26 · main at 1b1b9ce0

## State

Proposal written for #672. No task started. This is the first real product change for the factory (task 5.2 of `factory-one-merge-per-change`).

## Next

- 1.1: ISO-8601 `createdAt` from `findRecentInventoryItemsByProductId`.

## Open PRs

- None.

## Waiting on the user

- Nothing.

## Learnings

- The pglite harness applies the real migrations, so a query change needs no harness change.
