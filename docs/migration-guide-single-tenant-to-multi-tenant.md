---
title: Migration Guide — Single-Tenant → Multi-Tenant
phase: 5
week: 7
status: draft
---

# Overview

This guide walks operators through upgrading an existing single-tenant Date-Management deployment (< 2026-02) to the new **multi-tenant schema**.

## Preconditions

- **Full DB backup** created (SQLite file or Postgres dump).
- Application version **≥ v14.0.0** (contains tenant-aware code paths).
- Stripe webhook secrets configured (trial + billing flows rely on them).

## Step-by-Step

1. **Enable maintenance mode**

   ```bash
   kubectl scale deploy/backend --replicas 0
   kubectl scale deploy/frontend --replicas 0
   ```

2. **Apply schema migrations**

   ```bash
   cd backend && npx prisma migrate deploy
   ```

   Creates `Organization`, adds `organizationId` FK column everywhere (`NOT NULL`) with default `'default-org'`.

3. **Back-fill organization rows**

   ```sql
   INSERT INTO "Organization" (id, name)
   VALUES ('default-org', 'Legacy Org')
   ON CONFLICT DO NOTHING;
   ```

4. **Update existing data**

   ```sql
   UPDATE "Product"          SET "organizationId"='default-org';
   UPDATE "InventoryItem"    SET "organizationId"='default-org';
   UPDATE "StoreArea"        SET "organizationId"='default-org';
   -- repeat for all 8 tables
   ```

5. **Assign owner role to admin user**

   ```sql
   INSERT INTO "OrganizationUserRole" (organizationId, userId, role)
   VALUES ('default-org', 1, 'OWNER')
   ON CONFLICT DO NOTHING;
   ```

6. **Run verification script**

   ```bash
   node scripts/verify-migration.js --org default-org
   ```

   Ensures every row now references a valid organization.

7. **Deploy new code**

   ```bash
   kubectl rollout restart deploy/backend
   kubectl rollout restart deploy/frontend
   ```

8. **Smoke test**
   - Sign in → verify org picker shows _Legacy Org_.
   - CRUD product → ensure read/write OK.
   - Stripe subscription page loads.

## Rollback

1. Scale down services.
2. Restore DB from backup created in step 0.
3. Rollback deployment to previous image tag.

## FAQ

**Q:** Do I need to re-invite users?

> No. Existing users retain access via `default-org`.

**Q:** Can I change the default org ID?

> Yes, after migration simply rename or merge orgs via admin UI.
