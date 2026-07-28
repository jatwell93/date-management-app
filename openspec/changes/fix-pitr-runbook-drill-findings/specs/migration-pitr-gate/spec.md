## ADDED Requirements

### Requirement: PITR gate targets the Neon production branch

The migration-prep workflow and the `check-neon-pitr.js` PITR readiness check SHALL target the Neon branch named `production` (not the Git branch `main`; the two are distinct objects with different IDs). The workflow SHALL accept a `neon_branch` input (default `production`) and pass it through as `NEON_BRANCH` to the PITR check script. The script SHALL default `NEON_BRANCH` to `production` when the environment variable is unset.

#### Scenario: Workflow defaults to the Neon production branch

- **GIVEN** the `migration-prep.yml` workflow is dispatched without a
  `neon_branch` input
- **WHEN** the `pitr-check` step runs
- **THEN** the `NEON_BRANCH` environment variable passed to
  `check-neon-pitr.js` is `production`
- **AND** the script resolves and filters snapshots for the Neon
  branch named `production`

#### Scenario: Workflow overrides the Neon branch

- **GIVEN** the `migration-prep.yml` workflow is dispatched with
  `neon_branch` set to `staging`
- **WHEN** the `pitr-check` step runs
- **THEN** the `NEON_BRANCH` environment variable passed to
  `check-neon-pitr.js` is `staging`
- **AND** the script resolves and filters snapshots for the Neon
  branch named `staging`

#### Scenario: Script defaults to production when NEON_BRANCH is unset

- **GIVEN** `check-neon-pitr.js` is run locally without `NEON_BRANCH`
  set in the environment
- **WHEN** the script resolves the target branch
- **THEN** it resolves the Neon branch named `production`
- **AND** a recent snapshot on a `main`-named Neon branch does NOT
  satisfy the gate

### Requirement: PITR check normalizes branch_id and source_branch_id

The `check-neon-pitr.js` `extractSnapshots` function SHALL normalize
the originating branch identifier from both `branch_id` (project
snapshot listings) and `source_branch_id` (snapshot-restore /
branch-creation response shapes), preferring `branch_id` when both
are present. The branch filter SHALL attribute a snapshot to the
correct branch regardless of which key the Neon API used, and SHALL
NOT attribute a cross-branch snapshot to a different branch.

#### Scenario: source_branch_id is normalized when branch_id is absent

- **GIVEN** the Neon snapshots API returns a snapshot with
  `source_branch_id` set to `br-prod` and no `branch_id` key
- **WHEN** `extractSnapshots` processes the response
- **THEN** the snapshot's `branchId` is `br-prod`
- **AND** `filterSnapshotsByBranch` matches it for `br-prod`

#### Scenario: branch_id is preferred when both keys are present

- **GIVEN** the Neon snapshots API returns a snapshot with
  `branch_id` set to `br-prod` and `source_branch_id` set to
  `br-other`
- **WHEN** `extractSnapshots` processes the response
- **THEN** the snapshot's `branchId` is `br-prod`

#### Scenario: Cross-branch source_branch_id snapshot does not satisfy another branch's gate

- **GIVEN** the Neon snapshots API returns a recent snapshot with
  `source_branch_id` set to `br-dev`
- **AND** the gate is checking the `production` branch (`br-prod`)
- **WHEN** `main()` evaluates PITR readiness
- **THEN** the gate fails (exit 1)
- **AND** the evidence reports `branchSnapshotCount: 0`

### Requirement: Runbook distinguishes the Neon production branch from the Git main branch

The migrations-deploy runbook SHALL refer to the Neon production
branch as `production` (not `main`) in all Neon-branch contexts:
branch resolution, snapshot creation, restore targets, orphaned
branch names (`production (old)`), REST API `search=` query
parameters, and prose references to the production database branch.
Git branch `main` references (push-to-main, `workflow_dispatch from
main`, `git push origin main`) SHALL be preserved as Git branch
references.

#### Scenario: PITR drill resolves the Neon production branch

- **GIVEN** an operator follows the Step 1a PITR drill in the runbook
- **WHEN** the operator resolves the branch ID for snapshot creation
- **THEN** the REST API call uses `search=production`
- **AND** the bash variable is named `PROD_BRANCH_ID` (not
  `MAIN_BRANCH_ID`)

#### Scenario: Rollback restores onto the Neon production branch

- **GIVEN** an operator follows the Step 4c catastrophic rollback
- **WHEN** the operator resolves the restore target branch ID
- **THEN** the REST API call uses `search=production`
- **AND** the orphaned pre-restore branch is expected to be renamed
  `production (old)` (not `main (old)`)
- **AND** the safety checks compare against the current Neon
  production branch ID (not the Git main branch)

### Requirement: Pre-adoption PITR drill uses pre-adoption acceptance criteria

The migrations-deploy runbook SHALL define separate acceptance
criteria for the pre-adoption PITR drill (run before the one-time
adoption gate) vs the regular pre-deploy drill (run before a normal
migration on an already-adopted database). The pre-adoption drill
SHALL NOT expect `migrate:verify` PASS, because a pre-adoption
snapshot predates the `schema_migrations` ledger and migration
`0010`, so `migrate:verify` cannot pass on it. Instead, the
pre-adoption drill SHALL require: (a) successful restore polling, (b)
restored-state fidelity checks (table count matches the pre-adoption
count, not the post-0010 count), and (c) `migrate:preflight` PASS
(read-only, reports the ledger as not-initialized).

