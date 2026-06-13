## MODIFIED Requirements

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
