# Delta for Reporting UI

## ADDED Requirements

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