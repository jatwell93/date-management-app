## REMOVED Requirements

### Requirement: Role-based upload authorization

**Reason:** The requirement and its scenarios describe two entry paths (the Express API and the
Workers API) that must agree. Express is retired, so there is one path. Replaced by "Upload
authorization is limited to admin and manager", which keeps the same rule for the Worker.

## ADDED Requirements

### Requirement: Upload authorization is limited to admin and manager

CSV/XLSX/XLS product catalog and expiry-list upload initiation and processing SHALL be limited to
users with the `admin` role (and `manager` if enabled). `team_member` users SHALL NOT initiate
uploads and SHALL receive HTTP 403 from the Cloudflare Workers API.

#### Scenario: team_member cannot initiate upload

- **GIVEN** an authenticated `team_member` user
- **WHEN** the user calls `POST /api/upload/initiate` on the Workers API
- **THEN** the response is HTTP 403 Forbidden
- **AND** no upload is initiated

#### Scenario: admin can initiate upload

- **GIVEN** an authenticated `admin` user
- **WHEN** the user calls `POST /api/upload/initiate` on the Workers API
- **THEN** the upload is initiated and the response contains the upload strategy
