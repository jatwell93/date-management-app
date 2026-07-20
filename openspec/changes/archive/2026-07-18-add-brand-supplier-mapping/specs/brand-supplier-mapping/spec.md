## ADDED Requirements

### Requirement: A curated master catalogue maps products to brand and supplier

The system SHALL maintain a provider-curated master catalogue, keyed by barcode, that records each
product's description, per-wholesaler SKUs (API, Sigma, CH2), brand, manufacturer, category, and
reference prices. The catalogue SHALL be global read-only reference data that tenants read but never
write. When a store's product import is enriched, the system SHALL match uploaded items by barcode
first and fall back to matching the uploaded SKU against any wholesaler SKU. A matched item SHALL be
tagged with the catalogue's brand and a suggested supplier; an unmatched item SHALL surface in a
"needs brand" state.

#### Scenario: A barcode match tags brand and suggested supplier

- **GIVEN** a master catalogue entry for barcode 9321299800449 with brand "The Cancer Council"
- **WHEN** an uploaded product with that barcode is enriched
- **THEN** the product is linked to a brand named "The Cancer Council"
- **AND** the brand carries the catalogue's manufacturer as an advisory supplier suggestion

#### Scenario: A missing catalogue barcode match falls back to a wholesaler SKU

- **GIVEN** an uploaded product whose barcode has no master-catalogue match but whose API SKU matches a catalogue entry's API SKU
- **WHEN** the product is enriched
- **THEN** the product is matched to that catalogue entry via the wholesaler SKU

#### Scenario: An unmatched item lands in needs-brand

- **GIVEN** an uploaded product whose barcode and SKU match no catalogue entry
- **WHEN** the product is enriched
- **THEN** the product appears in the "needs brand" state with no brand assigned

### Requirement: Brands are first-class and mediate the product-to-supplier link

The system SHALL model brands as org-scoped records, each with a name, an optional confirmed supplier,
a separate advisory suggested supplier name, a source marker distinguishing catalogue-derived,
user-added, and user-confirmed brands, and an advisory manufacturer name. Catalogue enrichment SHALL
NOT create or assign a tenant Supplier. Each product MAY reference one brand. The system SHALL resolve a product's supplier
as the product's own supplier override when present, otherwise the product's brand's supplier,
otherwise none. Brands SHALL be org-scoped with the organization derived from the authenticated
context and never from a client-supplied identifier.

Catalogue review SHALL use setup states distinct from claimability: `NEEDS_BRAND`,
`PENDING_CONFIRMATION`, and `CONFIRMED`. Invalid review states SHALL be rejected rather than silently
treated as another filter. `CLAIMABLE` and `NO_POLICY` remain claimable-pool states determined by the
resolved supplier's policy.

#### Scenario: A brand resolves supplier for all its products

- **GIVEN** a brand "Blackmores" linked to a supplier, and 100 products linked to that brand
- **WHEN** any of those products' supplier is resolved
- **THEN** it resolves to the brand's supplier without per-product assignment

#### Scenario: A product override wins over the brand default

- **GIVEN** a product with its own supplier override and a brand linked to a different supplier
- **WHEN** the product's supplier is resolved
- **THEN** it resolves to the product's own override, not the brand's supplier

#### Scenario: A product with no brand and no override needs a brand

- **GIVEN** a product with no brand and no supplier override
- **WHEN** its supplier is resolved
- **THEN** the result is none and the product surfaces in the "needs brand" state

### Requirement: Inferred links are suggestions the user confirms, never assertions

The system SHALL treat a catalogue-derived supplier as a suggestion pending user confirmation, marked
by the brand's source. An expired item whose supplier is resolved but not yet confirmed SHALL surface
as "pending confirmation" in the claimable pool — visible and actionable, not blocked. Confirming a
brand's supplier SHALL mark the brand confirmed.

#### Scenario: A suggested supplier is pending until confirmed

- **GIVEN** a brand auto-created from the catalogue with a suggested supplier
- **WHEN** an item of that brand expires and enters the claimable pool
- **THEN** it appears as "pending confirmation" rather than as a ready-to-claim item
- **AND** it is not blocked from being acted on

#### Scenario: Confirming a brand marks it confirmed

- **GIVEN** a brand whose source is catalogue-derived
- **WHEN** a user confirms its supplier
- **THEN** the brand's source becomes confirmed

### Requirement: A supplier policy is entered once and applied to all its brands' items

The system SHALL let a user enter a supplier's credit policy a single time and SHALL apply it to every
product resolving to that supplier across all of the supplier's brands, without per-product entry. The
policy prompt SHALL be deferrable: completing the initial catalogue upload SHALL NOT require entering
any policy, and the prompt SHALL surface the first time an item resolving to that supplier expires.

