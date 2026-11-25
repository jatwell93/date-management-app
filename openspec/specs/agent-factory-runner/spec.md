# agent-factory-runner Specification

## Purpose

The factory turns an approved OpenSpec change into merged work without the owner at the keyboard. A GitHub workflow implements one task per run, opens and babysits its PR, starts the next task when the owner merges, and escalates on the change's tracking issue instead of guessing. It never merges, never holds production secrets and never edits a `no_go` path.

## Requirements

### Requirement: Factory runs one OpenSpec task per run without production access

The factory workflow SHALL implement at most one unchecked task of the named OpenSpec change per run, SHALL NOT start a task while an open `factory:<change-id>` PR exists unless the change is `pr: per-change` and that PR is its per-change PR, which the run advances instead, and SHALL run with no production secrets and with GitHub token permissions limited to contents, pull-requests and issues write. Only the route job, which runs no Claude step, MAY also hold `actions: write`, to dispatch runs from the sweep.

#### Scenario: Dispatched on a change with unchecked tasks

- **GIVEN** an OpenSpec change with at least one unchecked task in `tasks.md`
- **WHEN** the factory workflow is dispatched with that change id
- **THEN** the runner implements the first unchecked task only
- **AND** pushes a feature branch and opens a PR labelled `factory:<change-id>`
- **AND** updates `openspec/changes/<change-id>/handover.md`

#### Scenario: Triggered again while a factory PR is open

- **GIVEN** an open PR labelled `factory:<change-id>` for a change without `pr: per-change`
- **WHEN** the factory is dispatched or labelled again for that change
- **THEN** the run waits in the `factory-<change-id>` concurrency group behind any running task
- **AND** exits without changes, because a factory PR is still open

#### Scenario: Per-change PR open and settled

- **GIVEN** a `pr: per-change` change whose open factory PR is settled with nothing actionable
- **WHEN** the factory is dispatched for that change
- **THEN** the runner implements the next unchecked task on that PR's branch

#### Scenario: Workflow carries no production credentials

- **GIVEN** the factory workflow file
- **WHEN** a static test reads it
- **THEN** it references no production Doppler, Neon or Stripe secret

### Requirement: Factory never merges

The factory SHALL NOT merge, approve or enable auto-merge on any PR, regardless of the change's `merge` setting, while the `production` environment has no required reviewer.

#### Scenario: Change declares merge auto

- **GIVEN** a change whose autonomy block says `merge: auto`
- **WHEN** its factory PR becomes settled with nothing actionable
- **THEN** the runner leaves the PR open for the owner to merge

#### Scenario: Runner attempts a merge anyway

- **GIVEN** a factory PR authored by the Claude GitHub App with all checks green
- **WHEN** a merge is attempted with the runner's credentials, or auto-merge is enabled
- **THEN** GitHub refuses or holds the merge until the owner approves the PR
- **AND** the runner's tool configuration denies `gh pr merge`, `gh pr review` and `gh api`

### Requirement: no_go paths are enforced on the diff

Before pushing, the runner SHALL compare the branch diff against the `no_go` patterns: a fixed baseline (`.github/**`, `database/migrations/**`, `scripts/database-backup.sh`, `scripts/check-no-go.js`, `.claude/**`, `AGENTS.md`, `CLAUDE.md`) plus the change's own entries, which SHALL add to the baseline and never replace it. It SHALL NOT push when any changed path matches. A renamed file SHALL count under both its old and its new path. Independently of the runner, a required `no-go-guard` check SHALL run from the base branch's definition (`pull_request_target`) and SHALL fail any factory PR whose file list, including each file's previous name, matches a `no_go` pattern.

#### Scenario: Protected file renamed to an unprotected path

- **GIVEN** a factory branch that renames `.claude/skills/run-spec/SKILL.md` to `docs/run-spec.md`
- **WHEN** the agent check or the `no-go-guard` check runs
- **THEN** it reports `.claude/skills/run-spec/SKILL.md` as a match and fails

#### Scenario: Change lists its own no_go paths

- **GIVEN** a change whose `no_go` list is only `frontend/src/legacy/**`
- **AND** a factory branch whose diff includes `.github/workflows/factory.yml`
- **WHEN** the agent check or the `no-go-guard` check runs
- **THEN** it reports `.github/workflows/factory.yml` as a match and fails

#### Scenario: Diff touches a workflow file

