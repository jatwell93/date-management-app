## Why

Product catalog XLS/XLSX uploads can be blocked by the frontend column warning even when the workbook contains accepted headers. The current pre-upload validator reads every file as CSV text, so Excel workbooks are interpreted as binary content instead of worksheet headers.

## What Changes

- Extend the existing frontend column validator to read `.xls` and `.xlsx` headers with SheetJS before matching required product columns.
- Preserve current CSV validation behavior and duplicate-header first-match behavior.
- Add a regression test using an Excel workbook with `Item Code`, `Item Description`, `Cost Ex`, and `Barcode`.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `csv-upload-processing`: pre-upload column validation must support accepted headers in CSV, XLS, and XLSX product catalog files.

## Impact

- **Frontend utility:** `frontend/src/utils/csvValidator.ts`
- **Frontend tests:** `frontend/src/utils/__tests__/csvValidator.test.ts`
- **User workflow:** `/csv-upload` product catalog uploads no longer show false missing-column warnings for valid Excel workbooks.
