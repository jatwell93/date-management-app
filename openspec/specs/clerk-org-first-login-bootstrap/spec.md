# clerk-org-first-login-bootstrap Specification

## Purpose
TBD - created by archiving change add-clerk-organization-management-rbac. Update Purpose after archive.
## Requirements
### Requirement: First-login organization admin bootstrap

The system SHALL provide a deterministic, idempotent first-login bootstrap flow that ensures an
organization exists and assigns the `admin` role to the first authenticated user when no active
admin exists for that organization. Bootstrap SHALL occur after successful Clerk authentication
and SHALL be transactional and retry-safe. When an active admin already exists, the user's role
SHALL be mapped from their Clerk membership role rather than re-assigning admin.

The bootstrap flow sequence SHALL be: (1) user authenticates with Clerk, (2) backend verifies
organization context from the Clerk organization ID, (3) if the organization does not exist it
SHALL be created with the Clerk organization ID, (4) if no active admin exists the current user
SHALL be assigned `admin` transactionally, otherwise the role SHALL be mapped from Clerk
membership, (5) membership and organization context SHALL be returned to the frontend.

The bootstrap service SHALL idempotently ensure a trial subscription record exists for the
organization so that protected routes do not return `403` due to missing subscription state when
Clerk webhooks have not yet provisioned it.

#### Scenario: First user becomes admin

- **GIVEN** a newly authenticated Clerk user belonging to an organization with no active admin
- **WHEN** the frontend calls `POST /api/organization/bootstrap`
- **THEN** the organization is created or confirmed
- **AND** the user is assigned the `admin` role
- **AND** a trial subscription record is ensured for the organization
- **AND** an audit event `role_assigned` is emitted

#### Scenario: Second user maps from Clerk role

- **GIVEN** an organization that already has an active admin
- **WHEN** a second user authenticates and calls `POST /api/organization/bootstrap`
- **THEN** the user's role is mapped from their Clerk membership role
- **AND** no admin re-assignment occurs

#### Scenario: Bootstrap is idempotent on retry

- **GIVEN** a user who has already bootstrapped
- **WHEN** the frontend calls `POST /api/organization/bootstrap` again
- **THEN** the response is the same membership and organization context
- **AND** no duplicate role assignment or audit event is created

#### Scenario: Bootstrap ensures subscription state

- **GIVEN** a freshly bootstrapped organization where Clerk webhooks have not provisioned a subscription
- **WHEN** the bootstrap service runs
- **THEN** a trial subscription record is idempotently created
- **AND** subsequent protected route calls do not return `403` for missing subscription state

