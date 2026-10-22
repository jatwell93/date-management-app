## ADDED Requirements

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

Before pushing, the runner SHALL compare the branch diff against the change's `no_go` patterns (default `.github/**`, `database/migrations/**`, `scripts/database-backup.sh`) and SHALL NOT push when any changed path matches.

#### Scenario: Diff touches a workflow file

- **GIVEN** a factory branch whose diff against its merge base with `origin/main` includes `.github/workflows/factory.yml`
- **WHEN** the runner reaches the push step
- **THEN** it does not push
- **AND** labels the tracking issue `needs-human` with the matching path

### Requirement: Review-fix passes respect no_go and a persistent round cap

Each babysit pass SHALL run the same `no_go` diff check before pushing, and SHALL stop with `needs-human` instead of pushing once the PR already carries 5 babysit rounds, counted from `Babysit-Round: N` commit trailers so the cap holds across separate workflow runs.

#### Scenario: Bot fix would touch a no_go path

- **GIVEN** a babysit pass whose fix changes a file under `.github/**`
- **WHEN** it reaches the push step
- **THEN** it does not push
- **AND** labels the PR `needs-human` with the matching path

#### Scenario: Fifth round already used

- **GIVEN** a factory PR whose commits include a `Babysit-Round: 5` trailer
- **WHEN** a new review event starts a babysit pass
- **THEN** the pass makes no commit
- **AND** labels the PR `needs-human`

### Requirement: Factory escalates instead of guessing

When a task needs a product decision, touches a `no_go` path, or is an operator task, the runner SHALL label the PR or tracking issue `needs-human`, mention the owner, record the decision in `handover.md`, and stop.

#### Scenario: Task touches a no_go path

- **GIVEN** a task whose change would edit a path listed under `no_go`
- **WHEN** the runner reaches that task
- **THEN** it makes no edit to that path
- **AND** labels the tracking issue `needs-human` with the reason

### Requirement: Merged factory PRs start the next task

When a PR labelled `factory:<change-id>` merges, the factory SHALL start the next unchecked task of that change, and SHALL run at most one review-response pass per PR at a time, capped at 5 fix commits per PR.

#### Scenario: Factory PR merges

- **GIVEN** a merged PR labelled `factory:<change-id>`
- **AND** the change has another unchecked task
- **WHEN** the `pull_request: closed` event fires
- **THEN** a new factory run starts on that task
