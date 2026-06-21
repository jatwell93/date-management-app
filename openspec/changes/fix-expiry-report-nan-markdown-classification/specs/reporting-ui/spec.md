## MODIFIED Requirements

### Requirement: Expiry reports render frontend-safe numeric values

The expiry reporting page SHALL render numeric report fields from `/reports/expiry` and `/reports/expiry-overall` without displaying `NaN`, including when the API returns numeric strings, `null`, or omitted optional summary fields.

#### Scenario: Production-shaped report payload

- **GIVEN** the report API returns numeric fields as strings, nulls, or missing values
- **WHEN** a user opens the expiry reporting page
- **THEN** all expiry summary and markdown bucket counts render as finite numbers
- **AND** no visible report count displays `NaN`

#### Scenario: Expiry markdown bucket windows

- **GIVEN** stock has expiry dates in 0-30, 31-60, 61-90, and 91-120 day windows
- **WHEN** the report APIs calculate expiry summaries
- **THEN** the buckets map to Markdown 3, Markdown 2, Markdown 1, and next-month markdown review respectively
