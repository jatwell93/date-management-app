## MODIFIED Requirements

### Requirement: Expiry report summary cards reflect the overall report contract

The `/reports` expiry action summary SHALL render `expiry_risk_count`, `next_month_markdown_count`, and `active_expiry_stock_count` from `/reports/expiry-overall` exactly as numeric API values after numeric-string coercion.

#### Scenario: Overall summary contains required count fields
- **WHEN** `/reports/expiry-overall` returns valid numeric values or numeric strings for the three required summary fields
- **THEN** the expiry action summary cards display those values
- **AND** no card substitutes `0` for a non-zero valid value

#### Scenario: Overall summary omits a required count field
- **WHEN** `/reports/expiry-overall` omits any required expiry summary count field
- **THEN** the page reports a contract error for the expiry action summary
- **AND** the page does not display a misleading zero-count summary

### Requirement: Monthly expiry table omits the aggregate markdown column

The `/reports` monthly expiry report SHALL omit the redundant `Total Markdown` aggregate from both mobile row summaries and the desktop table while keeping the backend response contract compatible.

#### Scenario: Monthly expiry data renders
- **WHEN** `/reports/expiry` returns monthly expiry rows
- **THEN** the mobile monthly row summary does not include `Total Markdown`
- **AND** the desktop monthly table does not include a `Total Markdown` header or cell
