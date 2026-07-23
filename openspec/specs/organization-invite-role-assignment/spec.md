# organization-invite-role-assignment Specification

## Purpose
TBD - created by archiving change add-clerk-organization-management-rbac. Update Purpose after archive.
## Requirements
### Requirement: Invite lifecycle with role assignment

The system SHALL provide a complete organization invite lifecycle: create invite, resend invite,
revoke invite, and token-based accept flow with role assignment at acceptance. Invite creation
SHALL validate the role against canonical values using `isValidRole`. Acceptance SHALL require
email match against the verified Clerk identity, enforce one-time token use, and assign the
invited role with organization scoping.

Resend SHALL issue a new token (not reuse the old one) and SHALL NOT resend invites that are
already `ACCEPTED`, `REVOKED`, or `EXPIRED`. Revoke SHALL clear the stored token hash. All invite
actions (create, accept, revoke, resend) SHALL emit audit events.

#### Scenario: Invite creation with canonical role

- **GIVEN** an admin user
- **WHEN** the user creates an invite with role `team_member`
- **THEN** the invite is persisted with the canonical role value
- **AND** an audit event `invite_created` is emitted
- **AND** an email is sent with the accept link and expiration date

#### Scenario: Invite acceptance requires email match

- **GIVEN** a pending invite for `alice@example.com`
- **WHEN** a Clerk user with a different verified email attempts to accept
- **THEN** the acceptance is rejected
- **AND** no role is assigned

#### Scenario: Invite token is one-time use

- **GIVEN** a pending invite with a stored bcrypt token hash
- **WHEN** the invite is accepted with the correct token
- **THEN** the token hash is cleared from the invite record
- **AND** a second acceptance attempt with the same token is rejected

#### Scenario: Invite resend issues a new token

- **GIVEN** a pending invite
- **WHEN** the admin resends the invite
- **THEN** a new token is generated and hashed
- **AND** the old token hash is replaced
- **AND** a new email is sent

#### Scenario: Cannot resend a non-pending invite

- **GIVEN** an invite with status `ACCEPTED`
- **WHEN** the admin attempts to resend
- **THEN** the request is rejected with a validation error

### Requirement: Invite token hashing

Invite tokens SHALL be stored as bcrypt hashes (cost factor 12), never as plaintext. Token
generation SHALL create a 32-byte random token, hash it, store the hash, and return the raw token
to the caller. Acceptance SHALL compare the incoming token against the stored hash using
`bcrypt.compare`. This prevents token theft via database compromise.

#### Scenario: Token hash is stored, not plaintext

- **GIVEN** a newly created invite
- **WHEN** the invite record is inspected in the database
- **THEN** the `inviteTokenHash` column contains a bcrypt hash
- **AND** the raw token is not present in any database column

#### Scenario: Expired invite token is cleared

- **GIVEN** an invite whose `expiresAt` has passed
- **WHEN** a user attempts to accept it
- **THEN** the acceptance is rejected
- **AND** the token hash is cleared

