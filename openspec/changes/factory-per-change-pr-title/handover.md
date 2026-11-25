# Handover: factory-per-change-pr-title

Updated: 2026-10-31 · main at e025f034

## State

1.1 merged (#761). `changeTitle(title, proposal, id)` in `scripts/factory-route.js` builds the finished PR's title. `markReady(pr, n, id)` reads the archived `proposal.md` from the PR branch: `archiveDir` finds `openspec/changes/archive/<date>-<id>`, which `branchArchived` shares, and `archivedProposal` reads the file through `branchFile` and `missingAsEmpty`. Copilot did not review #761 (the review quota had run out).

## Decisions

- 2026-10-31: the owner chose to check 2.1 on the next real `pr: per-change` change rather than run a throwaway proof.

## Next

2.1 waits for the next real change whose `## Autonomy` block says `pr: per-change`. When the factory marks its PR ready, check the PR title, and after the owner's merge check the squash commit on `main`. Then tick 2.1 and archive this change.

## Open PRs

- None.

## Waiting on the user

- Nothing. 2.1 waits for a `pr: per-change` change to run.
