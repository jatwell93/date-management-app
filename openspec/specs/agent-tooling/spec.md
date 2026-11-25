# agent-tooling Specification

## Purpose

Small repo scripts that save agents tool calls and relay work: a route-to-handler map of the deployed Worker, a one-line PR feedback summary, and manual-command hints from branch cleanup. Built by the factory runner's pilot (`add-spec-factory-runner`).

## Requirements

### Requirement: Route map of the deployed Worker

The repository SHALL provide `scripts/route-map.js`, which prints one line per entry of `MINIMAL_API_ROUTES` in `workers/src/index-minimal.ts` with the method, the path or path pattern, the handler name and the `file:line` of the handler's definition, and a test SHALL fail when any entry's handler cannot be located.

#### Scenario: Agent looks up a route

- **GIVEN** the current `workers/src/index-minimal.ts`
- **WHEN** an agent runs `npm run route-map`
- **THEN** the output contains a line for `GET /api/products` naming `handleGetProducts` and the `file:line` that declares it

#### Scenario: A test mock shares the handler's name

- **GIVEN** `handleGetProducts` is declared in a Worker module and also in a `*.test.ts` mock
- **WHEN** `npm run route-map` runs
- **THEN** the line for `GET /api/products` points at the Worker module, not the test file

#### Scenario: A handler moves out of reach

- **GIVEN** a route table entry whose handler is declared nowhere under `workers/src/`
- **WHEN** `npm run test:tooling` runs
- **THEN** the route-map test fails and names the handler

### Requirement: One-line PR feedback summary

`scripts/pr-feedback.js` SHALL accept `--summary` and then print a single line with the PR number, `settled`, `waitingOn`, the actionable count and the check counts, instead of the JSON report.

#### Scenario: PR waiting on its quiet window

- **GIVEN** a PR whose checks have passed and whose last review was two minutes ago
- **WHEN** `node scripts/pr-feedback.js <pr> --summary` runs
- **THEN** it prints one line containing `settled=false` and `waitingOn=quiet window`

### Requirement: Cleanup prints manual commands for kept branches

`scripts/cleanup-merged.js` SHALL print, after each branch or worktree it keeps, the command the owner could run to delete or inspect it, and SHALL NOT run that command itself.

#### Scenario: Branch with unverified local commits

- **GIVEN** a local branch whose upstream is gone and whose tip is in no merged PR or `origin/main`
- **WHEN** `node scripts/cleanup-merged.js` runs
- **THEN** it prints the keep reason followed by `git branch -D <branch>` as a hint
- **AND** the branch still exists afterwards

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