- **GIVEN** a factory branch whose diff against its merge base with `origin/main` includes `.github/workflows/factory.yml`
- **WHEN** the runner reaches the push step
- **THEN** it does not push
- **AND** labels the tracking issue `needs-human` with the matching path

#### Scenario: Agent skips its own check and pushes anyway

- **GIVEN** a factory PR whose file list includes `.claude/skills/run-spec/SKILL.md`
- **WHEN** the `no-go-guard` check runs, using `main`'s copy of the workflow and of `scripts/check-no-go.js`
- **THEN** the check fails
- **AND** the PR cannot merge, because the check is required

### Requirement: Review-fix passes respect no_go and a persistent round cap

Each babysit pass SHALL run the same `no_go` diff check before pushing, and SHALL stop with `needs-human` instead of pushing on a match or once the current task already carries 5 babysit rounds, counted from `Babysit-Round: N` commit trailers so the cap holds across separate workflow runs. For a PR of one task, the current task's rounds are all the PR's rounds. For a `pr: per-change` PR, they are the rounds on commits after the newest `Factory-Task` commit. The pass SHALL put `needs-human` on the PR of a one-task change and on the tracking issue of a `pr: per-change` change.

#### Scenario: Bot fix would touch a no_go path

- **GIVEN** a babysit pass whose fix changes a file under `.github/**`
- **WHEN** it reaches the push step
- **THEN** it does not push
- **AND** labels the PR `needs-human` with the matching path, or for a `pr: per-change` PR, labels the tracking issue instead

#### Scenario: Bot review arrives inside the quiet window

- **GIVEN** a factory PR whose checks have all finished
- **WHEN** a bot review with an actionable thread starts a babysit pass seconds after it posts
- **THEN** the pass acts on the thread in that run, without waiting for the quiet window

#### Scenario: Only a non-Actions check is still pending

- **GIVEN** a factory PR whose GitHub Actions checks have all finished
- **AND** whose CodeScene check is still pending
- **WHEN** a Seer review with an actionable thread starts a babysit pass
- **THEN** the pass acts on the thread in that run

#### Scenario: Fifth round already used

- **GIVEN** a factory PR of one task whose commits include a `Babysit-Round: 5` trailer
- **WHEN** a new review event starts a babysit pass
- **THEN** the pass makes no commit
- **AND** labels the PR `needs-human`

#### Scenario: Round cap per task on a per-change PR

- **GIVEN** a `pr: per-change` PR with `Babysit-Round: 5` on a commit before the newest `Factory-Task` commit, and none after it
- **WHEN** a babysit pass starts
- **THEN** it may commit, as round 1 of the current task

### Requirement: Factory escalates instead of guessing

When a task needs a product decision, touches a `no_go` path, or is an operator task, the runner SHALL label the PR or tracking issue `needs-human`, mention the owner, and stop. No task of the change SHALL start while its tracking issue has `needs-human`. The owner removing the label SHALL resume the change, and the next run SHALL record the owner's answer in `handover.md`. The tracking issue SHALL be the open issue labelled `factory:<change-id>`, else the open issue named by the `issue:` key of the proposal's `## Autonomy` block (never an issue cited in prose), else a new one.

#### Scenario: Task touches a no_go path

- **GIVEN** a task whose change would edit a path listed under `no_go`
- **WHEN** the runner reaches that task
- **THEN** it makes no edit to that path
- **AND** labels the tracking issue `needs-human` with the reason

#### Scenario: A merge arrives while the change waits on the owner

- **GIVEN** a change whose tracking issue has `needs-human`
- **WHEN** a factory PR of that change merges, or the factory is dispatched on it
- **THEN** the router starts no task

#### Scenario: Owner answers and removes needs-human

- **GIVEN** a tracking issue with `needs-human` and the owner's answer in a comment
- **WHEN** the owner removes `needs-human`
- **THEN** a task run starts on the change
- **AND** its PR records the answer under "Decisions" in `handover.md`

#### Scenario: The factory removes needs-human itself

- **GIVEN** a tracking issue with `needs-human`
- **WHEN** anyone but the owner removes the label
- **THEN** the router starts no task

#### Scenario: Change written for an existing issue

- **GIVEN** a proposal whose `## Autonomy` block says `issue: 671`, for an open issue, and no issue labelled `factory:<change-id>`
- **WHEN** the runner needs the tracking issue
- **THEN** it labels #671 `factory:<change-id>` and uses it, creating no new issue

