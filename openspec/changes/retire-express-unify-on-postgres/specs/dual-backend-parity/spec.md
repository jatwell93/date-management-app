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

The project conventions SHALL state that there is one backend (the Worker on Postgres) with one schema
and migration path, that cross-cutting domain values come from the shared module, and that
parity-critical SQL is covered by a shared-logic conformance test. The contribution checklist SHALL
reflect these single-backend rules so the pattern is applied to future work.

#### Scenario: Convention is discoverable

- **GIVEN** an engineer adding logic or a schema change to the backend
- **WHEN** they consult the project conventions or the PR checklist
- **THEN** the single-backend schema rule and the shared-module/conformance rule are present and
  actionable

#### Scenario: A schema change follows one migration path

- **GIVEN** an engineer adding a column
- **WHEN** they consult the project conventions or the PR checklist
- **THEN** the rule names one Postgres schema/migration path as authoritative
- **AND** it does not require mirroring the change into a SQLite schema or a runtime SQLite migration