#### Scenario: One policy entry covers every brand of a supplier

- **GIVEN** a supplier owning brands "Blackmores" and "BioCeuticals"
- **WHEN** a user enters that supplier's policy once
- **THEN** items of both brands resolve to that policy without further entry

#### Scenario: Onboarding completes without any policy entry

- **GIVEN** a new user who has just uploaded and matched their catalogue
- **WHEN** they finish onboarding
- **THEN** setup completes with no supplier policy entered
- **AND** a supplier's policy prompt appears only when one of its items first expires

### Requirement: Users add missing brands and corrections, captured for central review

The system SHALL let a user add a brand the catalogue missed and override a suggested supplier, and
SHALL record each such action as an org-scoped correction event capturing the barcode where known,
the entered brand, the chosen supplier, and the correction kind. The correction SHALL apply
immediately within the submitting organization and SHALL be queued as pending for central review. In
this version, accepting a correction centrally SHALL NOT automatically mutate any other organization's
data.

#### Scenario: Adding a missing brand applies locally and is queued

- **GIVEN** a product in the "needs brand" state
- **WHEN** a user adds a brand for it and picks a supplier
- **THEN** the product resolves to that supplier within the user's organization
- **AND** a pending correction event of kind "brand added" is recorded for central review

#### Scenario: Overriding a suggested supplier is recorded

- **GIVEN** an item whose catalogue-suggested supplier the user disagrees with
- **WHEN** the user selects a different supplier
- **THEN** the override applies within the user's organization
- **AND** a pending correction event of kind "supplier override" is recorded

#### Scenario: Central acceptance does not touch other organizations

- **GIVEN** a pending correction submitted by one organization
- **WHEN** it is accepted in central review
- **THEN** its status becomes accepted
- **AND** no other organization's brands or products are changed automatically

### Requirement: Every expired item runs a visible two-outcome disposition

The system SHALL present every expired write-off through to a closed disposition offering two
outcomes: beginning a credit claim when the resolved supplier is claimable, or confirming disposal
when it is not. A "no policy" or dispose flag SHALL auto-flag the dispose outcome but SHALL still
require explicit user confirmation, and SHALL never prevent a user from beginning a claim.
Confirmed disposal SHALL be persisted on the expired transaction and SHALL idempotently exclude that
transaction from the claimable pool. A transaction that has entered a claim SHALL NOT be disposable.

#### Scenario: A no-policy item is auto-flagged dispose but requires confirmation

- **GIVEN** an expired item whose resolved supplier has no credit policy
- **WHEN** it is viewed in the triage board
- **THEN** it is auto-flagged for disposal with a confirm action
- **AND** it is not disposed until the user confirms

#### Scenario: Confirmed disposal persists and leaves the pool

- **GIVEN** an unclaimed expired transaction in the no-policy state
- **WHEN** the user confirms disposal twice
- **THEN** the transaction is stored as disposed without duplicate side effects
- **AND** it no longer appears in the claimable pool

#### Scenario: A claimed transaction cannot be disposed

- **GIVEN** an expired transaction already linked to a claim line
- **WHEN** a user attempts to dispose it
- **THEN** the request is rejected as a conflict

#### Scenario: A user may still claim a no-policy brand

- **GIVEN** an expired item whose resolved supplier has no credit policy
- **WHEN** a rep offers to help and the user begins a claim anyway
- **THEN** the system allows the claim to be built and does not block it

### Requirement: Central correction review fails closed to a platform allowlist

The system SHALL require normal authentication and SHALL authorize central catalogue-correction
review only when the authenticated numeric local user ID is present in comma-separated
`PLATFORM_ADMIN_USER_IDS`. Missing or malformed configuration SHALL deny access. Accepting or
rejecting a pending correction SHALL only change that correction's status. Accepted and rejected
corrections SHALL be terminal; a later attempt to change their decision SHALL be rejected as a
conflict. Both backend implementations SHALL return the same correction representation, including
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

### Requirement: Master catalogue seeding is explicit and idempotent

The system SHALL seed the master catalogue from an explicitly supplied workbook path, normalize the
supported catalogue fields, upsert by barcode, preserve unavailable CH2 values as null, and report
inserted, updated, skipped, and error counts. Development and automated tests MAY use the checked-in
100-row sample; production SHALL require an explicitly supplied full curated workbook.

#### Scenario: Re-running the same workbook is idempotent

- **GIVEN** a valid catalogue workbook has already been seeded
- **WHEN** the same workbook is seeded again
- **THEN** no duplicate barcode row is created
- **AND** the result reports the rows as updates or unchanged skips
