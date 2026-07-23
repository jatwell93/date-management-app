# cloudflare-workers-api Specification

## Purpose
TBD - created by archiving change extract-worker-clerk-catalogue-import. Update Purpose after archive.
## Requirements
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

### Requirement: Expired Loss Report Route Deployment Parity

The Cloudflare Workers API SHALL expose the expired-loss report route in built and deployed route tables.

#### Scenario: Expired loss report route is not route-not-found

- **WHEN** a request is made to `GET /api/expired-items/reports/expired-losses`
- **THEN** the Worker route dispatcher matches the expired-loss report handler
- **AND** the response is not HTTP 404 route-not-found
- **AND** authenticated requests return a body containing `lossesBySKU` and `lossesByStoreArea`

#### Scenario: Live smoke probe detects stale deployment

- **WHEN** the deployment smoke check probes `https://api.expirymate.com.au/api/expired-items/reports/expired-losses`
- **THEN** a route-not-found HTTP 404 response fails the smoke check
- **AND** authentication-related responses are allowed for unauthenticated probes

### Requirement: Expired Items Grouped Quantity Processing

Expired item worklist and processing behavior SHALL use grouped quantity availability for same product, location, expiry, and cost pool rows.

#### Scenario: Grouped expired worklist reports available quantity

- **WHEN** multiple expired inventory rows share the same product, location, expiry date, and cost price
- **THEN** the expired items worklist returns one grouped row
- **AND** that grouped row has `quantityAvailable` equal to the number of matching undispositioned rows

#### Scenario: Multi-unit expired write-off processes exact requested units

- **WHEN** an authenticated user processes an expired grouped row with `unitsDiscarded` set to `N`
- **THEN** exactly `N` matching inventory rows are marked disposed
- **AND** exactly one expired item transaction is recorded with `unitsDiscarded` equal to `N`
- **AND** financial loss equals `N` multiplied by the grouped unit cost

### Requirement: Expired Items Dialog Quantity UX

The expired item process dialog SHALL present grouped item details and quantity controls with consistent typography while preserving editable whole-number quantity entry.

#### Scenario: Dialog detail typography is consistent

- **WHEN** a user opens the expired write-off dialog for a grouped expired item
- **THEN** Product, SKU, Location, Expiry Date, Cost Price, quantity helper text, and quantity error text use the dialog detail typography system
- **AND** the dialog does not mix monospace, muted helper, and tabular number styles for these values

#### Scenario: User can submit a non-one grouped quantity

- **WHEN** a grouped expired item has `quantityAvailable` of `100`
- **AND** the user enters `37`
- **THEN** the confirmation copy shows `37` units and the calculated loss
- **AND** the process request sends `{ unitsDiscarded: 37 }`

### Requirement: Expired Items Workers API Parity

The Cloudflare Workers API SHALL preserve frontend-compatible expired item processing and expired-loss reporting behavior for `/api/expired-items`.

#### Scenario: Expired loss report route returns frontend shape

- **WHEN** an authenticated user requests `GET /api/expired-items/reports/expired-losses`
- **THEN** the Worker returns HTTP 200
- **AND** the response body contains `lossesBySKU`
- **AND** the response body contains `lossesByStoreArea`

#### Scenario: Expired write-off processes requested quantity

- **WHEN** an authenticated user posts `POST /api/expired-items/process` with action `expired` and `unitsDiscarded` greater than `1`
- **THEN** the Worker processes exactly that many matching expired inventory rows for the same product, store area, and cost group
- **AND** the Worker records one expired item transaction with `units_discarded` equal to the requested quantity
- **AND** the Worker records `financial_loss` equal to requested quantity multiplied by unit cost
- **AND** processed rows no longer appear in the expired items worklist

#### Scenario: Expired write-off quantity bounds are enforced

- **WHEN** an authenticated user posts an expired write-off with `unitsDiscarded` below `1`, non-integer, or greater than the grouped available quantity
- **THEN** the Worker rejects the request with a validation error
- **AND** no inventory rows are dispositioned
- **AND** no expired item transaction is recorded

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

### Requirement: Expired loss report route is present in deployed Worker artifact

The Workers API SHALL register `GET /api/expired-items/reports/expired-losses` in the minimal Worker entrypoint used by production builds.

