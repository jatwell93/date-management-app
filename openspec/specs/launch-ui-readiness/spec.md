# launch-ui-readiness Specification

## Purpose
Ensure launch-critical UI flows, such as scan expiry pricing, stay accurate and recoverable for store staff.

## Requirements

### Requirement: Scan expiry pricing remains recoverable and accurate
The scan workflow SHALL consume the current product API contract and SHALL present expiry markdown pricing without crashing when product cost data is absent or invalid.

#### Scenario: Product lookup returns camelCase cost
- **WHEN** a signed-in user loads a product on `/scan` whose API response includes `costPrice`
- **THEN** the scan page SHALL display that cost price
- **AND** SHALL use it for expiry markdown calculations

#### Scenario: Default markdown schedule
- **WHEN** a product with a valid cost expires in 61 to 90 days
- **THEN** the scan page SHALL show a price discounted by 50 percent
- **WHEN** it expires in 31 to 60 days
- **THEN** the scan page SHALL show a price discounted by 60 percent
- **WHEN** it expires in 30 days or fewer
- **THEN** the scan page SHALL show a price discounted by 75 percent

#### Scenario: Missing cost does not crash the scan page
- **WHEN** a loaded product has no finite cost price
- **AND** the user selects any expiry date
- **THEN** the scan page SHALL remain usable without entering the error boundary
- **AND** SHALL not display a `NaN` markdown price

#### Scenario: Product outside markdown window
- **WHEN** a product expires more than 90 days from the current date
- **THEN** the scan page SHALL not display a markdown price

### Requirement: Every routed view passes a technical UI quality audit
Each routed frontend view and the app shell SHALL be audited with `/impeccable:audit` against the
design context in `.impeccable.md`, and all reported P0-P3 findings SHALL be fixed or recorded as
explicitly deferred with a reason in the view's pull request.

#### Scenario: A view audit finds an accessibility defect
- **WHEN** the audit of a view reports a WCAG AA failure such as an unlabeled input or low contrast
- **THEN** the view's pull request SHALL fix the defect
- **AND** SHALL add or adjust a test that covers the fixed behavior where it is testable in jsdom

#### Scenario: A view audit finds a defect in shared code
- **WHEN** a finding is located in shared code outside the view's own files
- **THEN** the view's pull request SHALL NOT change that shared code
- **AND** the finding SHALL be fixed in the shell pull request
