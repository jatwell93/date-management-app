## Why

`backend/src/services/product.service.ts` is a known CodeScene regression hotspot and currently owns too much import behavior. CSV and XLSX upload paths repeat required-field validation, cost parsing, length checks, lookup/update/create branching, and row error construction inside the service.

Current hotspots:

- `backend/src/services/product.service.ts:479` handles CSV row parsing and product upsert logic inline.
- `backend/src/services/product.service.ts:723` repeats similar XLSX row validation and upsert behavior.
- `backend/src/services/product.service.ts:28` and `backend/src/services/product.service.ts:68` expose overlapping cost parsing helpers.
- `backend/src/services/product-import.helpers.ts` already owns product import column detection and is the right reuse boundary for row-level import helpers.

## What Changes

- Add focused tests for shared product import row validation and operation selection.
- Move row normalization, validation, and duplicate identifier resolution into `product-import.helpers.ts`.
- Keep `ProductService` responsible for transactions, repository calls, and final import counts.
- Preserve public behavior for `processCSVUpload`, `processCSVUploadInternal`, and XLSX imports.
- Keep exported cost parser compatibility for existing callers while reducing duplicated parser use in import flows.

## Reuse Strategy

- Extend `backend/src/services/product-import.helpers.ts` instead of creating a new import utility module.
- Keep `ProductService` as the service entry point used by controllers and tests.
- Preserve existing repository methods and prior SKU/barcode conflict behavior.
- Follow existing backend unit-test style in `backend/src/tests/unit/product-import.helpers.test.ts` and `backend/src/tests/unit/product.service.test.ts`.

## Impact

- **Backend service:** `backend/src/services/product.service.ts`
- **Backend helpers:** `backend/src/services/product-import.helpers.ts`
- **Tests:** `backend/src/tests/unit/product-import.helpers.test.ts`, existing focused product import tests
- **Verification:** focused Jest tests, backend type-check, backend lint, and OpenSpec validation
