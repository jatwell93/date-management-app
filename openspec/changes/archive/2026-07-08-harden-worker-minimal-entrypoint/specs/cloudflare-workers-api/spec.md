## ADDED Requirements

### Requirement: Minimal Worker Entrypoint Behavior Preservation

The minimal Cloudflare Worker API entrypoint SHALL preserve existing route behavior, response headers, upload completion semantics, and catalogue import summaries while its implementation is split into focused Worker modules.

#### Scenario: Error responses retain CORS headers

- **WHEN** the minimal Worker returns an error response for an API request
- **THEN** the response includes the same CORS headers that the entrypoint applied before the refactor

#### Scenario: Rate-limited responses retain rate-limit metadata

- **WHEN** the minimal Worker rate limiter rejects a request
- **THEN** the response includes the same rate-limit headers and status code that the entrypoint applied before the refactor

#### Scenario: Upload completion preserves queue and sync paths

- **WHEN** an upload completion request is accepted
- **THEN** the Worker preserves the existing queue-backed completion path when a queue binding is available
- **AND** preserves the existing synchronous processing fallback when a queue binding is unavailable

#### Scenario: Catalogue upload object races preserve status

- **WHEN** a previously initiated R2 upload object is missing or disappears between metadata lookup and processing
- **THEN** the Worker returns the same not-found or failure semantics that existed before the refactor
