# Handover: factory-per-change-pr

Updated: 2026-10-27 · main at bd56cdd0

## State

1.1 (#729) and 1.2 (this branch, `feature/factory-per-change-1-2`, stacked on #729) are done. 1.3, the live proof, needs 1.2 on `main`, because the factory runs `main`'s workflow and router.

What 1.1 found on draft PRs:

- Required checks: all run. Draft #689 reported every required context.
- CodeScene: runs (it approved #689 as a draft).
- Seer (`sentry[bot]`): skips drafts. Sentry's AI Code Review docs say it reviews a ready PR on every commit and skips drafts. On #724 it reviewed each push.
- Copilot: skips drafts. The `main` ruleset (id 14671588) sets `review_draft_pull_requests: false` and `review_on_push: false`, so Copilot reviews a PR once.

So a per-change PR opens ready, titled `WIP:`.

1.2 design (what to check if 1.3 misbehaves):

- `pr: per-change` is read from `main`'s proposal: `perChangeFromProposal` in `scripts/factory-issue.js`.
- `babysitRoute` hands a per-change PR to `advanceRoute`, then `nextStepRoute` (`scripts/factory-route.js`). It reads the branch's `tasks.md` through the contents API (`branchFile`). `markReady` drops `WIP:` and comments.
- `activeOnly` sends dispatch, resume and retry on a per-change change with an open PR to that PR. `mergedRoute` returns `none` for a per-change merge.
- `scripts/factory-sweep.js` runs hourly in the route job. Only the route job has `actions: write`.
- The run job merges `main` into the branch before a later task, unless main changed `.github/**` or the merge conflicts. In those cases the prompt tells Claude it is working on the older base.
- An owner task escalates with the branch (`factory-escalate.js <id> <task> <branch>`).

## Next

1.3, once #729 and the 1.2 PR merge: write a throwaway two-task change with `pr: per-change`, then `gh workflow run factory.yml -f change_id=<id>`. Watch for: a `WIP:` PR, a second commit on the same branch with `Factory-Task: 1.2`, then `WIP:` dropped and a mention.

## Open PRs

- #729 docs(openspec): record draft-PR bot check (1.1): green, clean.
- 1.2 PR: just opened.

## Waiting on the user

- Merge #729, then the 1.2 PR.
- Copilot on per-change PRs: with `review_on_push: false`, Copilot reviews only the first task. Options: (a) accept that, because Seer reviews every push; (b) turn on "Review new pushes" in the `main` ruleset (more Copilot requests). Recommendation: (a). This does not block 1.3.

## Learnings

- `gh pr ready` is not in the Claude allowlist: the route job marks a PR ready with its own token, and the factory uses `WIP:` titles, not drafts.
- A per-change PR's title edit starts no event, so after `markReady` nothing runs until the owner merges.
