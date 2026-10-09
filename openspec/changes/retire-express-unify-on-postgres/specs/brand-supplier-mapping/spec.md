## MODIFIED Requirements

### Requirement: A curated master catalogue maps products to brand and supplier

The system SHALL maintain a provider-curated master catalogue, keyed by barcode, that records each
product's description, per-wholesaler SKUs (API, Sigma, CH2), brand, manufacturer, category, and
reference prices. The catalogue SHALL be global read-only reference data that tenants read but never
write. When a store's product import is enriched, the system SHALL match uploaded items by barcode
first and fall back to matching the uploaded SKU against any wholesaler SKU. Retired catalogue
entries SHALL be excluded from all import matching — neither their barcode nor their wholesaler SKUs
SHALL match an uploaded item — while remaining preserved for audit. A matched item SHALL be tagged
with the catalogue's brand and a suggested supplier; an unmatched item SHALL surface in a
"needs brand" state.

#### Scenario: A barcode match tags brand and suggested supplier

- **GIVEN** a master catalogue entry for barcode 9321299800449 with brand "The Cancer Council"
- **WHEN** an uploaded product with that barcode is enriched
- **THEN** the product is linked to a brand named "The Cancer Council"
- **AND** the brand carries the catalogue's manufacturer as an advisory supplier suggestion

#### Scenario: A missing catalogue barcode match falls back to a wholesaler SKU

- **GIVEN** an uploaded product whose barcode has no master-catalogue match but whose API SKU matches an active catalogue entry's API SKU
- **WHEN** the product is enriched
- **THEN** the product is matched to that catalogue entry via the wholesaler SKU

#### Scenario: A retired entry does not match

- **GIVEN** a retired catalogue entry for barcode 9300000000001 whose API SKU is "API-123"
- **WHEN** an uploaded product with that barcode or that API SKU is enriched
- **THEN** the product does not match the retired entry
- **AND** it surfaces in the "needs brand" state unless another active entry matches

#### Scenario: An active shared-SKU entry wins independently of row order

- **GIVEN** active and retired catalogue entries share the same wholesaler SKU
- **WHEN** an uploaded product is enriched by the Worker
- **THEN** the active catalogue entry matches regardless of database row order

#### Scenario: An unmatched item lands in needs-brand

- **GIVEN** an uploaded product whose barcode and SKU match no active catalogue entry
- **WHEN** the product is enriched
- **THEN** the product appears in the "needs brand" state with no brand assigned

### Requirement: Central correction review fails closed to a platform allowlist

The system SHALL require normal authentication and SHALL authorize central catalogue-correction
review only when the authenticated numeric local user ID is present in comma-separated
`PLATFORM_ADMIN_USER_IDS`. Missing or malformed configuration SHALL deny access. Accepting or
rejecting a pending correction SHALL only change that correction's status. Accepted and rejected
corrections SHALL be terminal; a later attempt to change their decision SHALL be rejected as a
conflict. The Worker SHALL return the correction representation, including
the submitting organization's ID and display name.

#### Scenario: Missing platform allowlist denies central review

- **GIVEN** an authenticated user and no valid `PLATFORM_ADMIN_USER_IDS` configuration
- **WHEN** the user requests central correction review
- **THEN** access is denied

#### Scenario: Accepted correction changes status only

- **GIVEN** an allowlisted platform administrator and a pending correction
- **WHEN** the administrator accepts the correction
- **THEN** only the correction status becomes accepted
- **AND** no catalogue, brand, product, supplier, or other organization record is modified

### Requirement: A platform administrator can review catalogue seed provenance

The system SHALL expose the master-catalogue seed provenance to platform administrators only,
returning the latest seed run and at most 20 newest-first prior runs, each with its
version, time seeded, source workbook file name, and diff counts (inserted, updated, unchanged,
retired, reinstated, errors). Authorization SHALL reuse the numeric `PLATFORM_ADMIN_USER_IDS`
allowlist that gates central correction review; missing, blank, non-numeric, or otherwise malformed
configuration SHALL deny access. The read SHALL be global and SHALL NOT be org-scoped, and the
Worker SHALL return a representation with ISO date strings and numeric
counts. Both organization-bootstrap responses SHALL expose `isPlatformAdmin`, derived from the
bootstrapped numeric database user ID through the same fail-closed allowlist logic. This capability
is for navigation and route presentation only; each platform endpoint SHALL authorize independently.

#### Scenario: Missing platform allowlist denies provenance access

- **GIVEN** an authenticated user and no valid `PLATFORM_ADMIN_USER_IDS` configuration
- **WHEN** the user requests catalogue seed provenance
- **THEN** access is denied

#### Scenario: An allowlisted admin reads the latest run and history

- **GIVEN** an allowlisted platform administrator and two recorded seed runs
- **WHEN** the administrator requests catalogue seed provenance
- **THEN** the latest run and a newest-first history are returned
- **AND** each run includes its version, time seeded, source file name, and diff counts

#### Scenario: Bootstrap capability fails closed

- **GIVEN** a missing, blank, zero, negative, mixed-validity, or non-numeric platform allowlist
- **WHEN** an authenticated user bootstraps an organization
- **THEN** `isPlatformAdmin` is false