#### Scenario: Pre-adoption drill does not require migrate:verify PASS

- **GIVEN** an operator runs the pre-adoption PITR drill
- **WHEN** the restored branch is a pre-adoption snapshot (no
  `schema_migrations` ledger, `0010` not applied)
- **THEN** the drill acceptance criteria are: successful restore
  polling, restored-state fidelity checks, and `migrate:preflight`
  PASS
- **AND** `migrate:verify` is NOT run (or its failure is NOT a drill
  failure)

#### Scenario: Regular drill still requires migrate:verify PASS

- **GIVEN** an operator runs the regular pre-deploy PITR drill on an
  already-adopted database
- **WHEN** the restored branch is at the latest schema
- **THEN** the drill acceptance criteria include `migrate:verify`
  PASS

### Requirement: Role-check Worker procedure builds and locates wrangler config

The migrations-deploy runbook's role-check Worker procedure SHALL
build the Worker artifact (`npm run build:workers`) before
`wrangler deploy`, because `wrangler deploy` does not build for
itself. Every `wrangler` invocation (deploy, secret put, delete)
SHALL pass `--config workers/wrangler.toml` when run from the repo
root, or be run from the `workers/` directory so Wrangler discovers
`wrangler.toml`.

#### Scenario: Build runs before deploy

- **GIVEN** an operator follows the step 5 role-check Worker
  procedure
- **WHEN** the operator runs the deploy block
- **THEN** `npm run build:workers` runs before `wrangler deploy`
- **AND** the deployed artifact is the freshly built `dist/index.js`

#### Scenario: Wrangler finds the config from the repo root

- **GIVEN** an operator runs the step 5 procedure from the repo root
- **WHEN** the operator runs `wrangler deploy --env role_check`
- **THEN** the command includes `--config workers/wrangler.toml`
- **AND** Wrangler resolves the `role_check` environment and the
  `main`/build paths from the config file

### Requirement: Runtime role password is set via history-protected ALTER ROLE

The migrations-deploy runbook's role creation procedure SHALL set the `app_runtime` password via a history-protected `ALTER ROLE` procedure, not the `\password` psql meta-command. The procedure SHALL: (a) generate a cryptographically strong password to a `chmod 600` temp file, (b) install an EXIT/INT/TERM cleanup trap immediately after the temp file is created that validates the path is within the system temp dir and is a regular file before removing it, (c) read the password into a psql variable via `\set` backtick expansion, (d) run `ALTER ROLE app_runtime PASSWORD :'pw';` with the variable quoting syntax, (e) `\unset` the variable, and (f) securely delete the temp file via the trap. The password SHALL NOT appear in shell history, psql history, or process arguments. The pooled `app_runtime` connection URI SHALL be obtained from Neon's `connection_uri` REST API (not hand-constructed from the password) and stored in Doppler before the temp password file is destroyed, because base64 passwords contain `+`, `/`, and `=` characters that are not URL-safe and must be percent-encoded.

#### Scenario: Password is generated to a temp file

- **GIVEN** an operator follows the step 1 role creation procedure
- **WHEN** the operator runs the password generation step
- **THEN** `openssl rand -base64 32` writes the password to a `chmod 600` temp file
- **AND** the password is not in a shell variable that could be logged

#### Scenario: Cleanup trap is installed immediately after temp file creation

- **GIVEN** the temp password file has been created
- **WHEN** the operator proceeds to the psql session
- **THEN** an EXIT/INT/TERM trap is already armed
- **AND** the trap validates that `PWFILE` is non-empty, is a regular file, and is within the system temp dir before removing it
- **AND** if the operator Ctrl-C's the psql session, the trap fires and destroys the temp file

#### Scenario: ALTER ROLE uses a psql variable, not a literal

- **GIVEN** the operator is in the interactive psql session
- **WHEN** the operator sets the password
- **THEN** the operator runs `\set pw \`cat $PWFILE\`` to load the password into a psql variable
- **AND** the operator runs `ALTER ROLE app_runtime PASSWORD :'pw';` (variable reference, not a literal)
- **AND** psql history records the `\set` and `ALTER ROLE` commands without the password value

#### Scenario: Pooled connection URI is obtained from Neon's connection_uri API, not hand-constructed

- **GIVEN** the `app_runtime` password has been set via `ALTER ROLE`
- **WHEN** the operator captures the pooled connection URI for Doppler
- **THEN** the operator calls Neon's `connection_uri` REST API with `role_name=app_runtime` and `pooled=true`
- **AND** the API returns a complete, correctly-percent-encoded URI
- **AND** the operator does NOT hand-construct the URI by interpolating the base64 password (which contains `+`, `/`, `=` characters that are not URL-safe)
- **AND** the URI is stored in Doppler via stdin (`printf '%s' "$URI" | doppler secrets set`) so it is not in shell history or process args

#### Scenario: Temp file is securely deleted after use

- **GIVEN** the psql session has exited and the connection URI has been captured and stored in Doppler
- **WHEN** the shell exits (triggering the EXIT trap)
- **THEN** the temp file is overwritten and removed (`shred -u` or `rm -f` fallback)
- **AND** the `PWFILE` shell variable is unset
- **AND** the trap refuses to remove a path outside the system temp dir
