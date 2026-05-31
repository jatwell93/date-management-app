## ADDED Requirements

### Requirement: Backend Stripe Price Authorization
The backend billing checkout flow SHALL only create Stripe checkout sessions for server-configured subscription price IDs.

#### Scenario: Unknown Stripe price rejected
- **WHEN** an authenticated checkout request supplies a syntactically valid `price_...` ID that is not configured on the backend
- **THEN** the API SHALL reject the request with `400 Bad Request`
- **AND** the API SHALL NOT call Stripe checkout session creation.

#### Scenario: Configured subscription prices accepted
- **WHEN** an authenticated checkout request supplies a configured monthly or annual subscription price ID
- **THEN** the API SHALL allow checkout session creation to proceed
- **AND** the Stripe request SHALL use the configured price ID.
