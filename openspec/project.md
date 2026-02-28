---
title: OpenSpec — Multi-Tenant Conventions
phase: 5
week: 7
status: draft
---

# Purpose

Define canonical conventions for **tenant-scoped development** across backend, workers, and frontend layers so that any engineer can quickly reason about data isolation.

## Golden Rules

1. **No `organizationId` from client payloads** – server derives org from auth claims only.
2. **Service Boundary = Tenant Boundary** – every service method requires active org context.
3. **Delete = Cascade** – FK relations specify `onDelete: CASCADE` to prevent orphan data.
4. **Logs & Metrics include `organizationId`** – necessary for tenant-level debugging.

## Backend Patterns

| Pattern | Implementation |
|---------|----------------|
| **OrganizationContextMiddleware** | Sets `req.organizationId` from Clerk claim → used downstream |
| **tenant(orgId)** helper | Prisma extension adding `{ where: { organizationId: orgId } }` automatically |
| **LimitError** | Thrown when usage exceeds tier limits; caught by `errorHandler` → 409 |

Example:

```ts
export function listInventory(req: Request, res: Response) {
  const orgId = getOrgId(req);
  const items = prisma.inventoryItem.tenant(orgId).findMany();
  res.json(items);
}
```

## Frontend Patterns

- **Org Picker** in `/settings/organizations` updates Clerk session.
- **useActiveOrg()** hook → provides `orgId`, `role`.
- Query keys include `orgId` to auto-invalidate on switch.

## Database Naming

- Tables: singular PascalCase (`Product`)
- Tenant key: `organizationId` (UUID, indexed)

## Testing

- Helpers: `createOrgFixtures(count)` returns seeded org IDs.
- Integration tests always use `TEST_AUTH_BYPASS` with default `'default-org'` unless overriding.

## Lint Rule (eslint-plugin-local)

`no-client-organization-id` — forbids `req.body.organizationId` usage in controllers.

---

_Last reviewed: Feb 2026_
