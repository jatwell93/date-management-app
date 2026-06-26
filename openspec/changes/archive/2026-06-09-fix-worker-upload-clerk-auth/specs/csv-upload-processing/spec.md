## MODIFIED Requirements

### Requirement: CSV upload API authentication
The system SHALL authenticate Worker upload API requests with the current frontend auth provider before accepting upload workflow actions.

#### Scenario: Clerk-authenticated upload initiation
- **WHEN** a signed-in user initiates a CSV, XLS, or XLSX upload through `/api/upload/initiate`
- **THEN** the Worker SHALL verify the Clerk bearer token
- **AND** resolve the internal user from `users.clerk_user_id`
- **AND** return an upload strategy for files that pass upload validation

#### Scenario: Upload workflow ownership
- **WHEN** a signed-in user performs direct upload, complete, or status API requests
- **THEN** the Worker SHALL verify the Clerk bearer token
- **AND** SHALL allow access only to upload keys owned by the resolved internal user id

#### Scenario: Presigned upload transfer token
- **WHEN** the client uploads bytes to a presigned upload URL
- **THEN** the Worker SHALL continue to verify the upload transfer token
- **AND** SHALL not require Clerk authentication for that presigned byte-transfer request
