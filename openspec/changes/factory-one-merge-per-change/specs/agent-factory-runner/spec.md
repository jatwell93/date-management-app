## ADDED Requirements

### Requirement: Owner tasks escalate without a Claude run

When the next unchecked task of a change is marked `(owner)` in `tasks.md`, the router SHALL NOT start a task run. It SHALL add `needs-human` to the change's tracking issue and mention the owner with the task text, without a Claude run. The owner removing `needs-human` SHALL start the next task only when the owner task is ticked on `main`; otherwise the router SHALL escalate again.

#### Scenario: Merge reaches an owner task

- **GIVEN** a change whose next unchecked task is `- [ ] 2.3 (owner) Rotate the vendor key`
- **WHEN** the previous factory PR of the change merges
- **THEN** no Claude run starts
- **AND** the tracking issue gets `needs-human` and a comment naming task 2.3

#### Scenario: Owner resumes without ticking the task

- **GIVEN** an escalated owner task that is still unchecked on `main`
- **WHEN** the owner removes `needs-human`
- **THEN** no Claude run starts
- **AND** the tracking issue gets `needs-human` again

#### Scenario: Owner ticks the task, then resumes

- **GIVEN** an owner task the owner has ticked on `main`
- **WHEN** the owner removes `needs-human`
- **THEN** a task run starts on the next unchecked task

### Requirement: A change can run as one PR

A change whose `## Autonomy` block says `pr: per-change` SHALL keep one open factory PR for all its tasks. Each task SHALL merge `origin/main` into that PR's branch without rewriting pushed commits, and SHALL mark its commits with a `Factory-Task: <n>` trailer. The next task SHALL start when the PR is settled with nothing actionable, found by an hourly sweep, and SHALL NOT wait for a merge. Task runs and babysit passes on that PR SHALL NOT run at the same time. After the last task the runner SHALL mark the PR ready for review and mention the owner. The PR's merge SHALL start no task. A change without the key SHALL run one PR per task.

#### Scenario: Settled per-change PR with tasks left

- **GIVEN** a `pr: per-change` change with an open factory PR that is settled with nothing actionable
- **AND** an unchecked task left in the branch's `tasks.md`
- **WHEN** the hourly sweep runs
- **THEN** a task run starts and pushes the next task to the same PR

#### Scenario: Per-change PR still has work

- **GIVEN** a `pr: per-change` PR with an unanswered bot thread or a check still running
- **WHEN** the sweep runs or the change is dispatched
- **THEN** no task run starts

#### Scenario: Last task done

- **GIVEN** a `pr: per-change` PR whose branch has every task ticked
- **WHEN** the last task run finishes
- **THEN** the PR is ready for review and the owner is mentioned
- **AND** the owner's merge of it starts no task

#### Scenario: Round cap per task

- **GIVEN** a `pr: per-change` PR with `Babysit-Round: 5` on a commit before the newest `Factory-Task` commit, and none after it
- **WHEN** a babysit pass starts
- **THEN** it may commit, as round 1 of the current task

### Requirement: A failed task run is retried once

When a task run fails, the factory SHALL mark the change's tracking issue for a retry, and the hourly sweep SHALL dispatch the change again once the mark is at least an hour old. When the failed run was itself a retry, the factory SHALL escalate with `needs-human` and both run links instead of retrying.

#### Scenario: First failure

- **GIVEN** a task run that fails without opening a PR
- **WHEN** the sweep runs more than an hour later
- **THEN** one new task run starts on the change

#### Scenario: Retry fails too

- **GIVEN** a retried task run that fails
- **WHEN** the failure is reported
- **THEN** the tracking issue gets `needs-human` with both run links
- **AND** no further retry starts

## MODIFIED Requirements

### Requirement: Merged factory PRs start the next task

When a PR labelled `factory:<change-id>` merges and the change runs one PR per task, the factory SHALL start the next unchecked task of that change, and SHALL run at most one review-response pass per PR at a time, capped at 5 babysit rounds per PR as counted by `Babysit-Round: N` trailers. The merge of a `pr: per-change` PR SHALL start no task.

#### Scenario: Factory PR merges

- **GIVEN** a merged PR labelled `factory:<change-id>`
- **AND** the change has another unchecked task
- **WHEN** the `pull_request: closed` event fires
- **THEN** a new factory run starts on that task

#### Scenario: Per-change PR merges

- **GIVEN** a merged PR labelled `factory:<change-id>` for a `pr: per-change` change
- **WHEN** the `pull_request: closed` event fires
- **THEN** no factory run starts
