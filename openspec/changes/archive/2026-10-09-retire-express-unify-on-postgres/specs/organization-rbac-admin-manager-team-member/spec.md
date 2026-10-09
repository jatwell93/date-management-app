## MODIFIED Requirements

### Requirement: Canonical organization role model

The system SHALL use a single canonical organization role model with roles `admin`, `team_member`,
and an optional `manager` (dev-only until Clerk plan upgrade). Role values SHALL be persisted as
canonical strings and validated at ingress boundaries. Legacy role values (`owner`, `member`,
`Manager`, `Team Member`, `team-member`) SHALL be normalized to canonical values by a shared
`normalizeRole` helper before persistence.

The permission matrix SHALL be: `admin` has full control including organization deletion,
ownership transfer, member/invite/upload management; `manager` (when enabled) has member/invite/
upload management but no organization delete actions; `team_member` is read-only for operational
data and SHALL NOT access user management, invite management, settings, or upload initiation.

A shared role constants module SHALL be exported from `shared/domain/roles.ts` and
re-exported for Workers and frontend use, so all packages reference one permission matrix.

#### Scenario: Legacy roles are normalized to canonical values

- **GIVEN** a user record with a legacy role string `Manager`
- **WHEN** the backfill migration runs
- **THEN** the role is normalized to `manager`
- **AND** subsequent reads return the canonical value

#### Scenario: Unknown role values are rejected

- **GIVEN** an authentication payload with an unrecognized role string
- **WHEN** the ingress normalization boundary processes it
- **THEN** the role is rejected rather than silently persisted

#### Scenario: team_member cannot access admin endpoints

- **GIVEN** an authenticated user with role `team_member`
- **WHEN** the user calls an admin-only endpoint (e.g. `DELETE /api/organization/:id`)
- **THEN** the response is HTTP 403 Forbidden
