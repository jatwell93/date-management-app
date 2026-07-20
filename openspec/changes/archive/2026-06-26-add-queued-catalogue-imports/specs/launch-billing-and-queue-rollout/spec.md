## ADDED Requirements

### Requirement: Launch Checkout catalog
The application SHALL allow new Stripe Checkout sessions only for configured Starter monthly, Starter annual, Professional monthly, and Professional annual test prices.

#### Scenario: Supported launch price
- **WHEN** an authenticated organization requests Checkout with one of the four configured launch price IDs
- **THEN** the backend creates a subscription Checkout session for that exact price

#### Scenario: Legacy or arbitrary price
- **WHEN** Checkout is requested with a Premium, Concierge, missing, placeholder, or otherwise unconfigured price ID
- **THEN** the backend rejects the request before calling Stripe

### Requirement: Historical tier compatibility
The application SHALL normalize historical Premium subscription data to Professional and historical Concierge subscription data to Enterprise without exposing those legacy tiers as new purchase choices.

#### Scenario: Historical webhook metadata
- **WHEN** a Stripe webhook contains `premium` or `concierge` tier metadata
- **THEN** the stored canonical tier is `professional` or `enterprise` respectively

### Requirement: Deployment price validation
Deployment SHALL fail before publishing when any required launch price variable is missing, uses a placeholder value, is not a Stripe price ID, is duplicated across launch choices, or is inconsistent with the configured Stripe test mode.

#### Scenario: Valid test configuration
- **WHEN** all four unique `price_` IDs and an `sk_test_` secret are configured
- **THEN** deployment validation succeeds even for the production Doppler config during the pre-launch test-mode period

#### Scenario: Invalid configuration
- **WHEN** a required value is empty, `fill`, malformed, duplicated, or paired with an unsupported Stripe secret mode
- **THEN** deployment validation fails with the affected variable identified

### Requirement: Queue rollout controls
The Worker SHALL bind development and production catalogue queues and dead-letter queues while keeping production catalogue queue processing disabled until explicit approval.

#### Scenario: Development rollout
- **WHEN** the development Worker is deployed
- **THEN** catalogue imports are enqueued and consumed through `catalogue-imports-dev` with failures routed to `catalogue-imports-dev-dlq`

#### Scenario: Production bindings before approval
- **WHEN** the production Worker is deployed before telemetry approval
- **THEN** the production queue bindings exist and `CATALOGUE_QUEUE_ENABLED` remains `false`
