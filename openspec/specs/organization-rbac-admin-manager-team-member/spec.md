# organization-rbac-admin-manager-team-member Specification

## Purpose
Define the canonical organization roles (admin, manager, team member) and the central guard that authorizes actions by role.

## Requirements

### Requirement: Canonical organization role model

The system SHALL use a single canonical organization role model with roles `admin`, `manager`,
and `team_member`. `manager` is a production role: because an organization has at most one active
admin, a second Clerk `org:admin` is stored as `manager`. Role values SHALL be persisted as
canonical strings and validated at ingress boundaries. Legacy role values (`owner`, `member`,
`Manager`, `Team Member`, `team-member`) SHALL be normalized to canonical values by a shared
`normalizeRole` helper before persistence.

The permission matrix SHALL be: `admin` has full control including organization deletion,
ownership transfer, user management (listing, creating, re-roling and deleting users through
`/api/users`), reading the organization audit log, and invite and upload management; `manager`
has invite and upload management and organization settings (for example markdown configuration)
but no organization delete actions and SHALL NOT list, create, re-role or delete users through
`/api/users`; `team_member` is read-only for operational data and SHALL NOT access user
management, invite management, settings, or upload initiation.

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

#### Scenario: manager cannot manage users

- **GIVEN** an authenticated user with role `manager`
- **WHEN** the user calls `GET /api/users`, `POST /api/users`, `PUT /api/users/:id` or
  `DELETE /api/users/:id`
- **THEN** the response is HTTP 403 Forbidden
- **AND** no user is read, created, re-roled or deleted

#### Scenario: manager can edit organization settings

- **GIVEN** an authenticated user with role `manager`
- **WHEN** the user calls `PUT /api/markdown-config`
- **THEN** the request proceeds to the route handler

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

### Requirement: At most one active admin per organization

The system SHALL allow at most one active user with role `admin` in an organization. A user whose
`deleted_at` is set SHALL NOT hold the admin slot. The invariant SHALL be enforced by the database
(a partial unique index over `organization_id` where `role = 'admin'` and `deleted_at IS NULL`),
not by an application-level read followed by a write, so that concurrent writers cannot both
succeed.

Writers SHALL meet the invariant as follows: Clerk-driven grants (first-login bootstrap and the
membership webhook) SHALL store `manager` instead of failing when the slot is taken, including
when a concurrent grant takes the slot between the check and the write; the HTTP paths
`POST /api/users` and `PUT /api/users/:id` SHALL answer HTTP 409 and write nothing.

Changing the organization's admin SHALL be done by the current admin demoting themselves or the
holder first and then promoting the new admin; no path SHALL leave two active admins at any
point.

#### Scenario: The database refuses a second active admin

- **GIVEN** an organization with an active `admin`
- **WHEN** any writer inserts or updates another active user of that organization to `admin`
- **THEN** the write fails with a unique violation on `users_one_active_admin_per_org`

#### Scenario: A deleted admin releases the slot

- **GIVEN** an organization whose only `admin` has been soft-deleted
- **WHEN** another user of that organization is granted `admin`
- **THEN** the write succeeds

#### Scenario: A Clerk-driven grant falls back to manager

- **GIVEN** an organization with an active `admin`
- **WHEN** a Clerk membership event grants `org:admin` to a different user
- **THEN** that user is stored as `manager`
- **AND** the event is processed successfully

#### Scenario: The HTTP paths answer 409

- **GIVEN** an organization with an active `admin` and an authenticated `admin` caller
- **WHEN** the caller creates a user with role `admin`, or re-roles another user to `admin`
- **THEN** the response is HTTP 409 with a message telling the caller to change the current admin
  first
- **AND** no role is changed

#### Scenario: A manager cannot take the admin slot

- **GIVEN** an organization whose admin is `A` and which has a `manager` `M`
- **WHEN** `M` calls `PUT /api/users/:id` to demote `A` and then to promote `M`
- **THEN** the first call is refused with HTTP 403
- **AND** `A` remains the organization's admin
