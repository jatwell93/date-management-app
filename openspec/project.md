---
title: OpenSpec — Multi-Tenant Conventions
phase: 5
week: 7
status: draft
---

# Purpose

Define canonical conventions for **tenant-scoped development** across the Worker API and frontend layers so that any engineer can quickly reason about data isolation.

## Golden Rules

1. **No `organizationId` from client payloads** – server derives org from auth claims only.
2. **Service Boundary = Tenant Boundary** – every service method requires active org context.
3. **Delete = Cascade** – FK relations specify `onDelete: CASCADE` to prevent orphan data.
4. **Logs & Metrics include `organizationId`** – necessary for tenant-level debugging.
5. **One API, one source of truth** – the API is the Cloudflare Worker in `workers/` on Neon Postgres. Logic shared with the frontend lives in `shared/domain/*`, and behaviour that depends on SQL is covered by a real-SQL test (`npm run test:db`, pglite), including row order. The Express/SQLite backend is retired; the last revision is the tag `express-sqlite-last`.
6. **Schema changes go through one migration path** – a column/table/index change is a numbered pair `database/migrations/NNNN_*.up.sql` and `.down.sql`, applied by the runner in `src/database/migrations/`, which is the authority. Update the manifest and catalog fingerprint with it (`npm run test:migrations` checks both).

## Worker Patterns

| Pattern                            | Implementation                                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **`authenticateApiRequest`**       | Verifies the Clerk token, then reads `organization_id` and `role` from the `users` row (`workers/src/index-minimal.ts`)  |
| **Explicit `organizationId`**      | First, required parameter on every tenant-data method in `workers/src/database.ts`; each query filters `organization_id` |
| **`checkOrganizationEntitlement`** | Gates the request on the organization's subscription state before the handler runs                                       |

Example:

```ts
const auth = await authenticateApiRequest(request, env, db);
if (auth instanceof Response) return auth;
const items = await db.findInventoryItems(auth.organizationId, { limit, offset });
```

## Frontend Patterns

- **Org Picker** in `/settings/organizations` updates Clerk session.
- **useActiveOrg()** hook → provides `orgId`, `role`.
- Query keys include `orgId` to auto-invalidate on switch.

## Database Naming

- Tables: plural snake_case (`products`, `inventory_items`)
- Tenant key: `organization_id` (indexed); the Worker maps it to `organizationId` in results

## Testing

- Tenant-isolation tests seed rows for a second organization and assert they never appear (`npm run test:db`, pglite).
- Mutation-verify a new isolation test: remove the `organization_id` predicate and confirm the test fails.

---

_Last reviewed: Oct 2026_
