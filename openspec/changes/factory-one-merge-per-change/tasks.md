# Tasks: One merge per change

Numbered 5.x as phase 5 of the factory (phases 0 to 4 were `add-spec-factory-runner`).

## 5.1 Owner tasks

- [x] 5.1 `(owner)` marker. `scripts/factory-route.js` reads the next unchecked task from `main`'s `tasks.md`; when it is marked `(owner)`, it routes `mode=escalate` instead of `task`. A new `escalate` job in `factory.yml` runs `scripts/factory-escalate.js <id> <task>`, which finds the tracking issue (`factory-issue.js`), adds `needs-human` and comments with the task text and how to resume, naming the branch whose `tasks.md` the owner must tick (`main`, or the open per-change PR's branch). `run-spec` refuses an `(owner)` task too, in case it is reached another way. Add the script to the `no_go` baseline and to the rules a babysit pass restores from `main`.
      Acceptance: router tests for an owner task on dispatch, on merge and on resume (still unchecked: escalates again; ticked: starts the next task); no Claude run on those routes; `factory-escalate.js` tests with a fake `gh`.
      Done: `nextTask` in `scripts/factory-route.js` (first unchecked numbered task; `(owner)` must follow the number, so a quoted `(owner)` in prose does not count) and `ownerTaskRoute`, applied after the needs-human hold on every task route; `scripts/factory-escalate.js` (on the `no_go` baseline and the restored rules; does nothing if the task stopped being next); the `escalate` job runs it from `main` with the job token, in the change's concurrency group. The comment names `main` only; naming the per-change branch comes with 5.3. `run-spec` escalates an `(owner)` task too. actionlint 1.7.7 clean; `test:tooling` 177 pass.

## 5.2 First real spec

- [x] 5.2 (owner) Write a small frontend or workers change (three or four tasks, no migration, billing or auth), dispatch it, and touch the keyboard only to merge and to answer escalations.
      Acceptance: `handover.md` records each task's run, PR, fix rounds and every owner touch, and whether the digest posted and a babysit pass fixed a finding. Decide from the merge count whether 5.3 is worth building.
      Done: `fix-recent-items-iso-timestamps` (#672, proposal #715, five tasks) ran end to end on 2026-10-25 in 94 minutes, PRs #716-#720, with no escalation. Owner touches: five merges and one label toggle to work around a missed no-go guard run on #717 (fixed in #721). One babysit pass fixed a CodeScene finding on #717. The record is in `handover.md`; the digest is the one item not yet seen for this change.

## 5.3 One PR per change (deferred)

Deferred after 5.2 (the merges cost minutes each, and 5.3 is the largest task here). The design moved, unchanged, to the change `factory-per-change-pr`.

## 5.4 Retry once

- [x] 5.4 Retry a failed Claude run once.
  - A `report` job (`needs: [route, run]`, `if: always()` and `run` ended `failure` or `success`, so a cancelled run does nothing) runs `scripts/factory-retry.js report <id> <run-url>` on a failure: it adds `factory-retry` to the tracking issue and comments the run's link with a marker; when the issue already has `factory-retrying`, it removes that label, adds `needs-human` and comments both run links (the first from the marker comment) instead. On a success it runs `factory-retry.js clear <id>`, which removes `factory-retrying` if present.
  - An hourly `schedule` trigger on `factory.yml`. On it, `factory-route.js` lists open issues labelled `factory-retry` and takes the first whose label was added more than an hour ago (the issue's `labeled` event time), skipping one that also has `needs-human`. It swaps the label for `factory-retrying` and routes, in the same workflow run, a babysit pass when the change has an open factory PR, else a task. One retry per scheduled run; nothing due routes to `none`. No `actions: write` is needed, because nothing is dispatched.
  - Every route of a change, babysit included, starts no Claude run while its tracking issue has `needs-human` or `factory-retry` (extend `parkedIssue`, and call it from `babysitRoute`).
  - A job that hits its `timeout-minutes` can end `cancelled` rather than `failed`, and then starts no retry. So the Claude step gets its own `timeout-minutes` below the job's: a step timeout fails the step, and the job ends `failed`.
  - Add `scripts/factory-retry.js` to the `no_go` baseline and to the rules a babysit pass restores from `main`. (Checkout steps can keep `github.event.repository.default_branch`: `factory-digest.yml` shows a `schedule` event carries it.)
    Acceptance: router tests for a label under an hour old (none), over an hour (task, or babysit when a factory PR is open), a label beside `needs-human` (none), and a review or relayed CI event during the backoff (none); `factory-retry.js` tests with a fake `gh` for a first failure (label and marker comment), a failure under `factory-retrying` (escalation with both links, label removed) and a success (label cleared); static tests for the schedule, the `report` job's condition and the Claude step's timeout below the job's. Live: dispatch a run whose Claude step times out (a short step timeout on a branch run) and see `factory-retry`, then the scheduled retry.
    Done: `scripts/factory-retry.js` (`fail`/`ok`, on the `no_go` baseline and the restored rules); the router's `schedule` route (`retryRoute`) and `changeHold`, which now also holds babysit routes; the retry's labels change only after its route is decided (a run swaps to `factory-retrying`, a wait for running checks or the owner keeps `factory-retry`, and nothing to retry drops the label; Seer on #724); the `report` job and an hourly `schedule` in `factory.yml`; the Claude step's `timeout-minutes: 80` under the job's 90. `test:tooling` 191 pass; actionlint 1.7.7 clean. The live check runs after merge (see `handover.md`): `report` needs `main`'s copy of the script.

## 5.5 Close out

- [ ] 5.5 Update AGENTS.md §5 (Factory) for `(owner)` tasks and retries (and note `pr: per-change` is deferred to `factory-per-change-pr`), and log a DECISION in `memory.jsonl`.
- [ ] 5.6 `openspec validate factory-one-merge-per-change --strict`; archive once merged.
