## 1. Import Mode and Contract Setup

- [x] 1.1 Add an explicit expiry-import mode/type to the shared upload lifecycle contract.
- [x] 1.2 Wire upload routing so expiry-import requests follow dedicated expiry validation/processing paths.
- [x] 1.3 Ensure existing product upload mode behavior remains unchanged.
- [x] 1.4 Add validation for required expiry import columns and optional fields according to current specs.

## 2. Date Parsing and Normalization Rules

- [x] 2.1 Implement deterministic used-by parser for dd/mm/yy and dd/mm/yyyy.
- [x] 2.2 Implement two-digit year mapping rule yy -> 20yy.
- [x] 2.3 Implement shorthand month-year parsing for mm/yy, mm/yyyy, mm-yy, and mm-yyyy with end-of-month normalization.
- [x] 2.4 Reject ambiguous/ineligible formats (for example 12/12, month names) with structured rejection reasons.

## 3. Expiry Import Persistence and Deduplication

- [x] 3.1 Implement tenant-scoped dedupe identity using organization, SKU, and normalized used-by date.
- [x] 3.2 Merge exact duplicates into a single logical record for both existing-data and in-file duplicates.
- [x] 3.3 Apply first-wins description conflict handling to preserve existing/master values.
- [x] 3.4 Apply Unallocated department fallback when department is missing from import inputs.

## 4. Partial Acceptance and API Rejection Reporting

- [x] 4.1 Implement partial acceptance pipeline that imports valid rows while skipping invalid rows.
- [x] 4.2 Return rejected-row details in API payload with row number, raw values, and reason.
- [x] 4.3 Include imported, merged, and rejected counts in completion/status responses.
- [x] 4.4 Ensure payload behavior is correct when rejected-row list is empty.

## 5. Template Download Capability

- [x] 5.1 Add downloadable expiry template generation/delivery for CSV format.
- [x] 5.2 Add downloadable expiry template generation/delivery for XLSX format.
- [x] 5.3 Add downloadable expiry template generation/delivery for XLS format.
- [x] 5.4 Ensure template columns and guidance match spec requirements, including accepted and rejected date examples.

## 6. Frontend Integration

- [x] 6.1 Add or update permanent UI entry point for expiry-list import (not onboarding-gated).
- [x] 6.2 Connect expiry import flow to the shared upload lifecycle using expiry import mode.
- [x] 6.3 Display API rejection payload in a clear user-facing format to support correction and re-upload.
- [x] 6.4 Expose template download actions in the expiry import UI.

## 7. Security and Tenant Isolation Verification

- [x] 7.1 Enforce tenant ownership checks for upload initiation, completion, and status reads in expiry-import mode.
- [x] 7.2 Verify cross-tenant lookup, merge, and update operations are blocked for expiry imports.
- [x] 7.3 Add regression checks to confirm existing product upload security behavior remains intact.

## 8. Test Coverage and Validation

- [x] 8.1 Add backend unit tests for date parser acceptance, normalization, and rejection cases.
- [x] 8.2 Add backend integration tests for dedupe behavior, first-wins logic, partial acceptance, and tenant isolation.
- [x] 8.3 Add frontend tests for expiry import UX, rejected-row display, and template download actions.
- [x] 8.4 Add regression tests that prove product upload workflows still pass unchanged.
- [x] 8.5 Run openspec strict validation and required test/lint/type-check gates before implementation approval.
