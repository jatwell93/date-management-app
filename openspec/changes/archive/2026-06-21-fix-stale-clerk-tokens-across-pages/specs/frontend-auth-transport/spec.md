## MODIFIED Requirements

### Requirement: Authenticated frontend API requests use current Clerk tokens

Authenticated frontend pages SHALL request a current Clerk session token immediately before protected API requests. If Clerk token refresh fails or returns no token, the page MAY fall back to the existing in-memory auth token and SHALL record refresh failures without logging token values.

#### Scenario: Protected request after prop token expiry

- **GIVEN** a signed-in user still has an active Clerk session
- **AND** the route prop token is stale
- **WHEN** an authenticated frontend page performs a protected API request
- **THEN** the frontend sends the freshly retrieved Clerk session token to `apiService`

#### Scenario: Token refresh failure fallback

- **GIVEN** a signed-in user has an existing in-memory auth token
- **AND** Clerk token refresh fails before a protected API request
- **WHEN** the frontend performs the request
- **THEN** the frontend sends the existing in-memory auth token
- **AND** captures the refresh failure to Sentry without token values
