## REMOVED Requirements

### Requirement: Cross-backend domain constants have a single source of truth

**Reason:** Retiring the Express/SQLite backend leaves a single backend (the Worker on Postgres), so
"cross-backend" drift is no longer possible. Replaced by the single-backend "Domain constants have a
single source of truth" requirement, which keeps the shared module as the source of truth for the
Worker's hand-written SQL.

### Requirement: Parity-critical queries have cross-backend conformance tests

**Reason:** With one database engine there is no PostgreSQL-vs-SQLite comparison to make. Replaced by
"Parity-critical queries have a shared-logic conformance test", which keeps real-SQL-on-Postgres
(pglite) verification against the shared TypeScript logic but drops the SQLite arm.

### Requirement: Dual-backend parity is a documented convention

**Reason:** The triplicated-schema and dual-backend-parity conventions (golden rules 5 & 6) no longer
apply once Express and SQLite are removed. Replaced by "Single-backend schema and domain conventions
are documented".

## ADDED Requirements

### Requirement: Domain constants have a single source of truth

The system SHALL define cross-cutting domain values once in the shared module and import them into the
Worker backend so hand-written SQL cannot drift from the business rules. These values include the
post-disposition status strings, the set of dispositioned statuses excluded from the markdown
worklist, and the markdown day-window thresholds. Hand-written SQL SHALL reference the shared constants
rather than hardcoding literals.

#### Scenario: The backend imports the dispositioned-status set

- **GIVEN** the markdown worklist query in the Worker backend
- **WHEN** the query excludes already-dispositioned stock
- **THEN** it references the shared `DISPOSITIONED_STATUSES` constant
- **AND** it does not hardcode the status strings as inline literals

#### Scenario: Markdown windows defined once

- **GIVEN** markdown level is computed from days-to-expiry in more than one place
- **WHEN** a level is derived for an item
- **THEN** the day-window thresholds come from the shared markdown constant
- **AND** changing a threshold in one place changes it everywhere

### Requirement: Parity-critical queries have a shared-logic conformance test

Any report or disposition query whose logic is also expressed in the shared module SHALL have a
conformance test that runs the real SQL against Postgres (pglite) and asserts the results match the
shared TypeScript logic, including row ordering, so dialect defaults and hand-written SQL cannot drift
from the business rules unnoticed.

#### Scenario: SQL results match the shared logic

- **GIVEN** the same seed rows evaluated by the shared TypeScript logic and by the Worker SQL on pglite
- **WHEN** the detailed expiry worklist, the summary counts, and the sell-through-by-level report run
- **THEN** the SQL results equal the shared-logic results
- **AND** the row order is equal

#### Scenario: NULL ordering is pinned

- **GIVEN** sell-through history that includes rows with no markdown level (NULL)
- **WHEN** the sell-through-by-level report runs on pglite
- **THEN** the NULL-level row appears in the position the shared logic specifies

#### Scenario: Past defects stay fenced

- **GIVEN** the conformance suite
- **WHEN** it runs
- **THEN** it includes a regression case for each prior drift defect (zero counts, threshold split,
  sold-through reappearing, NULL ordering)

### Requirement: Single-backend schema and domain conventions are documented

The project conventions SHALL state that there is one backend (the Worker on Postgres) with one
authoritative, executable migration path, that cross-cutting domain values come from the shared module,
and that parity-critical SQL is covered by a shared-logic conformance test. The authoritative migration
path SHALL support forward migration and an explicit recovery policy and SHALL NOT depend on the
retired Prisma tooling. Recovery SHALL distinguish lossless down migrations, Worker rollback while an
expanded schema remains, forward corrective migrations, and point-in-time restore; destructive down
migrations SHALL NOT be required as a universal rollback mechanism.
The contribution checklist SHALL reflect these single-backend rules so the pattern is applied to future
work.

#### Scenario: Convention is discoverable

- **GIVEN** an engineer adding logic or a schema change to the backend
- **WHEN** they consult the project conventions or the PR checklist
- **THEN** the single-backend schema rule and the shared-module/conformance rule are present and
  actionable

#### Scenario: A schema change follows one migration path

