## Why

New users often already maintain expiry-date records outside the app, but current uploads only cover product master data. This onboarding gap slows adoption and prevents immediate reporting value, so we need a direct import path that converts existing expiry lists into normal in-app records.

## What Changes

- Add a permanent import workflow for expiry records that accepts CSV, XLS, and XLSX files.
- Provide downloadable templates for CSV/XLS/XLSX with columns: SKU, Item Description (optional), and Used-By Date.
- Parse Used-By Date from dd/mm/yy and dd/mm/yyyy.
- Support inferred month/year input for Used-By Date (for example, 12/26) by normalizing to the end of that month.
- Reject ambiguous or invalid date rows (for example, 12/12 without a year), continue processing valid rows, and return a rejected-row report for correction/re-upload.
- Merge exact duplicate records within the same tenant (same SKU and same used-by date) into a single record.
- Persist imported rows as normal recorded items so they appear in reporting flows the same way as scanner-created records.
- Default imported department assignment to Unallocated so users can adjust in-app.
- Exclude alias/barcode matching from this version.
- Enforce strict tenant isolation for all parsing, matching, merge, and write operations.

## Capabilities

### New Capabilities

- `expiry-list-import`: Import existing expiry-date records from CSV/XLS/XLSX into normal app records with date normalization, partial acceptance, duplicate merge, and tenant-safe persistence.
- `expiry-import-template-download`: Provide user-facing CSV/XLS/XLSX templates that standardize import columns and date expectations.

### Modified Capabilities

- `csv-upload-processing`: Extend shared upload validation/reporting behavior to support this new import type while preserving current product-upload behavior.

## Impact

- Backend upload and ingestion flow for a new import type, including spreadsheet parsing and row-level validation outcomes.
- Existing item/record persistence and deduplication logic to support exact-match merges for imported expiry rows.
- Reporting inputs so imported rows are treated as first-class records without source tagging in this version.
- Frontend upload UX entry point (permanent, not onboarding-only in v1) and template download access.
- Template asset management for CSV/XLS/XLSX.
- Security and data isolation guarantees across all import lifecycle steps in multi-tenant execution.
