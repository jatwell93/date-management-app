## MODIFIED Requirements

### Requirement: Inventory expiry submission uses a fresh Clerk token

The scan page SHALL request a current Clerk session token before submitting an online expiry item to the API. If a fresh token cannot be obtained, the scan page MAY fall back to the existing in-memory auth token.

#### Scenario: Online expiry item submit after token refresh

- **GIVEN** a signed-in user has scanned a product and filled expiry item details
- **AND** the prop auth token is stale
- **WHEN** the user submits the expiry item while online
- **THEN** the frontend submits `POST /api/inventory-items` with the freshly retrieved Clerk session token
