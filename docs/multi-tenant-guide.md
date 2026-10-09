---
title: Multi-Tenant Guide
phase: 5
week: 7
status: draft
---

# Multi-Tenant Architecture

Date-Management App is **organization-centric**. Every tenant record carries an `organization_id`. The Worker scopes every read and write to the organization of the signed-in user, so one tenant cannot reach another's data. See [`cross-tenant-isolation-assurance.md`](./cross-tenant-isolation-assurance.md) for the controls and the tests that prove them.

## Quick Facts

- **Isolation Layer** – every query in `workers/src/database.ts` filters `organization_id`, and `organizationId` is the first required parameter of every tenant method.
- **Auth Source** – Clerk token verified in the Worker, then `organization_id` and `role` read from the caller's `users` row (`authenticateApiRequest`). The client never supplies it.
- **Cascade Deletes** – tenant tables reference `organizations(id)` with `ON DELETE CASCADE`, so removing an organization removes its data.

## Creating an Organization

Organizations are created on first sign-in by the bootstrap call, not by a public create endpoint:

```bash
POST /api/organization/bootstrap
```

The handler (`workers/src/clerk/bootstrap-handler.ts`) verifies the Clerk token, finds or creates the organization, upserts the `users` row with a normalized role, and ensures a trial subscription exists. The Clerk webhook keeps memberships in sync afterwards.

## One Organization per User Row

The Worker reads the organization from the `users` row, so each row belongs to one organization. There is no organization switcher in the API; the frontend reflects the organization the Worker resolves.

## Data Access Rules

| Layer        | Rule                                                                        |
| ------------ | --------------------------------------------------------------------------- |
| **Handlers** | Never accept `organizationId` from client params/body                       |
| **Auth**     | Use `auth.organizationId` from `authenticateApiRequest`                     |
| **SQL**      | Filter `organization_id` in every query, including each joined tenant table |

## User Roles per Org

Roles are `admin`, `manager` and `team_member` (`shared/domain/roles.ts`). `users.role` is constrained to those values. Clerk membership roles (`org:admin`, `org:member`, ...) are normalized onto them by the same function at bootstrap and in the Clerk webhook.

| Role        | Abilities                                   |
| ----------- | ------------------------------------------- |
| admin       | Full admin: manage users, roles and billing |
| manager     | Manage inventory and reports                |
| team_member | CRUD inventory, view reports                |

Role changes are recorded in `org_audit_log`.

## Tenant-Scoped Queries Cheat-Sheet

```ts
async findProducts(organizationId: string) {
  return this.sql`
    SELECT id, name, barcode
    FROM products
    WHERE organization_id = ${organizationId}
  `;
}
```

Correlate joins to other tenant tables too: `JOIN products p ON ii.product_id = p.id AND p.organization_id = ii.organization_id`.

## Operator Helpers

```bash
# Inspect Stripe/Clerk webhook deliveries and stuck claims (read-only)
npm run diagnose:webhook
```

Organization usage is read through `GET /api/organization/usage`.

## Troubleshooting

- **403** → user lacks role within target org.
- **404** → resource exists but belongs to a different org (filtered by `organization_id`).
- **Stripe event not attributed** → ensure the organization metadata is set during Checkout; unattributable events are acknowledged and logged.

---

_Updated Oct 2026. Feedback → #docs channel._
