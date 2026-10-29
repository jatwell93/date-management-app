## ADDED Requirements

### Requirement: Tickets from an OpenSpec change

The `to-tickets` skill SHALL slice an OpenSpec change into vertical tasks, each verifiable on its own and sized for one fresh context window, and SHALL write nothing until the owner approves the breakdown. On approval it SHALL write the tasks into the change's `tasks.md`, which stays the task list the factory reads, and publish one issue per task as a sub-issue of the change's tracking issue with native blocking links, blockers first. Each task line SHALL carry its issue number.

#### Scenario: Owner approves a breakdown

- **GIVEN** a change with a proposal and spec deltas
- **WHEN** the owner approves the skill's breakdown
- **THEN** `tasks.md` lists each task with its issue number
- **AND** each issue is a sub-issue of the tracking issue, blocked by the issues of its blocking tasks

#### Scenario: Owner rejects the breakdown

- **GIVEN** the skill has shown a breakdown
- **WHEN** the owner asks for tickets to merge or split
- **THEN** no issue is created and `tasks.md` is unchanged until the owner approves a revised breakdown

### Requirement: No commit or push lands on main from a checkout

The repository's git hooks, installed by `npm install`, SHALL refuse a commit while the branch is `main` and any push that updates `refs/heads/main` on the remote, whatever command spells it.

#### Scenario: Checkout switched to main

- **GIVEN** the checkout is on `main`
- **WHEN** anyone runs `git commit`
- **THEN** the pre-commit hook refuses it and names a feature branch to create

#### Scenario: Push to main from a feature branch

- **GIVEN** the checkout is on `feature/x`
- **WHEN** someone runs `git push origin HEAD:main`
- **THEN** the pre-push hook refuses it and nothing reaches the remote

### Requirement: The memory log is written on feature branches only

`scripts/mem-log.js` SHALL refuse to append to `memory.jsonl` while `HEAD` is `main`, leaving the file unchanged.

#### Scenario: Logging on main

- **GIVEN** the checkout is on `main`
- **WHEN** `node scripts/mem-log.js WORKFLOW <title> <body>` runs
- **THEN** it exits non-zero and `memory.jsonl` is unchanged
