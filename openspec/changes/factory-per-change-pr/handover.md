# Handover: factory-per-change-pr

Updated: 2026-10-28 · main at b65d3d93

## State

1.1 (#729) and 1.2 (#730) are merged. 1.3, the live proof, is in progress (see below).

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
- `scripts/factory-sweep.js` runs hourly in its own `sweep` job (after `route`, so a sweep failure never skips a retry run). Only that job has `actions: write`.
- The run job merges `main` into the branch before a later task, unless main changed `.github/**` or the merge conflicts. In those cases the prompt tells Claude it is working on the older base.
- An owner task escalates with the branch (`factory-escalate.js <id> <task> <branch>`).

## 1.3 so far (2026-10-28)

- The test change `factory-per-change-proof` is on `main` (c3242422, pushed straight to `main` by mistake; the owner chose to keep it).
- The first run opened #733 as `WIP:`, on branch `feature/factory-factory-per-change-proof-1.1` (run-spec's per-task naming). The router follows `headRefName`, so that works.
- Relayed CI runs routed `none` ("Actions checks still running", then "waiting on quiet window"), as designed.
- No hourly sweep fired from 10:43 to 11:44 UTC, so the sweep never got to start 1.2.
- The owner merged #733 while still `WIP:` at 11:44. The router said "change complete" with 1.2 unticked: a silent stall. #734 fixes `mergedRoute` (a per-change merge with a task left routes that task) and adds task 1.3 to the proof change.

## Next

After #734 merges: `gh workflow run factory.yml -f change_id=factory-per-change-proof`. 1.2 opens a new `WIP:` PR; watch for 1.3 as a `Factory-Task: 1.3` commit on the same branch (started by the sweep, or by hand if no schedule fires), then `WIP:` dropped and a mention. Then archive the proof change.

## Open PRs

- #734: early-merge router fix. CI green, settled. Copilot out of quota.

## Waiting on the user

- Merge #734. Leave the next `WIP:` proof PR unmerged until `WIP:` is dropped.
- Copilot on per-change PRs: with `review_on_push: false`, Copilot reviews only the first task. Options: (a) accept that, because Seer reviews every push; (b) turn on "Review new pushes" in the `main` ruleset (more Copilot requests). Recommendation: (a). This does not block 1.3.

## Learnings

- `gh pr ready` is not in the Claude allowlist: the route job marks a PR ready with its own token, and the factory uses `WIP:` titles, not drafts.
- A per-change PR's title edit starts no event, so after `markReady` nothing runs until the owner merges.
