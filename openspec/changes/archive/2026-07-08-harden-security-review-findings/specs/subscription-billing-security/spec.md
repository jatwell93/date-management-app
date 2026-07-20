# Delta for Subscription Billing Security

## ADDED Requirements

### Requirement: Stripe Price Allowlist
The system SHALL implement backend-configured price allowlist enforcement for Stripe checkout.

#### Scenario: Reject arbitrary price IDs
- GIVEN a checkout request with an arbitrary valid-looking price ID
- WHEN the request is processed
- THEN the system rejects the price ID
- AND returns an error response

#### Scenario: Accept configured price IDs
- GIVEN a checkout request with a configured monthly or annual price ID
- WHEN the request is processed
- THEN the system accepts the price ID
- AND processes the checkout

### Requirement: Product Upload Limits
The system SHALL enforce file size limits for product uploads.

#### Scenario: Reject oversized files
- GIVEN a product upload request with a file larger than the configured limit
- WHEN the request is processed
- THEN the system rejects the file
- AND returns a 400 error response

#### Scenario: Accept valid files within limit
- GIVEN a product upload request with a valid CSV/XLSX file within the configured limit
- WHEN the request is processed
- THEN the system accepts the file
- AND processes the upload