## ADDED Requirements

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

A shared role constants module SHALL be exported from `backend/src/constants/roles.ts` and
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

### Requirement: Centralized role authorization guard

The system SHALL provide a centralized `requireOrgRole` middleware that accepts required role(s)
and verifies the authenticated user's role against the requirement, returning HTTP 403 for
insufficient privileges. The guard SHALL replace scattered route-local role checks on organization
management, invite, user management, and upload routes. Authorization denials SHALL return generic
403 Forbidden without role details to prevent role enumeration.

#### Scenario: requireOrgRole rejects insufficient role

- **GIVEN** an authenticated `team_member` user
- **WHEN** the user calls a route guarded by `requireOrgRole('admin')`
- **THEN** the response is HTTP 403
- **AND** the response body does not reveal which role is required

#### Scenario: requireOrgRole allows sufficient role

- **GIVEN** an authenticated `admin` user
- **WHEN** the user calls a route guarded by `requireOrgRole('admin', 'manager')`
- **THEN** the request proceeds to the route handler

#### Scenario: Legacy role normalization in guard

- **GIVEN** an authenticated user whose JWT carries a legacy Clerk role string
- **WHEN** the `requireOrgRole` middleware processes the request
- **THEN** the role is normalized before comparison
- **AND** a `Manager` legacy value is treated as `manager`
