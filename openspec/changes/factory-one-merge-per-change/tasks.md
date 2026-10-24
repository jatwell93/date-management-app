# Tasks: One merge per change

Numbered 5.x as phase 5 of the factory (phases 0 to 4 were `add-spec-factory-runner`).

## 5.1 Owner tasks

- [ ] 5.1 `(owner)` marker. `scripts/factory-route.js` reads the next unchecked task from `main`'s `tasks.md` (from the PR branch's copy once 5.3 adds per-change PRs); when it is marked `(owner)`, it routes `mode=escalate` instead of `task`. A new `escalate` job in `factory.yml` runs `scripts/factory-escalate.js <id> <task>`, which finds the tracking issue (`factory-issue.js`), adds `needs-human` and comments with the task text and how to resume, naming the branch whose `tasks.md` the owner must tick (`main`, or the open per-change PR's branch). `run-spec` refuses an `(owner)` task too, in case it is reached another way. Add the script to the `no_go` baseline and to the rules a babysit pass restores from `main`.
      Acceptance: router tests for an owner task on dispatch, on merge and on resume (still unchecked: escalates again; ticked: starts the next task); no Claude run on those routes; `factory-escalate.js` tests with a fake `gh`.

## 5.2 First real spec

- [ ] 5.2 (owner) Write a small frontend or workers change (three or four tasks, no migration, billing or auth), dispatch it, and touch the keyboard only to merge and to answer escalations.
      Acceptance: `handover.md` records each task's run, PR, fix rounds and every owner touch, and whether the digest posted and a babysit pass fixed a finding. Decide from the merge count whether 5.3 is worth building.

## 5.3 One PR per change

- [ ] 5.3a Check whether the required checks and each bot (Seer, CodeScene, Copilot) run on draft PRs. Record it in `handover.md`. If a bot skips drafts, 5.3b opens a ready PR titled `WIP:` instead of a draft.
- [ ] 5.3b `pr: per-change` in the Autonomy block (read beside `issue:` in `scripts/factory-issue.js`).
  - `run-spec` continues on the change's open PR when `pr-feedback.js` says settled with nothing actionable, commits with a `Factory-Task: <n>` trailer, and marks the PR ready and mentions the owner on it whenever it finds no unchecked task left, including when the last task was an `(owner)` task the owner ticked. A task run that ends without pushing escalates with `needs-human` instead of exiting quietly.
  - Before each task it merges `origin/main` into the branch only when `git diff --name-only HEAD...origin/main` lists no `.github/**` path: the Claude App has no Workflows permission, so GitHub rejects a push whose merge commit brings in workflow changes. Otherwise it works on the older base and says so in the PR. The `main` ruleset requires branches to be up to date, so the owner then uses "Update branch" before merging.
  - The task run restores `main`'s copy of the factory's rules after switching to the branch, as a babysit pass does.
  - While a per-change PR is open, the router, the sweep and the `(owner)` check (5.1) read the task list from the PR branch's `tasks.md` (`git show origin/<branch>:openspec/changes/<id>/tasks.md`), not `main`'s.
  - The router routes a per-change merge to `none` and gives task runs and babysit passes of a per-change PR one concurrency group.
  - `scripts/babysit-round.js` counts rounds after the newest `Factory-Task` commit.
  - A new `scripts/factory-sweep.js`, run hourly by a `schedule` trigger in the route job, dispatches the next task of each settled per-change PR. It skips a change that has a queued or running factory run (found by a `run-name` that carries the change id), whose tracking issue has `factory-retry` or `needs-human`, or whose per-change PR itself has `needs-human` (a babysit pass parks the PR, not the issue). It dispatches at most once per PR head commit: the dispatch passes the head SHA, the `run-name` carries it, and the sweep skips a head it already dispatched. So a long or failed run is never doubled, the one-retry limit holds, and a run that ends without pushing (cancelled, or stopped early) is not re-dispatched every hour. The router holds task routes for a per-change PR with `needs-human` the same way.
  - Allow `gh pr ready`; give the route job `actions: write`.
    Acceptance: router, sweep and round-reader tests, including a sweep with a run in flight, a parked PR, or an already-dispatched head (no dispatch each), a final `(owner)` task (PR marked ready), and a branch whose merge with `main` would bring a workflow change (no merge); `factory-workflows.test.js` updated for the schedule, `run-name`, the route job's permission and the shared concurrency group; a two-task test change runs as one PR that the owner merges once.

## 5.4 Retry once

- [ ] 5.4 A `report-failure` job (`if: failure()` on a task run) adds `factory-retry` to the tracking issue, or escalates with both run links when the failed run was itself a retry. The hourly sweep dispatches a change whose tracking issue has carried `factory-retry` for at least an hour, marking the dispatch as a retry, and removes the label. A job that hits its `timeout-minutes` can end `cancelled` rather than `failed`, and then skips `if: failure()`. So the Claude step gets its own `timeout-minutes` below the job's: a step timeout fails the step, and the job ends `failed`. The live run below confirms both. A run the owner cancels is not retried.
      Acceptance: sweep tests for a label under an hour old (no dispatch), over an hour (dispatch), and a failed retry (escalation, no dispatch); a static test that the Claude step's timeout is below the job's; one live run with a short step timeout ends `failed` and gets `factory-retry`.

## 5.5 Close out

- [ ] 5.5 Update AGENTS.md §5 (Factory) for `(owner)` tasks, `pr: per-change` and retries, and log a DECISION in `memory.jsonl`.
- [ ] 5.6 `openspec validate factory-one-merge-per-change --strict`; archive once merged.
