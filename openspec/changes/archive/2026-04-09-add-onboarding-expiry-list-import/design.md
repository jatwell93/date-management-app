## Context

The application currently supports product master upload through a shared upload lifecycle (`/api/upload`) with progress tracking, validation, and asynchronous processing. The frontend upload UI already accepts CSV/XLS/XLSX and normalizes spreadsheets for upload, while backend validation and downstream processing are currently oriented around product-list ingestion.

This change adds a second import flow for expiry records so users can bring existing used-by data into the same reporting surfaces as scanner-created records. The flow must stay permanently available (not onboarding-only) and must preserve strict tenant isolation throughout parse, match, dedupe, and persistence stages.

Stakeholders:
- Pharmacy end users who need faster initial data adoption
- Operations/support teams handling import errors and recovery
- Engineering teams maintaining the existing upload pipeline

Constraints:
- Reuse existing upload architecture where practical
- Support CSV, XLS, XLSX from day one
- Avoid introducing behavior that changes current product upload semantics
- No source-tagging requirement in v1 (imported rows become normal records)

## Goals / Non-Goals

**Goals:**
- Provide a permanent expiry-list import path using CSV/XLS/XLSX files.
- Accept template columns: SKU (required), Item Description (optional), Used-By Date (required).
- Parse date formats `dd/mm/yy` and `dd/mm/yyyy`, with `yy` mapped to `20yy`.
- Accept month/year shorthand (`mm/yy`, `mm/yyyy`, `mm-yy`, `mm-yyyy`) and normalize to end-of-month.
- Reject ambiguous date forms (for example, `12/12` with no year) and invalid dates while still importing valid rows.
- Merge exact duplicates per tenant using `(organizationId, sku, usedByDate)` as the identity key.
- Apply first-wins conflict behavior for description conflicts (preserve original/master value; do not overwrite with import value).
- Default imported department to `Unallocated`.
- Return user-facing rejected-row feedback for correction and re-upload.

**Non-Goals:**
- Building an onboarding wizard or onboarding-triggered flow in this change.
- Alias/barcode-based matching in import identity.
- Adding source tagging or provenance filters in reports for v1.
- Reworking existing product-upload business rules beyond shared upload plumbing.
- Automatic department inference from uploaded content.

## Decisions

### 1) Reuse the existing upload pipeline with an explicit import mode
- Decision: Add an import mode/type for expiry-list processing inside the existing upload lifecycle rather than introducing a parallel upload subsystem.
- Rationale: Reuses proven progress, status, and storage flow while minimizing architectural drift.
- Alternatives considered:
  - Separate dedicated expiry import endpoints and job queue: cleaner separation but duplicates upload lifecycle logic.
  - Implicit inference by column shape only: brittle and increases accidental misrouting risk.

### 2) Canonical processing format remains CSV
- Decision: Support CSV/XLS/XLSX at user boundary, then normalize to canonical CSV before backend row ingestion.
- Rationale: Existing upload stack and validators are already CSV-centric, reducing backend parser complexity.
- Alternatives considered:
  - Native XLS/XLSX parsing server-side: stronger backend autonomy but adds dependency/security/performance surface area.
  - CSV-only acceptance: simpler, but violates agreed product requirement for upfront XLS/XLSX support.

### 3) Date parsing and normalization policy
- Decision:
  - Accept `dd/mm/yy`, `dd/mm/yyyy`, with `yy -> 20yy`.
  - Accept month/year shorthand (`12/26`, `12-2026`) and normalize to month-end day.
  - Reject ambiguous or non-inferable values (for example `12/12`) and all invalid calendar dates.
- Rationale: Balances user convenience with deterministic import behavior.
- Alternatives considered:
  - Strict format-only parsing (`dd/mm/yy` only): lower ambiguity but higher rejection rate and poor onboarding UX.
  - Locale-flex parsing: higher acceptance but unacceptable ambiguity in production data.

### 4) Deduplication and conflict strategy
- Decision:
  - Use `(organizationId, sku, usedByDate)` as dedupe identity.
  - Treat exact duplicates as one logical record.
  - Apply first-wins description behavior (preserve original product/master description where conflict exists).
- Rationale: Aligns with user expectation to avoid duplicate operational records and avoid accidental metadata overwrite.
- Alternatives considered:
  - Latest-wins overwrite: risks silently replacing trusted master data.
  - Include description in identity key: allows duplicate expiry records for same SKU/date when description text differs.

### 5) Partial-acceptance import with rejected-row reporting
- Decision: Import all valid rows and emit a rejected-row list containing row number, input value(s), and rejection reason.
- Rationale: Users can realize immediate value and correct only failed rows.
- Alternatives considered:
  - All-or-nothing transaction: simpler consistency model, but poor UX for large files with minor errors.

### 6) Department fallback policy
- Decision: Imported rows are assigned to `Unallocated` by default for each tenant.
- Rationale: Keeps import template minimal while preserving in-app organization workflows.
- Alternatives considered:
  - Require department column: increases friction during onboarding/migration.

### 7) No source tagging in v1
- Decision: Persist imported data as normal records with no visible source distinction.
- Rationale: Matches agreed product behavior and avoids scope expansion into reporting dimensions.
- Alternatives considered:
  - Add source metadata now: improves future analytics but adds schema/reporting complexity not required for v1.

### 8) Tenant isolation as a hard invariant
- Decision: Scope upload ownership checks, row matching, dedupe, and writes by tenant context on every operation.
- Rationale: Prevents cross-tenant leakage and preserves multi-tenant guarantees.
- Alternatives considered:
  - Rely on higher-layer guards only: insufficient defense-in-depth for import pipelines.

## Risks / Trade-offs

- [Risk] Date interpretation disputes for shorthand values. -> Mitigation: strict documented parsing table, template examples, and explicit rejected-row reasons.
- [Risk] Spreadsheet conversion differences between tools/locales. -> Mitigation: normalize to canonical CSV and validate headers/date cells post-conversion.
- [Risk] Hidden duplicate behavior surprises users. -> Mitigation: include duplicate merge counts and reason categories in import summary.
- [Risk] Existing upload flow regressions. -> Mitigation: isolate import mode paths, preserve current product import contracts, and add targeted regression tests.
- [Risk] Missing `Unallocated` department record in some tenants. -> Mitigation: ensure idempotent resolution/creation at import start.

## Migration Plan

1. Add/extend import contract definitions for expiry-list mode and template metadata.
2. Implement parser/normalizer rules for agreed date formats and shorthand month/year handling.
3. Implement dedupe + first-wins conflict behavior under tenant-scoped matching.
4. Implement rejected-row collection/reporting and surface summary counts in status/result payloads.
5. Add template download assets/endpoints for CSV/XLS/XLSX with required/optional field hints.
6. Run integration tests for tenant isolation, date normalization, partial acceptance, and regression coverage for current product upload flow.

Rollback strategy:
- Disable expiry-list mode through route/feature flag configuration while leaving existing product upload path intact.
- Revert import-mode specific parser and match logic without touching base upload lifecycle.
- Preserve imported records already created unless a separate data rollback is explicitly approved.

## Open Questions

- Confirm canonical storage semantics for used-by dates: date-only field (recommended) vs timestamp normalization strategy.
- Confirm delivery mechanism for rejected-row report in v1: inline JSON payload only, downloadable CSV, or both.
- Confirm whether month names (for example `Dec/2026`) should be explicitly rejected in v1 for predictability.
