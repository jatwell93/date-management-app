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
