## ADDED Requirements

### Requirement: A change can run as one PR

A change whose `## Autonomy` block says `pr: per-change` SHALL keep one open factory PR for all its tasks, opened as a draft (or with a `WIP:` title where a review bot skips drafts), and its tasks SHALL be read from that PR's branch while it is open, without needing that branch checked out. Each task SHALL mark its commits with a `Factory-Task: <n>` trailer and SHALL NOT rewrite pushed commits. Each task SHALL merge `origin/main` into the branch first, except when the merge would bring in a `.github/**` change, which the factory's GitHub App cannot push.

Every run on the PR SHALL advance it by one step, chosen from the PR's state when the run starts: a babysit pass while an item is actionable; the next task once the PR is settled with nothing actionable; marking the PR ready for review and mentioning the owner on it once no unchecked task is left; nothing while an Actions check runs or the quiet window lasts. The step SHALL be chosen before any Claude run starts: only a babysit pass or a task SHALL start one, marking the PR ready SHALL need none, and a waiting or finished PR SHALL route to nothing. A run that finds work but can neither push nor reply SHALL escalate with `needs-human`. Every escalation on a per-change PR SHALL put `needs-human` on the tracking issue only, so the owner removing it there resumes the change. Every route of a change, whether started by an event (review, review comment, relayed CI run, merge, dispatch) or by the sweep, SHALL start no Claude run while the tracking issue has `needs-human` or `factory-retry`. All runs of the change SHALL share one concurrency group, so no two work on the branch at once. An hourly sweep SHALL apply the same step choice to each open per-change PR and dispatch a run only for a babysit pass or a task, except for a PR with `needs-human` on the PR or the tracking issue, or with `factory-retry` on the tracking issue. The PR's merge SHALL start no task. A change without the key SHALL run one PR per task.

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

#### Scenario: First task opens a draft

- **GIVEN** a `pr: per-change` change with no open factory PR
- **WHEN** its first task run pushes
- **THEN** it opens the PR as a draft
- **AND** the PR is marked ready only when no unchecked task is left

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

- **GIVEN** a draft `pr: per-change` PR whose branch has every task ticked
- **WHEN** an event or the hourly sweep reaches it
- **THEN** the route job marks the PR ready for review and mentions the owner, with no Claude run
- **AND** the owner's merge of it starts no task

#### Scenario: Last task is an owner task

- **GIVEN** a `pr: per-change` PR whose only unchecked task was `(owner)`, now ticked on the branch by the owner
- **WHEN** the owner removes `needs-human`
- **THEN** the PR is ready for review and the owner is mentioned on it, with no Claude run

#### Scenario: Owner task on a per-change PR

- **GIVEN** a `pr: per-change` change with an open PR whose branch's `tasks.md` has tasks 1.1 and 1.2 ticked and 1.3 marked `(owner)`
- **AND** `main`'s `tasks.md` still has 1.1 unchecked
- **WHEN** the router or the sweep picks the next task
- **THEN** it reads the branch's `tasks.md` and escalates task 1.3

## MODIFIED Requirements

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

### Requirement: Merged factory PRs start the next task

When a PR labelled `factory:<change-id>` merges and the change runs one PR per task, the factory SHALL start the next unchecked task of that change, and SHALL run at most one review-response pass per PR at a time, capped at 5 babysit rounds per task as counted by `Babysit-Round: N` trailers. The merge of a `pr: per-change` PR SHALL start no task.

#### Scenario: Factory PR merges

- **GIVEN** a merged PR labelled `factory:<change-id>`
- **AND** the change has another unchecked task
- **WHEN** the `pull_request: closed` event fires
- **THEN** a new factory run starts on that task

#### Scenario: Per-change PR merges

- **GIVEN** a merged PR labelled `factory:<change-id>` for a `pr: per-change` change
- **WHEN** the `pull_request: closed` event fires
- **THEN** no factory run starts
