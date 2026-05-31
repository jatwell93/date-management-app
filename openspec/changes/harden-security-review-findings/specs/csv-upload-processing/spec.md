## MODIFIED Requirements

### Requirement: CSV validation before processing
The system SHALL validate CSV structure, type, and configured file-size limits before beginning processing.

#### Scenario: Pre-upload validation
- **WHEN** client initiates CSV upload
- **THEN** system SHALL validate file type is text/csv or a supported spreadsheet MIME type
- **AND** system SHALL reject files larger than the configured upload limit
- **AND** system SHALL return validation errors before upload processing begins.

#### Scenario: Legacy product upload size rejection
- **WHEN** a file larger than the configured upload limit is submitted to the legacy product upload route
- **THEN** the route SHALL reject the request with `400 Bad Request`
- **AND** product CSV/XLSX parsing SHALL NOT begin.
