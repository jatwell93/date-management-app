## ADDED Requirements

### Requirement: Workers role-aware authorization

The Cloudflare Workers API SHALL enforce the same canonical organization role permissions as the
backend Express API. Workers SHALL extract the role from the verified JWT payload, normalize
legacy Clerk role strings via the shared `normalizeRole` helper, and enforce role-based
authorization on organization, membership, and upload endpoints. Upload initiation and processing
SHALL be limited to `admin` (and `manager` if enabled); `team_member` SHALL receive HTTP 403.
Authorization denials SHALL return generic 403 Forbidden without role details.

#### Scenario: Workers rejects team_member upload

- **GIVEN** an authenticated Workers request from a `team_member` user
- **WHEN** the user calls `POST /api/upload/initiate` or another upload mutation path
- **THEN** the Worker returns HTTP 403 before processing the upload

#### Scenario: Workers allows admin upload

- **GIVEN** an authenticated Workers request from an `admin` user
- **WHEN** the user calls `POST /api/upload/initiate`
- **THEN** the Worker proceeds to the upload initiation handler

#### Scenario: Workers normalizes Clerk role strings

- **GIVEN** a Workers JWT payload containing a legacy Clerk role string
- **WHEN** the role authorization middleware processes the request
- **THEN** the role is normalized to a canonical value before comparison
- **AND** a `Manager` legacy value is treated as `manager`

#### Scenario: Workers GET passthrough for read-only endpoints

- **GIVEN** an authenticated Workers request from any role
- **WHEN** the user calls a GET endpoint that is not role-gated
- **THEN** the request proceeds without role authorization blocking
