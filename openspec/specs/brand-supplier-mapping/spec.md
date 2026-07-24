# brand-supplier-mapping Specification

## Purpose
TBD - created by archiving change add-brand-supplier-mapping. Update Purpose after archive.
## Requirements
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
- **WHEN** an uploaded product is enriched in either backend
- **THEN** the active catalogue entry matches regardless of database row order

#### Scenario: An unmatched item lands in needs-brand

- **GIVEN** an uploaded product whose barcode and SKU match no active catalogue entry
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
inserted, updated, unchanged, retired, reinstated, skipped blank-row, and error counts. Blank rows
SHALL NOT be conflated with unchanged catalogue entries. Development and automated tests
MAY use the checked-in 100-row sample; production SHALL require an explicitly supplied full curated
workbook.

Each successful live seed run SHALL persist exactly one append-only provenance record capturing a monotonically
increasing version, the time seeded, the source workbook file name, and the full diff of the run.
The provenance record and the catalogue it describes are global reference data and SHALL NOT be
org-scoped. A seed run SHALL execute atomically: a mid-run failure SHALL leave neither a partial
catalogue mutation nor a recorded provenance row.

A barcode present in the catalogue but absent from the newly seeded workbook SHALL be soft-retired by
stamping a retirement time rather than deleted, and SHALL be counted as retired for that run. A
retired barcode that reappears in a later workbook SHALL be reinstated by clearing its retirement
time and refreshing its catalogue fields from that workbook, while preserving its existing row
identity and brand linkage, and SHALL be counted as reinstated. Version numbering SHALL begin at 1
and SHALL advance only on a committed run, so a run that fails and rolls back consumes no version and
records no provenance row. Re-seeding an identical workbook SHALL report every row as unchanged with
zero retired and zero reinstated, and SHALL still record a provenance row for the run.

Seeding SHALL support a dry-run mode that parses the workbook and returns the full diff — including
the set that would be retired — without mutating the catalogue, recording a provenance row, or
consuming a version. To guard against seeding a partial or wrong workbook, when a prior catalogue
exists and a live run's retirement set exceeds a configurable proportion of the active catalogue
(default 10%), the run SHALL abort without mutating the catalogue or recording a provenance row
unless retirement is explicitly confirmed. The first seed of an empty catalogue SHALL NOT be
blocked by this guard regardless of how many entries it inserts.

Malformed rows and duplicate normalized barcodes SHALL be validation errors. A dry-run SHALL report
them alongside the prospective diff without writes. A live seed with any validation error SHALL
throw a structured `CatalogueSeedValidationError` before opening a write transaction, and therefore
SHALL NOT mutate catalogue data or persist provenance. Under this v1 fail-closed policy, persisted
provenance `errorCount` SHALL be zero. `MASTER_CATALOGUE_RETIREMENT_THRESHOLD` SHALL default to
`0.10`; configured malformed, negative, or greater-than-1 values SHALL be rejected, and a retirement
ratio exactly equal to the threshold SHALL be allowed.

#### Scenario: Re-running the same workbook is idempotent

- **GIVEN** a valid catalogue workbook has already been seeded
- **WHEN** the same workbook is seeded again
- **THEN** no duplicate barcode row is created
- **AND** the result reports the rows as unchanged with zero retired and zero reinstated
- **AND** a new provenance record is written for the run

#### Scenario: A dropped barcode is retired, not orphaned

- **GIVEN** a catalogue containing an active entry for barcode 9300000000001
- **WHEN** a workbook that omits that barcode is seeded
- **THEN** the entry is soft-retired with a retirement time rather than deleted
- **AND** the run's provenance record counts it as retired

#### Scenario: A returning barcode is reinstated

- **GIVEN** a catalogue entry for barcode 9300000000001 that was previously retired
- **WHEN** a later workbook that includes that barcode is seeded
- **THEN** the entry's retirement time is cleared and its existing row and brand linkage are preserved
- **AND** the run's provenance record counts it as reinstated

#### Scenario: Seed provenance records the run

- **GIVEN** a valid catalogue workbook
- **WHEN** it is seeded
- **THEN** a provenance record is written with a version one greater than the previous run
- **AND** it records the time seeded, the source workbook file name, and the inserted, updated, unchanged, retired, reinstated, and error counts

#### Scenario: A dry-run reports the diff without mutating anything

- **GIVEN** a seeded catalogue and a workbook that would retire some entries
- **WHEN** the workbook is seeded in dry-run mode
- **THEN** the full diff, including the set that would be retired, is returned
- **AND** no catalogue entry is changed, no provenance record is written, and no version is consumed

#### Scenario: An over-threshold retirement aborts without confirmation

- **GIVEN** an active catalogue and a workbook whose omissions would retire more than the configured proportion of it
- **WHEN** the workbook is seeded without confirming retirement
- **THEN** the run aborts, reporting how many entries it would have retired
- **AND** no catalogue entry is changed and no provenance record is written

#### Scenario: A confirmed over-threshold retirement proceeds

- **GIVEN** the same over-threshold workbook
- **WHEN** it is seeded with retirement explicitly confirmed
- **THEN** the run proceeds, retiring the omitted entries and recording a provenance row

#### Scenario: An invalid live workbook aborts before writing

- **GIVEN** a workbook containing a malformed row or duplicate normalized barcode
- **WHEN** it is seeded live
- **THEN** `CatalogueSeedValidationError` reports the row and duplicate errors
- **AND** no catalogue entry or provenance row is written

#### Scenario: The operator previews or confirms a seed from npm

- **WHEN** the operator runs `npm run seed:master-catalogue -- <workbook-path> --dry-run`
- **THEN** the JSON dry-run result is printed without writes
- **AND WHEN** an intentional over-threshold live seed is rerun with `--confirm-retirements`
- **THEN** the confirmed seed is allowed to proceed

### Requirement: A platform administrator can review catalogue seed provenance

The system SHALL expose the master-catalogue seed provenance to platform administrators only,
returning the latest seed run and at most 20 newest-first prior runs, each with its
version, time seeded, source workbook file name, and diff counts (inserted, updated, unchanged,
retired, reinstated, errors). Authorization SHALL reuse the numeric `PLATFORM_ADMIN_USER_IDS`
allowlist that gates central correction review; missing, blank, non-numeric, or otherwise malformed
configuration SHALL deny access. The read SHALL be global and SHALL NOT be org-scoped, and both
backend implementations SHALL return the same representation with ISO date strings and numeric
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

### Requirement: A platform administrator triages catalogue corrections from a dedicated surface

The system SHALL provide a platform-administrator surface that lists pending catalogue corrections
and lets the administrator accept or reject them individually or in a batch, wrapping the existing
allowlist-gated correction-review endpoints without adding a new authorization primitive or mutating
another organization's data. Accepting or rejecting a correction SHALL only change that correction's
status, consistent with the central-review contract.

#### Scenario: Pending corrections are listed for triage

- **GIVEN** an allowlisted platform administrator and pending corrections from one or more organizations
- **WHEN** the administrator opens the triage surface
- **THEN** the pending corrections are listed with their kind, barcode where known, entered brand, chosen supplier, and submitting organization

#### Scenario: Batch accept changes only correction status

- **GIVEN** an allowlisted platform administrator and several pending corrections
- **WHEN** the administrator accepts them in a batch
- **THEN** each selected correction's status becomes accepted
- **AND** no catalogue, brand, product, supplier, or other organization record is modified

