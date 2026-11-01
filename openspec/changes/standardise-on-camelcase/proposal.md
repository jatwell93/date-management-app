# Proposal: Accept only camelCase request fields in the Worker API

## Why

The Worker API still accepts a snake_case form of some request body fields beside the camelCase form. This is a leftover from the retired Express backend. Nothing in `frontend/` or `shared/` sends snake_case, and the owner has no active API users (see the store trial roadmap), so the dual support has no caller. It costs code and tests, and it makes the contract unclear: a reader cannot tell which form is the real one.

The snake_case fallbacks live in `workers/src/index-minimal.ts` and `workers/src/utils/inventory-field-mapping.ts`:

- Inventory item create: `product_id`, `expiry_date`, `location_id`, resolved by `resolveInventoryFields`, with a `DEPRECATION` warning from `getDeprecatedSnakeCaseFields`.
- Store walk check create: `store_area_id`, `checked_at`, `items_added_count`.
- Store area create and update: `sub_department`, `parent_id`.

## What changes

- Each handler above reads only the camelCase field. A request that sends only the snake_case form fails the existing required-field validation (400), exactly as if the field were missing. A snake_case field sent beside a camelCase field is ignored.
- `workers/src/utils/inventory-field-mapping.ts` is deleted, with the `DEPRECATION` warning and the snake_case members of `InventoryItemRequestBody`. The camelCase request type stays where the handler needs it.
- The tests that assert the snake_case fallback (`workers/src/__tests__/api-contract-compatibility.test.ts`, `frontend/src/tests/api-contract-compatibility.test.ts`) are rewritten to assert rejection. Handler tests that send snake_case fields move to camelCase.
- The `cloudflare-workers-api` spec records that request bodies use camelCase only.

## Out of scope

- Response field names and database column names. Rows are already aliased to camelCase in SQL, and columns stay snake_case.
- Raw database row types in `index-minimal.ts` (for example the subscription row with `tier_level`). They describe query results, not request bodies.
- CSV import headers (`frontend/src/utils/csvValidator.ts` accepts `expiry_date`). Those are a file format, not the JSON API.
- `/v2/` endpoints, API version headers and client SDKs. There is no external client to migrate.

## Autonomy

```yaml
merge: human
pr: per-change
```

Every file this change touches is outside the `no_go` baseline (`scripts/check-no-go.js`), so the factory can build it. The change has no migration and no production access.
