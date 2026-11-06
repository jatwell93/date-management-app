## 1. Inventory

- [x] 1.1 Inventory item create takes camelCase only (#768): the create handler reads `productId`, `expiryDate` and `locationId` only, and the snake_case fallback, its deprecation warning and its helper are removed.
      Demo: a create request with only `product_id`, `expiry_date` and `location_id` returns 400 `Missing or invalid productId`; a camelCase request creates the item; a stray `product_id` beside a valid `productId` is ignored.
      Acceptance: the Worker contract and handler tests assert rejection and ignoring; the Worker gate and lint pass.

## 2. Store areas and store walks

- [x] 2.1 Store area and store walk check take camelCase only (#769): area create and update read only `subDepartment` and `parentId`; walk check create reads only `storeAreaId`, `checkedAt` and `itemsAddedCount`.
      Demo: creating an area with only `parent_id` gives an area with no parent; a walk check with only `store_area_id` returns 400 `Missing required field: storeAreaId`.
      Acceptance: handler tests cover rejection and ignoring of the snake_case form; the Worker gate and lint pass.

## 3. Frontend contract

- [x] 3.1 Frontend contract test asserts snake_case rejection (#770): the frontend API contract test no longer accepts snake_case and matches the Worker contract.
      Demo: the frontend diff gate is green and no case accepts snake_case.
      Acceptance: a case asserts a snake_case-only body is not valid; the frontend diff gate and lint pass.
