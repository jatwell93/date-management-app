## MODIFIED Requirements

### Requirement: Error handling
The system SHALL provide consistent error handling and reporting for all Workers endpoints without exposing unauthenticated production debug error triggers.

#### Scenario: Unhandled exception
- **WHEN** request handler throws unexpected error
- **THEN** Workers SHALL catch error and return 500 Internal Server Error
- **AND** error details SHALL be logged to Cloudflare Analytics
- **AND** response SHALL not expose internal implementation details.

#### Scenario: Production debug endpoint unavailable
- **WHEN** a production-like Workers request targets `/api/test-error`
- **THEN** Workers SHALL NOT throw a synthetic debug error
- **AND** Workers SHALL return the normal not-found response or otherwise keep the endpoint unavailable.
