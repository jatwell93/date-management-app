# reporting-ui Specification

## Purpose
TBD - created by archiving change fix-expiry-summary-counts. Update Purpose after archive.
## Requirements
### Requirement: Expiry Summary Counts Display
The system SHALL display accurate expiry summary counts in the reporting UI.

#### Scenario: View expiry summary counts
- GIVEN a user is viewing the reports page
- WHEN the page loads
- THEN the system displays the correct expiry risk count
- AND the system displays the correct next month markdown count
- AND the system displays the correct active future stock count

### Requirement: Stale Payload Handling
The system SHALL handle stale payloads gracefully in the reporting UI.

#### Scenario: Handle stale overall payloads
- GIVEN the system detects a stale payload
- WHEN the user attempts to view reports
- THEN the system fetches fresh data
- AND displays the updated information

### Requirement: Total Markdown Removal
The system SHALL remove the monthly Total Markdown display from the reporting UI.

#### Scenario: Total Markdown not displayed
- GIVEN a user is viewing the reports page
- WHEN the page loads
- THEN the system does not display the Total Markdown section

### Requirement: Expired Items Report UI Improvements
The system SHALL provide a user interface for viewing and managing expired items reports.

#### Scenario: View expired items report
- GIVEN a user is authenticated and authorized
- WHEN the user navigates to the expired items report page
- THEN the system displays a list of expired items with their details
- AND the user can filter and sort the items

### Requirement: Multi-unit write-off submission
The system SHALL allow users to submit write-offs for multiple units of expired items.

#### Scenario: Submit multi-unit write-off
- GIVEN a user is viewing an expired item
- WHEN the user enters a quantity greater than 1 for write-off
- THEN the system processes the write-off for the specified quantity
- AND updates the inventory accordingly

### Requirement: Invalid quantity rejection
The system SHALL reject write-off submissions with invalid quantities.

#### Scenario: Reject invalid quantity
- GIVEN a user is attempting to submit a write-off
- WHEN the user enters an invalid quantity (negative, zero, or non-numeric)
- THEN the system displays an error message
- AND does not process the write-off

### Requirement: Expired loss report route regression fix
The system SHALL ensure the expired loss report route is properly registered and accessible in the Workers deployment.

#### Scenario: Expired loss report route is accessible
- GIVEN a deployed Workers instance
- WHEN a request is made to `GET /api/expired-items/reports/expired-losses`
- THEN the route is found and handled
- AND the response is not HTTP 404
- AND authenticated requests receive the expected report data

#### Scenario: Expired loss report route is not route-not-found

- **WHEN** a request is made to `GET /api/expired-items/reports/expired-losses`
- **THEN** the Worker route dispatcher matches the expired-loss report handler
- **AND** the response is not HTTP 404 route-not-found
- **AND** authenticated requests return a body containing `lossesBySKU` and `lossesByStoreArea`

#### Scenario: Live smoke probe detects stale deployment

- **WHEN** the deployment smoke check probes `https://api.expirymate.com.au/api/expired-items/reports/expired-losses`
- **THEN** a route-not-found HTTP 404 response fails the smoke check
- **AND** authentication-related responses are allowed for unauthenticated probes

### Requirement: Print Target Classes
The system SHALL provide reusable print target classes for report pages.

#### Scenario: Apply print target classes
- GIVEN a user is viewing a report page
- WHEN the page loads
- THEN the system applies the appropriate print target classes
- AND the print layout is optimized for printing

### Requirement: Detailed Expiry Report Printing
The system SHALL allow printing of the full expiry table from the Detailed Expiry Report page.

#### Scenario: Print detailed expiry report
- GIVEN a user is viewing the Detailed Expiry Report page
- WHEN the user clicks the print button
- THEN the system prints all loaded rows from the report data
- AND not just the paginated DataTable view

### Requirement: Expired Items Report Printing
The system SHALL allow printing of the desktop table from the Expired Items page.

#### Scenario: Print expired items report
- GIVEN a user is viewing the Expired Items page
- WHEN the user clicks the print button
- THEN the system prints the desktop table surface
- AND the printed output omits the interactive Actions column/buttons

### Requirement: Reports Page Print Button Removal
The system SHALL remove the header print button from the Reports page.

#### Scenario: No print button on reports page
- GIVEN a user is viewing the Reports page
- WHEN the page loads
- THEN the system does not display a header print button

### Requirement: Usage Report Page Print Button Removal
The system SHALL remove the header print button from the Usage Report page.

#### Scenario: No print button on usage report page
- GIVEN a user is viewing the Usage Report page
- WHEN the page loads
- THEN the system does not display a header print button

