## ADDED Requirements

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
