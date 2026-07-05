## MODIFIED Requirements

### Requirement: Organization usage settings endpoint

`GET /api/organization/usage` MUST return the authenticated organization's usage data and MUST create any missing usage row with all production-required timestamp columns populated.

#### Scenario: Missing usage row is initialized

- **GIVEN** an authenticated organization with no existing `organization_usage` row
- **WHEN** the frontend requests `GET /api/organization/usage`
- **THEN** the API creates the usage row with `created_at` and `updated_at` values
- **AND** returns `200` with `skus`, `users`, `storage`, and `inventoryItems`