#### Scenario: Proposal cites an issue only in passing

- **GIVEN** a proposal that mentions issue #40 in its prose and has no `issue:` key
- **WHEN** the runner needs the tracking issue
- **THEN** it does not touch #40

### Requirement: Factory posts a daily digest

A scheduled workflow SHALL post, once a day, one comment on the `Factory digest` issue listing open `needs-human` issues and PRs, open factory PRs with their `pr-feedback --summary` verdict, and factory runs that failed in the last 24 hours, mentioning the owner. It SHALL post nothing when all three are empty, and SHALL run without a Claude run or any secret but the job token.

#### Scenario: Something waits on the owner

- **GIVEN** an open tracking issue with `needs-human` and one open factory PR
- **WHEN** the digest runs
- **THEN** one comment lists both and mentions the owner

#### Scenario: Nothing open

- **GIVEN** no `needs-human` item, no open factory PR and no failed factory run in 24 hours
- **WHEN** the digest runs
- **THEN** it posts no comment

### Requirement: Merged factory PRs start the next task

When a PR labelled `factory:<change-id>` merges and the change runs one PR per task, the factory SHALL start the next unchecked task of that change, and SHALL run at most one review-response pass per PR at a time, capped at 5 babysit rounds per task as counted by `Babysit-Round: N` trailers. The merge of a `pr: per-change` PR SHALL start no task once `main` has no unchecked task of the change left, and SHALL start the next one otherwise.

#### Scenario: Factory PR merges

- **GIVEN** a merged PR labelled `factory:<change-id>`
- **AND** the change has another unchecked task
- **WHEN** the `pull_request: closed` event fires
- **THEN** a new factory run starts on that task

#### Scenario: Per-change PR merges

- **GIVEN** a merged PR labelled `factory:<change-id>` for a `pr: per-change` change whose tasks on `main` are all ticked
- **WHEN** the `pull_request: closed` event fires
- **THEN** no factory run starts

#### Scenario: Per-change PR merged with a task left

- **GIVEN** the owner merged a `WIP:` `pr: per-change` PR while `main` still has an unchecked task of the change
- **WHEN** the `pull_request: closed` event fires
- **THEN** the factory starts that task, which opens a new per-change PR

### Requirement: Owner tasks escalate without a Claude run

When the next unchecked task of a change is marked `(owner)` in the change's task list, the router SHALL NOT start a task run. It SHALL add `needs-human` to the change's tracking issue and mention the owner with the task text, without a Claude run. The owner removing `needs-human` SHALL start the next task only when the owner task is ticked in that task list; otherwise the router SHALL escalate again. The task list is `tasks.md` on `main`.

#### Scenario: Merge reaches an owner task

- **GIVEN** a change whose next unchecked task is `- [ ] 2.3 (owner) Rotate the vendor key`
- **WHEN** the previous factory PR of the change merges
- **THEN** no Claude run starts
- **AND** the tracking issue gets `needs-human` and a comment naming task 2.3

#### Scenario: Owner resumes without ticking the task

- **GIVEN** an escalated owner task that is still unchecked in the change's task list
- **WHEN** the owner removes `needs-human`
- **THEN** no Claude run starts
- **AND** the tracking issue gets `needs-human` again

#### Scenario: Owner ticks the task, then resumes

- **GIVEN** an owner task the owner has ticked in the change's task list
- **WHEN** the owner removes `needs-human`
- **THEN** a task run starts on the next unchecked task

### Requirement: A failed task run is retried once

When a task run or a babysit pass fails or times out, the factory SHALL mark the change's tracking issue with `factory-retry` and record the failed run's link on it. An hourly scheduled route, with no Claude step of its own, SHALL find retries from the open tracking issues that carry the mark, whether or not the change has a PR. While the mark is under an hour old, it SHALL start nothing for the change; once it is older, it SHALL replace the mark with `factory-retrying` and start one run in the same workflow run: a babysit pass when the change has an open factory PR, else a task. It SHALL start at most one retry per scheduled run. `factory-retrying` SHALL stay until the retry run itself succeeds; another run of the change succeeding SHALL NOT remove it. When a run fails while the issue has `factory-retrying`, the factory SHALL remove `factory-retrying` and escalate with `needs-human` and both run links instead of retrying. Every route of a change, task or babysit, SHALL start no Claude run while the tracking issue has `needs-human` or `factory-retry`. A cancelled run SHALL NOT mark the issue for a retry.

