## ADDED Requirements

### Requirement: Minimal Worker Clerk and Catalogue Extraction Preservation

The minimal Cloudflare Worker API entrypoint SHALL preserve existing Clerk bootstrap, Clerk webhook, upload completion, and catalogue import behavior while their implementation is moved into focused Worker modules.

#### Scenario: Clerk bootstrap route is unchanged

- **WHEN** a client calls `POST /api/organization/bootstrap`
- **THEN** the Worker authenticates the Clerk bearer token and returns the same success and error responses as before extraction

#### Scenario: Clerk webhook route is unchanged

- **WHEN** Clerk sends a webhook to `/api/webhooks/clerk` or `/webhooks/clerk`
- **THEN** the Worker verifies Svix headers, applies idempotency, dispatches supported events, and returns the same statuses and response bodies as before extraction

#### Scenario: Catalogue import processing is unchanged

- **WHEN** a queued catalogue import job runs
- **THEN** the Worker preserves existing validation, quota, checkpoint, product upsert, conflict, R2 error-report, and queue-resume semantics

#### Scenario: Upload completion processing is unchanged

- **WHEN** an upload completion request is accepted
- **THEN** the Worker preserves both queue-backed catalogue completion and synchronous upload processing fallback behavior

