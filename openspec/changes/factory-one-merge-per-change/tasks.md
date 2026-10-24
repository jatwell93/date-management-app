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
  - **Every run on a per-change PR advances it by one step**, chosen from the PR's state when the run starts: actionable items get a babysit pass; settled with a task left gets the next task (commits with a `Factory-Task: <n>` trailer); settled with no task left marks the PR ready and mentions the owner on it (also when the last task was an `(owner)` task the owner ticked); still waiting (Actions checks running, quiet window) exits quietly. A run that found work but could neither push nor reply escalates with `needs-human`.
  - **The route job picks the step** (`factory-route.js`, from `pr-feedback.js` and the branch's `tasks.md`), so idle PRs cost no Claude run. Only a babysit pass or a task starts the Claude job. Marking the PR ready is done in the route job (`gh pr ready`, then a comment mentioning the owner). A waiting PR, or a ready PR with no task left, routes to `none`. The Claude run re-checks the state when it starts, because it may have waited in the queue.
  - **One concurrency group per change** (`factory-<id>`) for every run on it. GitHub keeps one pending run per group and cancels an older pending one; that is harmless, because the newer run reads the PR's state afresh and does whatever the older one would have.
  - Before a task it merges `origin/main` into the branch only when `git diff --name-only HEAD...origin/main` lists no `.github/**` path: the Claude App has no Workflows permission, so GitHub rejects a push whose merge commit brings in workflow changes. Otherwise it works on the older base and says so in the PR. The `main` ruleset requires branches to be up to date, so the owner then uses "Update branch" before merging.
  - The run restores `main`'s copy of the factory's rules after switching to the branch, as a babysit pass does.
  - While a per-change PR is open, the router, the sweep and the `(owner)` check (5.1) read the task list from the PR branch's `tasks.md` through the contents API (`gh api repos/{owner}/{repo}/contents/openspec/changes/<id>/tasks.md?ref=<branch>`), not `main`'s. The route job checks out only `main`, so a `git show origin/<branch>:…` would fail there.
  - The router routes a per-change merge to `none`, and holds every route for a per-change PR that carries `needs-human` (a babysit pass parks the PR, not the issue).
  - `scripts/babysit-round.js` counts rounds after the newest `Factory-Task` commit.
  - A new `scripts/factory-sweep.js`, run hourly by a `schedule` trigger in the route job, applies the router's step choice to each open per-change PR and dispatches a run only when the step is a babysit pass or a task (marking ready it does itself), except for a PR parked with `needs-human` (on the PR or the tracking issue) or whose tracking issue has `factory-retry` (5.4 owns that case). A duplicate dispatch only queues in the change's group and finds nothing left to do. A cancelled run is advanced again by the next sweep: to stop a change, add `needs-human`.
  - Allow `gh pr ready`; give the route job `actions: write`.
    Acceptance: router, sweep and round-reader tests, including a sweep on a parked PR and on a change with `factory-retry` (no dispatch each), an advance run on an actionable, a settled, a waiting and a finished PR, a final `(owner)` task (PR marked ready), the branch's `tasks.md` read through the contents API, and a branch whose merge with `main` would bring a workflow change (no merge); `factory-workflows.test.js` updated for the schedule, the route job's permission and the per-change concurrency group; a two-task test change runs as one PR that the owner merges once.

## 5.4 Retry once

- [ ] 5.4 A `report-failure` job (`if: failure()` on any Claude run: a task, or a babysit pass, so a failing pass on a per-change PR is not re-dispatched by the sweep every hour) adds `factory-retry` to the tracking issue and comments the failed run's link there; when the issue already has `factory-retrying`, it escalates with both run links instead. The hourly sweep lists open issues labelled `factory-retry`, so a run that failed before any PR existed is found too. It skips one whose label is under an hour old; once older, it replaces the label with `factory-retrying` and dispatches the change. This is the only dispatch the sweep makes for a change with either label. A `clear-retry` step removes `factory-retrying` when a run of the change succeeds. A job that hits its `timeout-minutes` can end `cancelled` rather than `failed`, and then skips `if: failure()`. So the Claude step gets its own `timeout-minutes` below the job's: a step timeout fails the step, and the job ends `failed`. The live run below confirms both. A cancelled run starts no retry.
      Acceptance: sweep tests for a label under an hour old (no dispatch), over an hour (dispatch), a failed retry (escalation with both links, no dispatch), a task that failed before opening a PR (found through the issue label), a replaced queued retry (still counted as the retry), and a failed babysit pass on a per-change PR (label, then one retry); a static test that the Claude step's timeout is below the job's; one live run with a short step timeout ends `failed` and gets `factory-retry`.

## 5.5 Close out

- [ ] 5.5 Update AGENTS.md §5 (Factory) for `(owner)` tasks, `pr: per-change` and retries, and log a DECISION in `memory.jsonl`.
- [ ] 5.6 `openspec validate factory-one-merge-per-change --strict`; archive once merged.