#### Scenario: First failure

- **GIVEN** a task run that fails without opening a PR
- **WHEN** the scheduled route runs more than an hour later
- **THEN** one new task run starts on the change
- **AND** the tracking issue has `factory-retrying` instead of `factory-retry`

#### Scenario: Babysit pass fails

- **GIVEN** a factory PR with an actionable thread whose babysit pass fails before pushing or replying
- **WHEN** a review comment or a relayed CI run arrives within the next hour
- **THEN** the router starts no Claude run, because the tracking issue has `factory-retry`
- **AND** the scheduled route makes one babysit pass on the PR once the mark is over an hour old

#### Scenario: Retry mark still fresh

- **GIVEN** a tracking issue that got `factory-retry` 20 minutes ago
- **WHEN** the scheduled route runs
- **THEN** it starts nothing for the change

#### Scenario: Run times out

- **GIVEN** a task run whose Claude step exceeds its timeout
- **WHEN** the run ends
- **THEN** it ends `failed`, not `cancelled`
- **AND** the tracking issue gets `factory-retry`

#### Scenario: Failure before any PR exists

- **GIVEN** a change with no factory PR whose first task run fails on a usage limit
- **WHEN** the scheduled route runs more than an hour later
- **THEN** it finds the change through its tracking issue's `factory-retry` label and starts one task run

#### Scenario: Retry succeeds

- **GIVEN** a tracking issue with `factory-retrying`
- **WHEN** the retry run succeeds
- **THEN** the issue no longer has `factory-retrying`, so a later failure gets its own retry

#### Scenario: Another run succeeds during the retry

- **GIVEN** a tracking issue with `factory-retrying` and its retry still running
- **WHEN** a different run of the change succeeds
- **THEN** the issue keeps `factory-retrying`
- **AND** a failure of the retry escalates with `needs-human`

#### Scenario: Retry fails too

- **GIVEN** a tracking issue with `factory-retrying`
- **WHEN** a run of the change fails
- **THEN** the tracking issue gets `needs-human` and a comment with both run links
- **AND** `factory-retrying` is removed and no further retry starts

### Requirement: A change can run as one PR

A change whose `## Autonomy` block says `pr: per-change` SHALL keep one open factory PR for all its tasks, opened ready with a `WIP:` title (Seer and Copilot skip draft PRs), and its tasks SHALL be read from that PR's branch while it is open, without needing that branch checked out. Each task SHALL mark its commits with a `Factory-Task: <n>` trailer and SHALL NOT rewrite pushed commits. Each task SHALL merge `origin/main` into the branch first, except when the merge would bring in a `.github/**` change, which the factory's GitHub App cannot push.

Every run on the PR SHALL advance it by one step, chosen from the PR's state when the run starts: a babysit pass while an item is actionable; the next task once the PR is settled with nothing actionable; an archive run once no unchecked task is left and the branch does not yet hold the archived change; marking the PR ready for review and mentioning the owner on it once the branch holds the archived change; nothing while an Actions check runs or the quiet window lasts. The step SHALL be chosen before any Claude run starts: only a babysit pass, a task or an archive run SHALL start one, marking the PR ready SHALL need none, and a waiting or finished PR SHALL route to nothing. A run that finds work but can neither push nor reply SHALL escalate with `needs-human`. Every escalation on a per-change PR SHALL put `needs-human` on the tracking issue only, so the owner removing it there resumes the change. Every route of a change, whether started by an event (review, review comment, relayed CI run, merge, dispatch) or by the sweep, SHALL start no Claude run while the tracking issue has `needs-human` or `factory-retry`. All runs of the change SHALL share one concurrency group, so no two work on the branch at once. An hourly sweep SHALL apply the same step choice to each open per-change PR and dispatch a run only for a babysit pass, a task or an archive run, except for a PR with `needs-human` on the PR or the tracking issue, or with `factory-retry` on the tracking issue. The PR's merge SHALL start nothing once the change is archived on `main`; if the owner merged it with a task left, the merge SHALL start that task, which opens a new per-change PR; if the owner merged it with every task done but before the archive, the merge SHALL start an archive run, which opens an archive PR. A change without the key SHALL run one PR per task.

#### Scenario: Settled per-change PR with tasks left

