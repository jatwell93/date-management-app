## 1. Regression Coverage

- [x] 1.1 RED: Add a frontend validator test for XLSX product catalog headers from the FRED export shape.

## 2. Implementation

- [x] 2.1 GREEN: Extend the existing column validator to parse XLS/XLSX workbook headers instead of reading them as CSV text.
- [x] 2.2 REFACTOR: Keep CSV behavior unchanged and avoid duplicating required-column matching logic.

## 3. Verification

- [x] 3.1 Run the focused frontend CSV validator test.
- [x] 3.2 Validate the OpenSpec change.
- [x] 3.3 Run frontend lint/build checks and local browser QA with `test.xlsx`.
