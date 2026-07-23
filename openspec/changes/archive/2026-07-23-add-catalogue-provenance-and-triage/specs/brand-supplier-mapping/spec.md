## MODIFIED Requirements

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

## ADDED Requirements

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
