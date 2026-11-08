## ADDED Requirements

### Requirement: The factory is distributed as a versioned public repo

The factory SHALL be published in the public repository `software-factory` with version tags. A consumer repo SHALL reference the factory by a pinned tag or commit SHA, and SHALL hold no copy of the factory's scripts, skills or reusable workflows. A factory release SHALL NOT change what runs in a consumer until the consumer changes its pin.

#### Scenario: A release does not reach a consumer by itself

- **GIVEN** a consumer pinned to a SHA
- **WHEN** a new factory version is tagged
- **THEN** the consumer's workflows still run the pinned SHA

#### Scenario: The agent cannot edit the factory

- **GIVEN** a factory run in a consumer
- **WHEN** the agent looks for the factory's scripts
- **THEN** they are in a temp checkout outside the consumer's working tree, and no edit to them can appear in the consumer's PR

### Requirement: A consumer configures the factory in one file

A consumer SHALL configure the factory in `factory.config.yml` at its root. The file SHALL set the gate commands, extra protected paths, review bots, runner setup steps, spend cap, branch prefix, label names, default branch and spec source. The factory SHALL contain no value that belongs to one consumer.

The protected baseline built into the factory SHALL be only `.github/**`, `.claude/**`, `AGENTS.md`, `CLAUDE.md` and `factory.config.yml`. A config or a change SHALL be able to add paths and SHALL NOT be able to remove a baseline path.

#### Scenario: Extra protected path

- **GIVEN** a config that lists `database/migrations/**` as protected
- **WHEN** a factory branch changes a file under it
- **THEN** the no-go check fails and names the file

#### Scenario: Config tries to shrink the baseline

- **GIVEN** a config that tries to un-protect `.github/**`
- **WHEN** the no-go check loads it
- **THEN** it exits with a usage error and protects `.github/**` anyway

### Requirement: Spec frameworks plug in through an adapter

The factory SHALL read and update a change only through a spec-source adapter that can: list active changes; list a change's tasks with their done, owner and blocked-by marks; read the change's autonomy settings; tick a task; archive a change; and scaffold a new change. The factory SHALL ship the OpenSpec adapter, and a consumer SHALL select its adapter in `factory.config.yml`. Adding another adapter SHALL NOT require a change to the router, the guard or the workflows.

#### Scenario: OpenSpec behaves as before

- **GIVEN** a consumer with `spec_source: openspec`
- **WHEN** a plan PR with `factory-ready` merges
- **THEN** the router starts the first unchecked task read from `tasks.md`, as it does today

#### Scenario: Unknown spec source

- **GIVEN** a config with `spec_source: unknown`
- **WHEN** `doctor` runs
- **THEN** it reports the unknown source and lists the adapters installed

### Requirement: One command sets a project up and checks it

`npx software-factory init` SHALL detect the project's stack, propose gate commands, write the config, the caller workflows and a marked pointer block in `AGENTS.md`, run the chosen adapter's setup, and create the labels. It SHALL print or apply the ruleset and secret steps and SHALL NOT write a secret itself. `doctor` SHALL check the secret, labels, ruleset, GitHub App, config and pin, and name each missing item with the command that fixes it. `upgrade` SHALL change the pin and show the diff. Running `init` twice SHALL change nothing the second time.

#### Scenario: Fresh repo

- **GIVEN** a repo with a `package.json` and no factory files
- **WHEN** `init` runs and the owner accepts the proposals
- **THEN** the config, caller workflows and `AGENTS.md` block exist and `doctor` lists only the steps that need the owner's login

#### Scenario: Repeat init

- **GIVEN** a repo where `init` has run
- **WHEN** `init` runs again
- **THEN** no file changes

### Requirement: The factory works without a memory store

`handover` and `resume-change` SHALL work in a consumer that has no memory scripts: the handover file is written and read, and the memory log and recall steps are skipped without error.

#### Scenario: No memory scripts

- **GIVEN** a consumer without `mem-log` or `mem-recall`
- **WHEN** `handover` runs
- **THEN** `handover.md` is written and no error mentions memory

### Requirement: Late reviews and bad change ids are caught before merge

The factory SHALL publish a `factory/reviews-settled` commit status on factory PRs that is pending until the quiet window has ended and every configured review bot has posted, and success after. The factory SHALL reject a change id that is not lowercase letters, digits and hyphens, or is longer than the configured limit, when the plan is written, not when a run starts. The digest SHALL report cost and duration for each run.

#### Scenario: Copilot has not reviewed yet

- **GIVEN** a factory PR where Copilot has not posted its review
- **WHEN** the owner looks at the PR checks
- **THEN** `factory/reviews-settled` is pending

#### Scenario: Capital letter in a change id

- **GIVEN** a change folder named `Fix-Thing`
- **WHEN** the id check runs
- **THEN** it fails and names the folder