- **GIVEN** a `pr: per-change` change with an open factory PR that is settled with nothing actionable
- **AND** an unchecked task left in the branch's `tasks.md`
- **WHEN** the hourly sweep runs
- **THEN** a run starts and pushes the next task to the same PR

#### Scenario: Per-change PR has an unanswered thread

- **GIVEN** a `pr: per-change` PR with an unanswered bot thread and all Actions checks finished
- **WHEN** a run starts on it
- **THEN** the run makes a babysit pass and starts no task

#### Scenario: Per-change PR still waiting

- **GIVEN** a `pr: per-change` PR with an Actions check still running
- **WHEN** an event or the hourly sweep reaches it
- **THEN** the router routes it to nothing and no Claude run starts
- **AND** nothing escalates

#### Scenario: Pending run replaced

- **GIVEN** a running task run on a `pr: per-change` PR, a pending babysit run behind it, and a newer dispatch from the sweep
- **WHEN** GitHub cancels the older pending run in the change's concurrency group
- **THEN** the remaining run reads the PR's state when it starts and makes the babysit pass if an item is still actionable

#### Scenario: Finished PR already ready

- **GIVEN** a `pr: per-change` PR marked ready, with every task ticked and nothing actionable
- **WHEN** the hourly sweep runs
- **THEN** it dispatches nothing and no Claude run starts

#### Scenario: Babysit pass hits the round cap on a per-change PR

- **GIVEN** a `pr: per-change` PR whose current task already has 5 babysit rounds
- **WHEN** a babysit pass would need another round
- **THEN** the tracking issue gets `needs-human` and the PR does not
- **AND** the hourly sweep dispatches nothing for that change

#### Scenario: Review event on a parked per-change PR

- **GIVEN** a `pr: per-change` PR whose tracking issue has `needs-human` after a round-cap escalation
- **WHEN** a bot review or a relayed CI run arrives on the PR
- **THEN** the router starts no Claude run and posts no new escalation

#### Scenario: Event during the retry backoff

- **GIVEN** a tracking issue that got `factory-retry` 20 minutes ago after a babysit pass failed
- **WHEN** a review comment or a relayed CI run arrives on the change's PR
- **THEN** the router starts no Claude run
- **AND** the retry waits for the sweep

#### Scenario: Owner resumes a parked per-change PR

- **GIVEN** a `pr: per-change` change parked with `needs-human` on its tracking issue only
- **WHEN** the owner removes the label from the issue
- **THEN** the router advances the PR

#### Scenario: First task opens a WIP PR

- **GIVEN** a `pr: per-change` change with no open factory PR
- **WHEN** its first task run pushes
- **THEN** it opens a ready PR titled `WIP:`
- **AND** the `WIP:` prefix is dropped only once the branch holds the archived change

#### Scenario: Branch task list read by the route job

- **GIVEN** an open `pr: per-change` PR and a route job that has checked out only `main`
- **WHEN** the router or the sweep needs the change's next unchecked task
- **THEN** it reads `tasks.md` from the PR branch through the GitHub contents API
- **AND** does not fail for the branch being absent locally

#### Scenario: Main has a workflow change the branch lacks

- **GIVEN** a `pr: per-change` branch and a newer `main` that changes `.github/workflows/ci.yml`
- **WHEN** the next task run starts
- **THEN** it does not merge `origin/main` into the branch
- **AND** it pushes the task on the older base and notes in the PR that the owner must update the branch before merging

#### Scenario: Last task done

- **GIVEN** a `WIP:` `pr: per-change` PR whose branch has every task ticked and holds the archived change
- **WHEN** an event or the hourly sweep reaches it
- **THEN** the route job marks the PR ready for review and mentions the owner, with no Claude run
- **AND** the owner's merge of it starts no task

#### Scenario: Last task is an owner task

- **GIVEN** a `pr: per-change` PR whose only unchecked task was `(owner)`, now ticked on the branch by the owner
- **WHEN** the owner removes `needs-human`
- **THEN** an archive run commits the archived change on the PR
- **AND** once the branch holds it, the PR is marked ready for review and the owner is mentioned on it, with no Claude run

#### Scenario: Owner task on a per-change PR

- **GIVEN** a `pr: per-change` change with an open PR whose branch's `tasks.md` has tasks 1.1 and 1.2 ticked and 1.3 marked `(owner)`
- **AND** `main`'s `tasks.md` still has 1.1 unchecked
- **WHEN** the router or the sweep picks the next task
- **THEN** it reads the branch's `tasks.md` and escalates task 1.3

