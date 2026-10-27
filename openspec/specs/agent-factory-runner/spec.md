# agent-factory-runner Specification

## Purpose

The factory turns an approved OpenSpec change into merged work without the owner at the keyboard. A GitHub workflow implements one task per run, opens and babysits its PR, starts the next task when the owner merges, and escalates on the change's tracking issue instead of guessing. It never merges, never holds production secrets and never edits a `no_go` path.

## Requirements

### Requirement: Factory runs one OpenSpec task per run without production access

The factory workflow SHALL implement at most one unchecked task of the named OpenSpec change per run, SHALL NOT start a task while an open `factory:<change-id>` PR exists, and SHALL run with no production secrets and with GitHub token permissions limited to contents, pull-requests and issues write.

#### Scenario: Dispatched on a change with unchecked tasks

- **GIVEN** an OpenSpec change with at least one unchecked task in `tasks.md`
- **WHEN** the factory workflow is dispatched with that change id
- **THEN** the runner implements the first unchecked task only
- **AND** pushes a feature branch and opens a PR labelled `factory:<change-id>`
- **AND** updates `openspec/changes/<change-id>/handover.md`

#### Scenario: Triggered again while a factory PR is open

- **GIVEN** an open PR labelled `factory:<change-id>`
- **WHEN** the factory is dispatched or labelled again for that change
- **THEN** the run waits in the `factory-<change-id>` concurrency group behind any running task
- **AND** exits without changes, because a factory PR is still open

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

Each babysit pass SHALL run the same `no_go` diff check before pushing, and SHALL stop with `needs-human` instead of pushing once the PR already carries 5 babysit rounds, counted from `Babysit-Round: N` commit trailers so the cap holds across separate workflow runs.

#### Scenario: Bot fix would touch a no_go path

- **GIVEN** a babysit pass whose fix changes a file under `.github/**`
- **WHEN** it reaches the push step
- **THEN** it does not push
- **AND** labels the PR `needs-human` with the matching path

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

- **GIVEN** a factory PR whose commits include a `Babysit-Round: 5` trailer
- **WHEN** a new review event starts a babysit pass
- **THEN** the pass makes no commit
- **AND** labels the PR `needs-human`

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

When a PR labelled `factory:<change-id>` merges, the factory SHALL start the next unchecked task of that change, and SHALL run at most one review-response pass per PR at a time, capped at 5 babysit rounds per PR as counted by `Babysit-Round: N` trailers.

#### Scenario: Factory PR merges

- **GIVEN** a merged PR labelled `factory:<change-id>`
- **AND** the change has another unchecked task
- **WHEN** the `pull_request: closed` event fires
- **THEN** a new factory run starts on that task

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
