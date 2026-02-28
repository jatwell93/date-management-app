---
title: Multi-Tenant Guide
phase: 5
week: 7
status: draft
---

# Multi-Tenant Architecture

Date-Management App is now **organization-centric**. Every record carries an immutable `organizationId` (UUID). Services always scope reads & writes to the active organization making cross-tenant leaks impossible.

## Quick Facts

- **Isolation Layer** – Prisma `organizationId` WHERE clause injected by service helpers.
- **Auth Source** – Clerk JWT → `org_id` in custom claim → Express `organizationContext` middleware.
- **Cascade Deletes** – All FK relations specify `onDelete: CASCADE`; removing an org deletes its data tree in ≤2 s.

## Creating an Organization

```bash
POST /api/organizations
{
  "name": "Acme Widgets"
}
```
Returns `201 { id, name, subscriptionTier }`.  The creator is auto-assigned `role: OWNER` and is billed immediately via Stripe Checkout.

## Switching Organizations (Multi-Org Users)

1. Frontend fetches `/api/organizations` → list user-accessible orgs.
2. Selecting an org stores `orgId` in Clerk Session custom claim.
3. Next request hits `organizationContext` middleware → sets `req.organizationId`.  All downstream services rely on this value.

## Data Access Rules

| Layer            | Rule                                                            |
|------------------|-----------------------------------------------------------------|
| **Routes**       | Never accept `organizationId` from client params/body           |
| **Services**     | Always call `getActiveOrgId()` helper (throws if missing)       |
| **Prisma**       | Use `where: { organizationId: activeOrgId }` or `$transaction()` |

## User Roles per Org

| Role   | Abilities                                              |
|--------|--------------------------------------------------------|
| OWNER  | Full admin + billing                                   |
| ADMIN  | Manage resources & users                               |
| MEMBER | CRUD inventory, view reports                           |
| VIEWER | Read-only access                                       |

Role is scoped per organization; same email may hold different roles across orgs.

## Tenant-Scoped Queries Cheat-Sheet

```ts
function listProducts() {
  const orgId = getActiveOrgId();
  return prisma.product.findMany({ where: { organizationId: orgId } });
}
```

Use the built-in `tenant()` helper for brevity:

```ts
return prisma.product.tenant(orgId).findMany();
```

## CLI Helpers

```bash
# View org usage & limits
npm run org:usage -- --org acme-org-uuid

# Impersonate org context for local scripts
export ORG_ID=acme-org-uuid && ts-node scripts/my-script.ts
```

## Troubleshooting

- **403** → user lacks role within target org.
- **404** → resource exists but belongs to different org (filtered by `organizationId`).
- **Stripe webhook missing metadata** → ensure `customer.metadata.organizationId` is set during Checkout.

---

_Updated Feb 2026.  Feedback → #docs channel._
