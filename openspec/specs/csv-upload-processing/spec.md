# csv-upload-processing Specification

## Purpose
TBD - created by archiving change harden-security-review-findings. Update Purpose after archive.
## Requirements
### Requirement: Workers Debug Endpoint Removal
The system SHALL remove or production-gate the Workers debug endpoint.

#### Scenario: Debug endpoint unavailable in production
- GIVEN a production Workers environment
- WHEN a request is made to `/api/test-error`
- THEN the endpoint is unavailable
- AND returns an appropriate response

### Requirement: Role-based upload authorization

CSV/XLSX/XLS product catalog and expiry-list upload initiation and processing SHALL be limited to
users with the `admin` role (and `manager` if enabled). `team_member` users SHALL NOT initiate
uploads and SHALL receive HTTP 403 from both the backend Express API and the Cloudflare Workers
API. This authorization SHALL be enforced consistently across both entry paths so that behavior
does not differ depending on which API serves the request.

#### Scenario: team_member cannot initiate upload via backend

- **GIVEN** an authenticated `team_member` user
- **WHEN** the user calls `POST /api/upload/initiate` on the backend Express API
- **THEN** the response is HTTP 403 Forbidden
- **AND** no upload is initiated

#### Scenario: admin can initiate upload via backend

- **GIVEN** an authenticated `admin` user
- **WHEN** the user calls `POST /api/upload/initiate` on the backend Express API
- **THEN** the upload is initiated and the response contains the upload strategy

#### Scenario: Upload authorization is consistent across backend and Workers

- **GIVEN** the same `team_member` user authenticated against both the backend and Workers APIs
- **WHEN** the user attempts to initiate an upload on either API
- **THEN** both APIs return HTTP 403

