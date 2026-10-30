# Handover: factory-per-change-pr-title

Updated: 2026-10-30 · main at b3bee34e

## State

1.1 is on `feature/factory-pr-title-1-1`. `changeTitle(title, proposal, id)` in `scripts/factory-route.js` builds the finished PR's title. `markReady(pr, n, id)` reads the archived `proposal.md` from the PR branch: `archiveDir` finds `openspec/changes/archive/<date>-<id>`, which `branchArchived` now shares, and `archivedProposal` reads the file through `branchFile` and `missingAsEmpty`. The first letter of the heading is lowercased unless the heading starts with an acronym ("API keys" stays as written). All 8 mutations of `changeTitle` and of the id passed to `markReady` fail the tests.

## Next

2.1, the live check: the next per-change PR that the factory finishes should get the change title, and its squash commit on `main` should use it. It needs 1.1 merged, and it waits until a `pr: per-change` change runs.

## Open PRs

- The 1.1 PR (this branch).

## Waiting on the user

- Merge the 1.1 PR.