- **GIVEN** an engineer adding a column
- **WHEN** they consult the project conventions or the PR checklist
- **THEN** the rule names one Postgres migration path as authoritative
- **AND** that path is executable with a documented rollback and does not depend on Prisma
- **AND** it does not require mirroring the change into a SQLite schema or a runtime SQLite migration

#### Scenario: Production has a deployable migration mechanism after Prisma

- **GIVEN** Prisma and the Express backend have been removed
- **WHEN** a production schema change is deployed
- **THEN** it is applied by the authoritative Neon migration runner that replaced `npm run migrate:prod`
- **AND** the migration declares its compatibility, reversibility, and data-loss class
- **AND** the documented recovery path is executable for that class

### Requirement: Authoritative migration history is replayable and adoptable

The authoritative PostgreSQL migration path SHALL create the latest schema from an empty database and
SHALL safely adopt an existing production-shaped database that was historically managed by Prisma
schema push. Adoption SHALL verify actual PostgreSQL object definitions before recording baseline
metadata and SHALL refuse schema drift.

#### Scenario: Fresh database reaches the latest schema

- **GIVEN** an empty PostgreSQL database
- **WHEN** the canonical baseline and ordered migrations run
- **THEN** the resulting schema fingerprint matches the expected latest schema
- **AND** no Prisma command or manually maintained PGlite schema is required

#### Scenario: Existing production schema is adopted

- **GIVEN** a production-shaped database with no authoritative migration ledger
- **WHEN** the operator runs adoption in dry-run mode
- **THEN** tables, columns, constraints, indexes, defaults, functions, and checks are verified
- **AND** no ledger state or schema object is changed
- **WHEN** the separately approved adoption command runs
- **THEN** baseline identity and checksums are recorded
- **AND** any incompatible existing definition causes the operation to fail

### Requirement: Schema deployment preserves application compatibility

Production schema changes SHALL follow expand/migrate/contract. Migration and Worker deployment SHALL
be coordinated by a required workflow that validates migration identity, target identity, recovery
readiness, schema postconditions, required reference data, database readiness, and schema-dependent
smoke tests before declaring success.

#### Scenario: Worker requires a new column

- **GIVEN** a Worker release that reads or writes a new column
- **WHEN** the release is deployed
- **THEN** an expansion compatible with both old and new Worker versions is applied first
- **AND** the Worker deploy is blocked if migration preflight or postconditions fail
- **AND** destructive contraction occurs only in a later deployment after an observation window

#### Scenario: Concurrent migration runners start

- **GIVEN** one migration runner holds the PostgreSQL advisory lock
- **WHEN** another runner starts
- **THEN** the second runner exits safely without applying or stamping a migration
- **AND** the event is visible in structured migration output

### Requirement: Destructive test databases are isolated and fail closed

PostgreSQL-backed tests SHALL use an isolated per-run database or schema, SHALL require explicit
test-target identity before destructive setup, and SHALL fail rather than skip when setup, reset, seed,
cleanup, or teardown cannot complete. Required pull-request checks SHALL remain runnable without
production credentials.

#### Scenario: Test target is shared or production-like

- **GIVEN** a database URL without the expected per-run target identity and explicit allow token
- **WHEN** destructive test setup starts
- **THEN** setup exits non-zero before changing schema or data
- **AND** logs expose no credentials

#### Scenario: Cleanup fails

- **GIVEN** an isolated PostgreSQL test target whose reset or cleanup fails
- **WHEN** the test command runs
- **THEN** tests do not continue against dirty state
- **AND** the required CI check fails

### Requirement: Backend retirement is manifest-gated

The Express backend SHALL NOT be deleted until source-derived manifests account for every mounted and
unmounted route, frontend/operator consumer, security contract, test behaviour, scheduled action,
script, migration responsibility, middleware/runtime concern, configuration item, workflow, and
operational document. Every manifest row SHALL have a verified Worker/rehome target or an explicit
retirement decision.

#### Scenario: A backend file has no manifest decision

- **GIVEN** a route, job, test, script, document, configuration item, or runtime responsibility under
  `backend/`
- **WHEN** backend deletion readiness is evaluated
- **THEN** an unresolved manifest row blocks deletion
- **AND** broad category-level claims do not count as a verified replacement
