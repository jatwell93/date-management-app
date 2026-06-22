## ADDED Requirements

### Requirement: Cross-backend domain constants have a single source of truth

The system SHALL define cross-backend domain values once in the shared module and import them into
both the workers (PostgreSQL) and Express (SQLite) backends, so the two implementations cannot drift
on literal values. These values include the post-disposition status strings, the set of
dispositioned statuses excluded from the markdown worklist, and the markdown day-window thresholds.

#### Scenario: Both backends import the dispositioned-status set

- **GIVEN** the markdown worklist query exists in both the workers and the SQLite backend
- **WHEN** the query excludes already-dispositioned stock
- **THEN** both queries reference the same shared `DISPOSITIONED_STATUSES` constant
- **AND** neither backend hardcodes the status strings as inline literals

#### Scenario: Markdown windows defined once

- **GIVEN** markdown level is computed from days-to-expiry in more than one place
- **WHEN** a level is derived for an item
- **THEN** the day-window thresholds come from the shared markdown constant
- **AND** changing a threshold in one place changes it everywhere

### Requirement: Parity-critical queries have cross-backend conformance tests

Any report or disposition operation implemented in both backends SHALL have a conformance test that
seeds identical data into the PostgreSQL (pglite) and SQLite paths and asserts the results are
identical, including row ordering, so dialect-default differences cannot reach production unnoticed.

#### Scenario: Identical results across engines

- **GIVEN** the same seed rows inserted into the pglite and better-sqlite3 backends
- **WHEN** the detailed expiry worklist, the summary counts, and the sell-through-by-level report run
  on each backend
- **THEN** the returned rows are equal across both backends
- **AND** the row order is equal across both backends

#### Scenario: NULL ordering is pinned

- **GIVEN** sell-through history that includes rows with no markdown level (NULL)
- **WHEN** the sell-through-by-level report runs on each backend
- **THEN** the NULL-level row appears in the same position in both results

#### Scenario: Past defects stay fenced

- **GIVEN** the conformance suite
- **WHEN** it runs
- **THEN** it includes a regression case for each prior drift defect (zero counts, threshold split,
  sold-through reappearing, NULL ordering)

### Requirement: Dual-backend parity is a documented convention

The project conventions SHALL state that logic implemented in both backends must source its shared
values from the shared module and be covered by a conformance test, and the contribution checklist
SHALL include this rule, so the pattern is applied to future work.

#### Scenario: Convention is discoverable

- **GIVEN** an engineer adding logic that exists in both backends
- **WHEN** they consult the project conventions or the PR checklist
- **THEN** the dual-backend parity rule is present and actionable

#### Scenario: Schema changes are kept in sync across migration mechanisms

- **GIVEN** an engineer adding a column expressed in `schema.prisma`, the hand-written
  `prisma/migrations/neon/*.sql`, and the runtime `src/migrations/` path
- **WHEN** they consult the project conventions or the PR checklist
- **THEN** the rule states the three representations must agree and names the
  production-authoritative path (`prisma db push` via `migrate:prod`)
