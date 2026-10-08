# Cross-Tenant Isolation Assurance

## Overview

This document gives security reviewers detailed information about our multi-tenant data isolation architecture. It describes technical controls only; it does not claim any compliance certification (see Compliance Status). It explains how we ensure customer data remains strictly segregated and cannot be accessed across organization boundaries.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Isolation Mechanisms](#isolation-mechanisms)
3. [Database Schema](#database-schema)
4. [Security Testing](#security-testing)
5. [Audit & Compliance](#audit--compliance)
6. [Incident Response](#incident-response)
7. [Questionnaire Answers](#questionnaire-answers)

---

## Architecture Overview

### Multi-Tenant Design

Our application implements **strict tenant isolation** at every layer:

```
Application (Cloudflare Worker)
  1. Authentication  : Clerk token verified on every request
  2. Tenant context  : organization_id read from the users row (not from the client)
  3. Entitlement gate: organization subscription state checked
  4. Data access     : every query filters organization_id (workers/src/database.ts)
  5. Database        : NOT NULL organization_id with a foreign key; composite unique keys
```

### Tenant Context Flow

1. **Login**: Clerk authenticates the user and issues a session token.
2. **Request**: `authenticateApiRequest` verifies the token and extracts the Clerk user id.
3. **Resolution**: the Worker looks up the `users` row for that Clerk user and reads `organization_id` and `role` from it. A user with no row gets 401; an organization that fails the entitlement gate is refused.
4. **Processing**: handlers pass `auth.organizationId` to `database.ts`, where every tenant query filters on it.
5. **Response**: only data matching the organization is returned.

---

## Isolation Mechanisms

### 1. Server-Side Organization Context

The organization is never taken from the request. After the Clerk token is verified, the Worker reads `organization_id` from the caller's `users` row (`workers/src/index-minimal.ts`, `resolveAuthenticatedUser`):

```typescript
const auth = await authenticateApiRequest(request, env, db);
if (auth instanceof Response) return auth; // 401 / entitlement refusal
// auth.organizationId comes from users.organization_id
```

### 2. Query-Level Isolation

`organizationId` is the first, required parameter of every tenant-data method in `workers/src/database.ts`, so a call site that omits it fails to compile. Every query on a tenant table filters on it, and joins to another tenant table correlate on it too:

```typescript
async findProductById(organizationId: string, id: number) {
  // ... WHERE id = ${id} AND organization_id = ${organizationId}
}
```

Reads, updates and deletes all carry the predicate. A request for another tenant's id returns nothing and changes nothing, because the row is simply not matched.

### 3. Database Schema Isolation

Every tenant-scoped table has `organization_id` as `NOT NULL` with a validated foreign key to `organizations(id)`. A test enforces this for the whole schema, and requires any table without it to be listed with a reason (see Security Testing). Examples are `products`, `inventory_items`, `store_areas`, `users`, `uploads`, `audit_log`, `item_transactions` and `expired_item_transactions`.

### 4. Unique Constraints Per Tenant

SKU and barcode uniqueness is enforced per organization, not globally (`database/migrations/0000_baseline.up.sql`):

```sql
CREATE UNIQUE INDEX "products_organization_id_sku_key" ON "products"("organization_id", "sku");
CREATE UNIQUE INDEX "products_organization_id_barcode_key" ON "products"("organization_id", "barcode");
```

**Result**:

- Org A can have SKU "ASPIRIN-500"
- Org B can also have SKU "ASPIRIN-500"
- Both are valid and completely isolated

### 5. Cascade Delete Protection

Tenant tables reference `organizations(id)` with `ON DELETE CASCADE`, so deleting an organization removes its related data and leaves no orphaned rows.

### 6. Route-Level Parameter Validation

Handlers do not read `organizationId` from the request body or query string. They pass `auth.organizationId`, which comes from the `users` row:

```typescript
const product = await db.findProductById(auth.organizationId, id);
```

---

## Database Schema

### Tenant Isolation Verification

Run this query to verify all tables have organizationId:

```sql
-- Check all tables have organization_id column
SELECT
  table_name,
  column_name,
  is_nullable
FROM information_schema.columns
WHERE column_name = 'organization_id'
  AND table_schema = 'public'
ORDER BY table_name;
```

Expected results: every tenant-scoped table is listed with `is_nullable = NO`. Tables without `organization_id` are the ones named in `UNSCOPED_TABLES` in `workers/src/database.tenant-scope-invariant.pglite.node.test.ts`, each with its reason.

### Cross-Tenant Access Prevention

The following query patterns are used throughout the application:

**Read Isolation**:

```sql
-- Products can only be read by their owning organization
SELECT * FROM products
WHERE organization_id = 'org-uuid-from-users-row';
```

**Write Protection**:

```sql
-- Updates only affect products in the user's organization
UPDATE products
SET name = 'New Name'
WHERE id = 123
  AND organization_id = 'org-uuid-from-users-row';
```

**Delete Protection**:

```sql
-- Deletes only affect products in the user's organization
DELETE FROM products
WHERE id = 123
  AND organization_id = 'org-uuid-from-users-row';
```

### Audit Logging

Two tables record changes with organization context:

- `audit_log`: written in the same statement as inventory item create, update and delete (`organization_id`, `user_id`, `inventory_item_id`, `action`, `change_description`, `created_at`).
- `org_audit_log` (migration 0013): role grants and removals, with actor and target organization and the client IP.

Reads are not logged, and `audit_log` does not store old and new values. Do not cite broader coverage without checking `workers/src/database.ts` first.

---

## Security Testing

### Real-SQL Tests (pglite)

The Worker's isolation tests run the actual migrations and queries in pglite (`npm run test:db`). Each one seeds rows for a second organization that would be returned or changed if scoping regressed, and asserts on identity rather than count.

| Test file (`workers/src/`)                             | What it covers                                                                                                                                           |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `database.tenant-isolation.pglite.node.test.ts`        | Product, inventory and store-area read paths never return another organization's rows                                                                    |
| `database.tenant-isolation-writes.pglite.node.test.ts` | Updates and deletes cannot touch another organization's rows; cross-organization references on write are refused                                         |
| `database.tenant-scope-invariant.pglite.node.test.ts`  | Every table in `public` has a NOT NULL, foreign-keyed `organization_id`, or is listed as unscoped with a reason; mutation cases prove the check can fail |

A new isolation test is only evidence once you have removed the `organization_id` predicate it guards and watched it fail.

**Not covered by an automated suite today:** SQL injection through `organizationId` (the value is a bound parameter, not interpolated), and concurrent multi-organization load. Token verification is covered in `clerk/request-authentication.test.ts`. The earlier Express-era penetration suite was retired with the backend (tag `express-sqlite-last`); do not quote its results as current.

---

## Audit & Compliance

### Audit Trail Coverage

See "Audit Logging" under Database Schema for what `audit_log` and `org_audit_log` record. Reads are not logged.

### Compliance Status

**No compliance certification or attestation is claimed.** SOC 2, GDPR, HIPAA, PCI DSS and encryption-at-rest statements have not been verified for this system and are not made here. Confirm each one, with evidence, before launch and before answering a customer questionnaire. The technical controls in this document (query scoping, schema constraints, tests) are inputs to that work, not a substitute for it.

### Per-Organization Data

Every tenant table can be queried by organization id, for example to count an organization's rows before an export or deletion:

```sql
SELECT COUNT(*) FROM products WHERE organization_id = 'org-uuid';
SELECT COUNT(*) FROM inventory_items WHERE organization_id = 'org-uuid';
SELECT COUNT(*) FROM audit_log WHERE organization_id = 'org-uuid';
```

This is a technical capability, not a data-residency guarantee. Where the data is stored is determined by the Neon project region.

---

## Incident Response

### Cross-Tenant Leak Detection

**Monitoring**: There is no runtime cross-tenant detector. Isolation is enforced by query scoping and verified by the tests above. Unexpected errors reach Sentry; use `audit_log` and `org_audit_log` to investigate a suspected leak.

**Response Procedure**:

1. **Immediate**: Isolate affected endpoint
2. **Investigation**: Query audit logs for affected organizations
3. **Containment**: Verify no data exfiltration occurred
4. **Notification**: Inform affected customers if breach confirmed
5. **Remediation**: Fix root cause, enhance tests

### Audit Log Investigation

Query to detect potential cross-tenant access attempts:

```sql
-- Find users accessing multiple organizations rapidly
SELECT
  user_id,
  COUNT(DISTINCT organization_id) as org_count,
  COUNT(*) as access_count
FROM audit_log
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY user_id
HAVING org_count > 1;
```

---

## Questionnaire Answers

### For Security Questionnaires

These answers cover tenant isolation only. Do not extend them to encryption, certifications or regulatory compliance until those are confirmed.

**Q: How do you ensure customer data isolation?**

A: We implement multi-tenant isolation at three layers:

1. Authentication: Clerk tokens are verified on every request, and the organization is resolved server-side from the user's record
2. Application: All database queries filter on `organization_id`, with `organizationId` a required parameter of every tenant data method
3. Database: `organization_id` is NOT NULL with a foreign key on tenant tables, and unique keys are composite (`organization_id` + resource) to prevent cross-tenant collisions

**Q: Can one customer access another customer's data?**

A: Each request is scoped to the authenticated user's organization. Database queries filter by `organization_id`, and the real-SQL isolation tests assert that another organization's rows are neither returned nor changed.

**Q: What happens if a user tries to tamper with the organizationId parameter?**

A: The organization is read from the user's database record after the Clerk token is verified. The API does not accept `organizationId` from query parameters or request bodies. A tampered token fails verification (401).

**Q: How do you test tenant isolation?**

A: Our test suite includes:

- Real-SQL isolation tests for reads, writes and deletes (pglite)
- A schema invariant test that every tenant table carries a constrained `organization_id`
- Clerk token verification tests

**Q: How is an organization's data deleted?**

A: Organization deletion cascades to all related data through `ON DELETE CASCADE` foreign keys. Complete data removal can be verified via:

```sql
SELECT COUNT(*) FROM products WHERE organization_id = 'org-to-delete';
-- Should return 0 after deletion
```

---

## Verification Checklist

For a security review, verify:

- [ ] Every tenant-scoped table has `organization_id` NOT NULL with a foreign key (`npm run test:db`, tenant-scope-invariant)
- [ ] Every tenant query in `workers/src/database.ts` filters `organization_id`
- [ ] Unique constraints are composite: `(organization_id, sku)`, `(organization_id, barcode)`
- [ ] `authenticateApiRequest` resolves the organization from the `users` row
- [ ] Handlers reject `organizationId` from request body/query params
- [ ] Isolation tests pass (`npm run test:db`)

---

## Related Documentation

- [Multi-Tenant Guide](./multi-tenant-guide.md) - Developer documentation
- [Security Documentation](./security.md) - General security practices
- [SaaS Operational Runbook](./SAAS_OPERATIONAL_RUNBOOK.md) - Admin procedures
- [Isolation tests](../workers/src/database.tenant-isolation.pglite.node.test.ts) - Test implementations

---

_Last updated: October 2026_