#### Scenario: Built artifact contains expired loss report route

- **GIVEN** the production Worker is built from `workers/src/index-minimal.ts`
- **WHEN** `npm run build --prefix workers` completes
- **THEN** `workers/dist/index.js` contains `/api/expired-items/reports/expired-losses`
- **AND** this route is not implemented only in `workers/src/index.ts`

#### Scenario: Live expired loss report route is not route-missing

- **WHEN** a smoke check probes `https://api.expirymate.com.au/api/expired-items/reports/expired-losses`
- **THEN** a `404` response fails the check
- **AND** authentication, rate-limit, or server responses are accepted as route-present signals

#### Scenario: PR preview frontend uses a fresh development Worker

- **GIVEN** a pull request changes Worker source, Worker tests, Worker package scripts, or Worker deploy configuration
- **WHEN** the pull request is opened or updated from a trusted branch
- **THEN** CI deploys the `development` Worker environment used by Pages previews
- **AND** the preview frontend is not left pointing at a stale `date-management-api-dev` deployment

### Requirement: Organization bootstrap uses the Worker database connection path

Organization bootstrap SHALL use a database connection string that is compatible with the Worker SQL client.

#### Scenario: Direct Neon and Hyperdrive connection strings are both configured

- **GIVEN** `NEON_CONNECTION_STRING` and `HYPERDRIVE.connectionString` are both available
- **WHEN** `POST /api/organization/bootstrap` runs bootstrap SQL
- **THEN** the Worker uses `NEON_CONNECTION_STRING` before falling back to Hyperdrive
- **AND** the response carries CORS headers for the request origin

### Requirement: Expired write-offs preserve multi-unit quantities and realized loss

Expired write-offs SHALL process exactly the requested number of matching inventory rows and record realized loss from the expired item transaction ledger.

#### Scenario: User submits a multi-unit expired write-off

- **GIVEN** an expired grouped row has `quantityAvailable` greater than `1`
- **WHEN** the user clears `#units-discarded` and types a whole number `N` within the available quantity
- **THEN** the field shows the full value typed
- **AND** the confirmation text references `N units`
- **AND** the API receives `{ inventoryItemId, action: "expired", unitsDiscarded: N }`

#### Scenario: API records realized loss for multi-unit expired write-off

- **GIVEN** `N` matching expired inventory rows share the selected product, location, expiry, and status criteria
- **WHEN** an expired write-off is submitted with `unitsDiscarded` equal to `N`
- **THEN** exactly `N` matching inventory rows are processed
- **AND** exactly one `expired_item_transactions` row is recorded with `units_discarded = N`
- **AND** `financial_loss = costPrice * N`
- **AND** expired-loss reports return `{ lossesBySKU, lossesByStoreArea }`

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

### Requirement: Workers role-aware authorization

The Cloudflare Workers API SHALL enforce the same canonical organization role permissions as the
backend Express API. Workers SHALL extract the role from the verified JWT payload, normalize
legacy Clerk role strings via the shared `normalizeRole` helper, and enforce role-based
authorization on organization, membership, and upload endpoints. Upload initiation and processing
SHALL be limited to `admin` (and `manager` if enabled); `team_member` SHALL receive HTTP 403.
Authorization denials SHALL return generic 403 Forbidden without role details.

#### Scenario: Workers rejects team_member upload

- **GIVEN** an authenticated Workers request from a `team_member` user
- **WHEN** the user calls `POST /api/upload/initiate` or another upload mutation path
- **THEN** the Worker returns HTTP 403 before processing the upload

#### Scenario: Workers allows admin upload

- **GIVEN** an authenticated Workers request from an `admin` user
- **WHEN** the user calls `POST /api/upload/initiate`
- **THEN** the Worker proceeds to the upload initiation handler

#### Scenario: Workers normalizes Clerk role strings

- **GIVEN** a Workers JWT payload containing a legacy Clerk role string
- **WHEN** the role authorization middleware processes the request
- **THEN** the role is normalized to a canonical value before comparison
- **AND** a `Manager` legacy value is treated as `manager`

#### Scenario: Workers GET passthrough for read-only endpoints

- **GIVEN** an authenticated Workers request from any role
- **WHEN** the user calls a GET endpoint that is not role-gated
- **THEN** the request proceeds without role authorization blocking