### Requirement: The owner's ready label starts a change

The factory SHALL start a change's first unchecked task when the owner adds the label `factory-ready` to the change's tracking issue (the open issue labelled `factory:<change-id>`), as a `workflow_dispatch` with that change id does. It SHALL ignore the label when anyone other than the owner adds it, when the issue has no `factory:<change-id>` label, when the issue has `needs-human` or `factory-retry`, and when the change already has an open factory PR.

#### Scenario: Owner approves the plan

- **GIVEN** a change with a tracking issue and no open factory PR
- **WHEN** the owner adds `factory-ready` to the tracking issue
- **THEN** a run starts the change's first unchecked task

#### Scenario: Someone else adds the label

- **GIVEN** a change with a tracking issue
- **WHEN** an account other than the owner adds `factory-ready`
- **THEN** the router routes to nothing and no Claude run starts

### Requirement: The owner merging a plan PR starts a change

The factory SHALL start a change's first unchecked task when a pull request labelled both `factory:<change-id>` and `factory-ready` merges with the owner as `merged_by`, whoever authored it: that merge puts the change's `tasks.md` on `main`, where the router reads it. It SHALL start nothing when the PR closes unmerged, when someone other than the owner merged it, when it lacks either label, when the tracking issue has `needs-human` or `factory-retry`, and when the change already has an open factory PR. A merged factory PR (authored by the Claude GitHub App) keeps its own merge route.

#### Scenario: Owner merges the plan PR

- **GIVEN** a plan PR labelled `factory:<change-id>` and `factory-ready`, and no open factory PR for the change
- **WHEN** the owner merges it
- **THEN** a run starts the change's first unchecked task

#### Scenario: Someone else merges the plan PR

- **GIVEN** a plan PR labelled `factory:<change-id>` and `factory-ready`
- **WHEN** an account other than the owner merges it
- **THEN** the router routes to nothing and no Claude run starts

### Requirement: The factory archives a finished change

When a change has no unchecked task left, the factory SHALL archive it before handing it to the owner: reconcile the change's spec deltas with `openspec/specs/` and with what its tasks built, pass `openspec validate`, and run `openspec archive`. On a `pr: per-change` change it SHALL commit the archive on the open PR's branch before the PR is marked ready. On a per-task change it SHALL open one archive PR. The archive PR SHALL close the tracking issue on merge. A failed validation SHALL escalate with `needs-human`.

Archiving moves `openspec/changes/<id>/` to `openspec/changes/archive/<date>-<id>/`, so `tasks.md` leaves its usual path. The router, the sweep, the `(owner)` check and the merged-PR route SHALL treat a change whose archived folder exists (on the PR branch while its PR is open, on `main` after the merge) as finished: no task left, nothing to start, and never an error for the missing `tasks.md`. The label `factory-ready` SHALL NOT be read as a change id: it does not start with `factory:`.

#### Scenario: Archived change on an open per-change PR

- **GIVEN** a per-change PR whose branch holds `openspec/changes/archive/<date>-<id>/` and no `openspec/changes/<id>/tasks.md`
- **WHEN** an event or the hourly sweep reaches it
- **THEN** the router treats the change as finished and starts no task
- **AND** it marks the PR ready if it is still `WIP:`

#### Scenario: Archive PR merges

- **GIVEN** the merged PR moved the change to `openspec/changes/archive/`
- **WHEN** the merged-PR route runs on `main`
- **THEN** it routes to nothing

#### Scenario: Per-change PR finishes its last task

- **GIVEN** a `pr: per-change` PR, settled, with every task ticked in the branch's `tasks.md`
- **WHEN** a run reaches it
- **THEN** the run commits the archived change on the PR branch
- **AND** only then is `WIP:` dropped and the owner mentioned

#### Scenario: Spec delta fails validation

- **GIVEN** a finished change whose spec delta fails `openspec validate`
- **WHEN** the archive run starts
- **THEN** it escalates with `needs-human` on the tracking issue and pushes nothing

### Requirement: A merged task closes its ticket

When a task line in `tasks.md` carries an issue number, the factory PR that lands the task SHALL reference it with `Closes #<n>`, so the owner's merge closes the ticket.

#### Scenario: Task with a ticket merges

- **GIVEN** task `1.2 ... (#812)` landed by a factory PR
- **WHEN** the owner merges the PR
- **THEN** issue #812 is closed
