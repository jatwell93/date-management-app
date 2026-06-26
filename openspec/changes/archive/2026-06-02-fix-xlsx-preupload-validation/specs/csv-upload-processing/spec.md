## MODIFIED Requirements

### Requirement: CSV validation before processing
The system SHALL validate supported upload file structure and content before beginning processing.

#### Scenario: Pre-upload validation
- **WHEN** client initiates CSV, XLS, or XLSX upload
- **THEN** system SHALL validate file type is one of the supported upload formats
- **AND** system SHALL reject files >10MB
- **AND** system SHALL return validation errors before upload begins

#### Scenario: Product catalog Excel header validation
- **WHEN** client selects an XLS or XLSX product catalog file with accepted product headers
- **THEN** pre-upload column validation SHALL read the first worksheet headers
- **AND** accepted alternative headers such as `Item Code`, `Item Description`, `Cost Ex`, and `Barcode` SHALL satisfy the required product catalog columns
