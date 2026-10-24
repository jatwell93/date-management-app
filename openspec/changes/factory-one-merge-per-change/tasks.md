# Tasks: One merge per change

Numbered 5.x as phase 5 of the factory (phases 0 to 4 were `add-spec-factory-runner`).

## 5.1 Owner tasks

- [ ] 5.1 `(owner)` marker. `scripts/factory-route.js` reads the next unchecked task from `main`'s `tasks.md`; when it is marked `(owner)`, it routes `mode=escalate` instead of `task`. A new `escalate` job in `factory.yml` runs `scripts/factory-escalate.js <id> <task>`, which finds the tracking issue (`factory-issue.js`), adds `needs-human` and comments with the task text and how to resume. `run-spec` refuses an `(owner)` task too, in case it is reached another way. Add the script to the `no_go` baseline and to the rules a babysit pass restores from `main`.
      Acceptance: router tests for an owner task on dispatch, on merge and on resume (still unchecked: escalates again; ticked: starts the next task); no Claude run on those routes; `factory-escalate.js` tests with a fake `gh`.

## 5.2 First real spec

- [ ] 5.2 (owner) Write a small frontend or workers change (three or four tasks, no migration, billing or auth), dispatch it, and touch the keyboard only to merge and to answer escalations.
      Acceptance: `handover.md` records each task's run, PR, fix rounds and every owner touch, and whether the digest posted and a babysit pass fixed a finding. Decide from the merge count whether 5.3 is worth building.

## 5.3 One PR per change

- [ ] 5.3a Check whether the required checks and each bot (Seer, CodeScene, Copilot) run on draft PRs. Record it in `handover.md`. If a bot skips drafts, 5.3b opens a ready PR titled `WIP:` instead of a draft.
- [ ] 5.3b `pr: per-change` in the Autonomy block (read beside `issue:` in `scripts/factory-issue.js`). `run-spec` continues on the change's open PR when `pr-feedback.js` says settled with nothing actionable, merges `origin/main` into it, commits with a `Factory-Task: <n>` trailer, and marks the PR ready after the last task. The router routes a per-change merge to `none` and gives task runs and babysit passes of a per-change PR one concurrency group. `scripts/babysit-round.js` counts rounds after the newest `Factory-Task` commit. A new `scripts/factory-sweep.js`, run hourly by a `schedule` trigger in the route job, dispatches the next task of each settled per-change PR. Allow `gh pr ready`; give the route job `actions: write`.
      Acceptance: router, sweep and round-reader tests; `factory-workflows.test.js` updated for the schedule, the route job's permission and the shared concurrency group; a two-task test change runs as one PR that the owner merges once.

## 5.4 Retry once

- [ ] 5.4 A `report-failure` job (`if: failure()` on a task run) adds `factory-retry` to the tracking issue, or escalates with both run links when the failed run was itself a retry. The hourly sweep dispatches a change whose tracking issue has carried `factory-retry` for at least an hour, marking the dispatch as a retry, and removes the label.
      Acceptance: sweep tests for a label under an hour old (no dispatch), over an hour (dispatch), and a failed retry (escalation, no dispatch).

## 5.5 Close out

- [ ] 5.5 Update AGENTS.md §5 (Factory) for `(owner)` tasks, `pr: per-change` and retries, and log a DECISION in `memory.jsonl`.
- [ ] 5.6 `openspec validate factory-one-merge-per-change --strict`; archive once merged.
