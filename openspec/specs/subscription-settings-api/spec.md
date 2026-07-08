# subscription-settings-api Specification

## Purpose
TBD - created by archiving change fix-subscription-settings-404. Update Purpose after archive.
## Requirements
### Requirement: Subscription settings API reads

The API MUST expose authenticated read endpoints for the subscription settings page in both production Worker and Express-compatible route surfaces.

#### Scenario: Current subscription is requested

- **WHEN** an authenticated organization user sends `GET /api/subscription/current`
- **THEN** the API responds with HTTP 200 and a JSON object containing `tierLevel`, `status`, `billingCycle`, and `currentPeriodEnd`
- **AND** the data is scoped to the authenticated organization.

#### Scenario: Organization usage is requested

- **WHEN** an authenticated organization user sends `GET /api/organization/usage`
- **THEN** the API responds with HTTP 200 and a JSON object containing `skus`, `users`, `storage`, and `inventoryItems`
- **AND** the data is scoped to the authenticated organization.

#### Scenario: Requests are unauthenticated

- **WHEN** a request to either subscription settings endpoint has no valid authentication
- **THEN** the API responds with an authentication error rather than a route-not-found 404.

### Requirement: Organization Usage Timestamp Fix
The system SHALL properly handle timestamps for organization usage records.

#### Scenario: Create organization usage with valid timestamp
- GIVEN a user is creating an organization usage record
- WHEN the user submits the record
- THEN the system creates the record with a valid timestamp
- AND the timestamp is in the correct format

#### Scenario: Worker handles timestamp-safe organization usage creation
- GIVEN a Worker is processing an organization usage creation request
- WHEN the request includes timestamp data
- THEN the Worker properly handles the timestamp
- AND creates the usage record without errors

