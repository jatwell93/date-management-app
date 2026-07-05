## MODIFIED Requirements

### Requirement: Reporting pages print the intended data surface

The reporting UI SHALL print a page-specific data surface rather than the browser's default visible layout so that printed output contains the useful report tables and excludes interactive controls.

#### Scenario: All expiry entries prints the full loaded table
- **WHEN** a user opens `/expiry-entries` and triggers print
- **THEN** the printed surface SHALL target the full expiry table section
- **AND** SHALL include every row already loaded into the page
- **AND** SHALL not be limited to the current paginated DataTable page

Note: the full expiry table (and its print action) moved off `/detailed-expiry-report`
— now the focused 90-day markdown worklist — to the dedicated `/expiry-entries` page.

#### Scenario: Expired items print omits action controls
- **WHEN** a user opens `/expired-items` and triggers print
- **THEN** the printed surface SHALL target the desktop table view
- **AND** SHALL omit the Actions column and its buttons
- **AND** SHALL show operational item data only

#### Scenario: Summary report pages do not expose print buttons
- **WHEN** a user opens `/reports` or `/usage-report`
- **THEN** the header SHALL not show a Print Report button
