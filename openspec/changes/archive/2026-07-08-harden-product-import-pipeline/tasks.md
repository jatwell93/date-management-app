## 1. Baseline and Tests

- [x] 1.1 RED: Add helper tests for product import row validation covering missing fields, invalid cost, length limits, and unexpected columns.
- [x] 1.2 RED: Add helper tests for resolving an import operation from SKU/barcode lookup maps, including conflicting identifiers.

## 2. Product Import Refactor

- [x] 2.1 GREEN: Extract shared product import row validation into `product-import.helpers.ts`.
- [x] 2.2 GREEN: Extract shared product import operation resolution into `product-import.helpers.ts`.
- [x] 2.3 GREEN: Update CSV import flow to use shared helpers while preserving current row errors and counts.
- [x] 2.4 GREEN: Update XLSX import flow to use shared helpers while preserving current row errors and counts.
- [x] 2.5 REFACTOR: Keep cost parser exports compatible and remove import-path duplication where safe.

## 3. Verification

- [x] 3.1 Run focused backend product import tests and confirm RED-to-GREEN results.
- [x] 3.2 Run backend type-check.
- [ ] 3.3 Run backend lint. Attempted; blocked before project linting by existing ESLint/minimatch runtime error: `TypeError: expand is not a function`.
- [x] 3.4 Run OpenSpec validation for `harden-product-import-pipeline`.
- [x] 3.5 Log project memory for the completed hardening pattern.
