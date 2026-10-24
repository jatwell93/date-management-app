# Handover: factory-one-merge-per-change

Updated: 2026-10-24 · branched from `feature/archive-add-spec-factory-runner` (#709)

## State

Proposal only. Phase 5 of the factory; phases 0 to 4 are `add-spec-factory-runner`, archived in #709.

## Next

5.1 (owner tasks), in an interactive session: it edits `scripts/factory-route.js`, `factory.yml` and `run-spec`, all `no_go` paths.

## Open PRs

- #709 archives `add-spec-factory-runner`. This branch is stacked on it; after #709 merges, merge `origin/main` into this branch (no rebase) before merging this proposal.

## Waiting on the user

- Merge #709, then approve this proposal.
- Pick the change for 5.2.

## Learnings

- No GitHub event fires when `pr-feedback.js`'s quiet window ends, so anything that waits for "settled" needs a schedule (the hourly sweep), not an event.
