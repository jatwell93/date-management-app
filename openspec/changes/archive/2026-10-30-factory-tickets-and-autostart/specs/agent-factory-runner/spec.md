## ADDED Requirements

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

## MODIFIED Requirements

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
