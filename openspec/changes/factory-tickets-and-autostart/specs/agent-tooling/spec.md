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

### Requirement: Agent sessions do not commit on main

A Claude Code PreToolUse hook SHALL refuse a Bash `git commit` or `git push` while `HEAD` is `main`, and a `git push` whose refspec targets `main`.

#### Scenario: Checkout switched to main

- **GIVEN** the checkout is on `main`
- **WHEN** an agent runs `git commit`
- **THEN** the hook blocks the command and names a feature branch to create

### Requirement: The memory log is written on feature branches only

`scripts/mem-log.js` SHALL refuse to append to `memory.jsonl` while `HEAD` is `main`, leaving the file unchanged.

#### Scenario: Logging on main

- **GIVEN** the checkout is on `main`
- **WHEN** `node scripts/mem-log.js WORKFLOW <title> <body>` runs
- **THEN** it exits non-zero and `memory.jsonl` is unchanged
