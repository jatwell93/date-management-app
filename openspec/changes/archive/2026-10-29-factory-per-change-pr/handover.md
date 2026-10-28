# Handover: factory-per-change-pr

Updated: 2026-10-29 · main at c5a5526e

## State

All tasks done: 1.1 (#729), 1.2 (#730), and 1.3, the live proof (#733, #734, #735). The test change `factory-per-change-proof` is archived in the 1.3 PR. Next is archiving this change.

What 1.1 found on draft PRs:

- Required checks: all run. Draft #689 reported every required context.
- CodeScene: runs (it approved #689 as a draft).
- Seer (`sentry[bot]`): skips drafts. Sentry's AI Code Review docs say it reviews a ready PR on every commit and skips drafts. On #724 it reviewed each push.
- Copilot: skips drafts. The `main` ruleset (id 14671588) sets `review_draft_pull_requests: false` and `review_on_push: false`, so Copilot reviews a PR once.

So a per-change PR opens ready, titled `WIP:`.

1.2 design (what to check if a per-change run misbehaves):

- `pr: per-change` is read from `main`'s proposal: `perChangeFromProposal` in `scripts/factory-issue.js`.
- `babysitRoute` hands a per-change PR to `advanceRoute`, then `nextStepRoute` (`scripts/factory-route.js`). It reads the branch's `tasks.md` through the contents API (`branchFile`). `markReady` drops `WIP:` and comments.
- `activeOnly` sends dispatch, resume and retry on a per-change change with an open PR to that PR. `mergedRoute` returns `none` for a per-change merge only when `main`'s `tasks.md` has no task left (#734); otherwise the next task opens a new per-change PR.
- `scripts/factory-sweep.js` runs hourly in its own `sweep` job (after `route`, so a sweep failure never skips a retry run). Only that job has `actions: write`.
- The run job merges `main` into the branch before a later task, unless main changed `.github/**` or the merge conflicts. In those cases the prompt tells Claude it is working on the older base.
- An owner task escalates with the branch (`factory-escalate.js <id> <task> <branch>`).

## 1.3 live proof (2026-10-28)

- First run: #733 opened as `WIP:` with 1.1. The owner merged it while still `WIP:`, and the router called the change complete with 1.2 unticked. #734 fixed that.
- Rerun after #734: the dispatch opened #735 (`WIP:`) with 1.2. At 13:14 UTC the hourly sweep dispatched 1.3, which committed to the same branch (`Factory-Task: 1.2`, `Factory-Task: 1.3` trailers). At 18:56 the next sweep found it settled with no task left, dropped `WIP:` and mentioned the owner, with no Claude run. The owner merged once; the merge routed `none` ("change complete").
- Relayed CI runs on a waiting PR routed `none` ("Actions checks still running", "waiting on quiet window"), as designed.

Findings, not fixed:

- GitHub skips hourly schedules: none fired from 10:43 to 11:44, and none from 13:14 to 18:56. A per-change PR can sit settled for hours before the next task or the ready mark.
- `run-spec` names the first branch `feature/factory-<id>-<task>`, not the proposal's `feature/factory-<id>`. The router follows `headRefName`, so it works; the proposal's wording is the stale part.
- On #735, five checks for the 1.3 commit (CodeQL, secret scan, workers detect, lint) were created at 13:17 but their jobs only started at 20:52. Cause unknown (runner queue or a re-run).

## Next

Archive this change (`openspec archive factory-per-change-pr`). Before archiving, re-check the MODIFIED requirements in `specs/agent-factory-runner/spec.md` against the archived `agent-factory-runner` spec (the proposal asks for this), and fix the branch-name wording.

## Open PRs

- The 1.3 PR (this branch, `feature/factory-per-change-1-3`): ticks 1.3, archives the proof change.

## Waiting on the user

- Merge the 1.3 PR.
- Copilot on per-change PRs: with `review_on_push: false`, Copilot reviews only the first task. Options: (a) accept that, because Seer reviews every push; (b) turn on "Review new pushes" in the `main` ruleset (more Copilot requests). Recommendation: (a). Copilot was also out of quota on #734.
- Whether the schedule lag needs a fix (for example a second, offset cron), or is fine for overnight runs.

## Learnings

- `gh pr ready` is not in the Claude allowlist: the route job marks a PR ready with its own token, and the factory uses `WIP:` titles, not drafts.
- A per-change PR's title edit starts no event, so after `markReady` nothing runs until the owner merges.
- An owner can merge a `WIP:` per-change PR early; the change then continues on a new PR (#734).
