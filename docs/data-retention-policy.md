# Data Retention Policy

## Overview

This policy defines how long data is retained in the system, when it's deleted, and compliance responsibilities for GDPR, CCPA, and other regulations.

**Policy Effective Date**: March 7, 2026  
**Last Review**: March 7, 2026  
**Next Review**: Quarterly (annually with legal team)  
**Owner**: Legal / Compliance Officer

---

## Scope

This policy applies to:

- ✓ CSV upload files (stored in Cloudflare R2)
- ✓ Database records (products, orders, inventory in Neon)
- ✓ Audit logs (API access, user actions, payments)
- ✓ Deleted user data (right-to-be-forgotten)
- ✓ Backup data (Neon snapshots, R2 versions)

---

## 1. CSV Upload Files (Cloudflare R2)

### Default Retention Period: **90 days**

**Purpose**: Allow users to access recent uploads, but not store indefinitely to control costs and compliance

**Lifecycle Rules**:

```
Uploads under 1 year old:      KEEP (for user access)
Uploads 90-180 days old:         TRANSITION to storage class "Archive"
Uploads over 180 days old:       DELETE permanently
```

**Configuration (R2 Lifecycle Rules)**:

```json
{
  "rules": [
    {
      "id": "archive-old-uploads",
      "status": "Enabled",
      "filter": {
        "prefix": "csv-uploads-prod/"
      },
      "days": 90,
      "storageClass": "Archive"
    },
    {
      "id": "delete-very-old-uploads",
      "status": "Enabled",
      "filter": {
        "prefix": "csv-uploads-prod/"
      },
      "noncurrentDays": 180,
      "actions": ["Delete"]
    }
  ]
}
```

**Organization Override**: Organizations on **Premium** tier can request extended retention (1 year)

- Request via support ticket
- Cost: $0.01 per GB per month (R2 storage cost)
- Documented in admin interface

**Failed Uploads**:

- Failed uploads (error during processing) retained for **7 days** for debugging
- Automatic cleanup of failed uploads older than 7 days
- Users cannot access failed uploads (no need to notify)

### Implementation

```bash
# Apply lifecycle rules to R2 bucket via AWS CLI
aws s3api put-bucket-lifecycle-configuration \
  --bucket csv-uploads-prod \
  --endpoint-url https://account-id.r2.cloudflarestorage.com \
  --lifecycle-configuration file://r2-lifecycle-rules.json
```

---

## 2. Database Records (Neon PostgreSQL)

### Retention Periods by Record Type

| Record Type             | Retention                | Reason                   | Deletion Method        |
| ----------------------- | ------------------------ | ------------------------ | ---------------------- |
| **Products**            | Indefinite               | Core business data       | Manual via admin       |
| **Inventory**           | Indefinite               | Business records         | Manual via admin       |
| **Audit Logs**          | 1 year                   | Operational/Security     | Scheduled job          |
| **API Keys**            | Indefinite\*             | Security                 | Revoke on user request |
| **Session/Tokens**      | 30 days after expiration | Compliance (temporary)   | Automatic cleanup      |
| **Failed Transactions** | 90 days                  | Debug/Dispute            | Automatic cleanup      |
| **User Activity Logs**  | 2 years                  | Compliance/Investigation | Scheduled job          |
| **Payment Records**     | 7 years\*\*              | Financial/Tax compliance | Manual archive only    |
| **GDPR Requests**       | Indefinite               | Compliance audit trail   | Never delete           |

\*API Keys: Revoke immediately on suspicion of compromise  
\*\*Payment Records: Immutable per PCI-DSS and tax law

### Product Soft Delete (GDPR Compliance)

Products are **soft-deleted** (not immediately removed):

```sql
-- Products table includes:
created_at: timestamp      -- Original creation
updated_at: timestamp      -- Last modification
deleted_at: timestamp NULL -- Soft deletion timestamp
deleted_by: uuid NULL      -- Who deleted (admin user)

-- Query active products:
SELECT * FROM products WHERE deleted_at IS NULL;

-- Hard-delete after 30 days of soft deletion:
DELETE FROM products WHERE deleted_at < NOW() - INTERVAL '30 days';
```

**Rationale**:

1. Soft delete allows 30-day recovery window if accidental
2. Hard delete after 30 days ensures GDPR compliance (not stored system)
3. Users can request permanent deletion immediately if needed

---

## 3. Audit Logs (API Access & User Actions)

### Retention Periods

| Log Type                | Retention | Access            | Archival             |
| ----------------------- | --------- | ----------------- | -------------------- |
| **API Access Logs**     | 1 year    | Admins only       | Neon backups         |
| **User Action Logs**    | 2 years   | Admins only       | Neon backups         |
| **Security Events**     | 1 year    | Admins + Security | Neon backups         |
| **Payment Audit Trail** | 7 years   | Finance only      | Cold storage         |
| **Application Errors**  | 90 days   | Dev + Ops         | Sentry (auto-delete) |

### Implementation

**Audit Log Cleanup Job** (runs daily at 02:00 UTC):

```typescript
// backend/jobs/audit-log-cleanup.job.ts

export async function cleanupAuditLogs() {
  const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);

  // Delete API access logs older than 1 year
  await db.auditLog.deleteMany({
    where: {
      type: 'API_ACCESS',
      createdAt: { lt: oneYearAgo },
    },
  });

  // Delete user action logs older than 2 years (if not payment-related)
  const twoYearsAgo = new Date(Date.now() - 730 * 24 * 60 * 60 * 1000);
  await db.auditLog.deleteMany({
    where: {
      type: { not: 'PAYMENT' },
      createdAt: { lt: twoYearsAgo },
    },
  });

  // Never delete payment audit logs (7-year retention)
  // (no delete query for PAYMENT type)

  logger.info('Audit log cleanup completed');
}
```

---

## 4. User Data & GDPR Right-to-be-Forgotten

### Right to Be Forgotten (Article 17, GDPR)

**Trigger**: User request via support or through account settings page

**Process**:

1. **Request Received** (Day 0)
   - User submits deletion request with email confirmation
   - Create `DeletionRequest` record in database
   - Send confirmation email: "Your data will be deleted within 30 days"
   - Log in audit trail (immutable record)

2. **Escalation Period** (Days 0-7)
   - User can cancel deletion request within 7 days
   - No irreversible deletions happen yet
   - Grace period for accidental requests

3. **Data Deletion Phase** (Days 7-30)
   - After 7 days, begin deleting user data:
     - Delete user account
     - Delete all organizations where user is sole owner
     - Delete all products created by user
     - Delete all API keys and sessions
     - Delete all personal PII fields (except audit trail)

4. **Verification** (Day 28)
   - Verify user data completely removed
   - Retain only immutable audit logs
   - Send completion email: "Your data has been deleted"

5. **Archive** (Day 30)
   - Final immutable record: "User X deleted at timestamp Y"
   - Cannot be reverted

### Implementation

**Database Schema for Deletion Tracking**:

```sql
CREATE TABLE deletion_requests (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  email TEXT NOT NULL,
  requested_at TIMESTAMP NOT NULL DEFAULT NOW(),
  cancelled_at TIMESTAMP,
  completed_at TIMESTAMP,
  reason TEXT,

  -- Immutable audit fields
  created_by VARCHAR(50) DEFAULT 'user-request',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Immutable audit log (never delete)
CREATE TABLE deletion_audit (
  id UUID PRIMARY KEY,
  deletion_request_id UUID NOT NULL REFERENCES deletion_requests(id),
  action TEXT NOT NULL, -- 'REQUESTED', 'CANCELLED', 'COMPLETED'
  user_id UUID,
  email TEXT,
  deleted_count BIGINT, -- Number of records deleted
  timestamp TIMESTAMP NOT NULL DEFAULT NOW()
);
```

**GDPR Deletion Job**:

```typescript
// backend/jobs/gdpr-deletion.job.ts

export async function processGDPRDeletions() {
  // Find deletion requests ready to process (7+ days old)
  const readyForDeletion = await db.deletionRequest.findMany({
    where: {
      cancelled_at: null,
      completed_at: null,
      requested_at: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    },
  });

  for (const request of readyForDeletion) {
    try {
      // Delete user organizations (only if user is sole owner)
      const organizations = await db.organization.findMany({
        where: { created_by: request.user_id },
        include: { members: true },
      });

      for (const org of organizations) {
        if (org.members.length === 1) {
          // Sole owner - safe to delete org
          await db.organization.delete({ where: { id: org.id } });
        } else {
          // Multiple members - remove user only
          await db.organizationMember.deleteMany({
            where: { user_id: request.user_id },
          });
        }
      }

      // Delete user products
      await db.product.deleteMany({
        where: { created_by: request.user_id },
      });

      // Soft-delete user account
      await db.user.update({
        where: { id: request.user_id },
        data: {
          email: `deleted-${request.user_id}@placeholder.local`,
          deleted_at: new Date(),
        },
      });

      // Mark deletion complete
      await db.deletionRequest.update({
        where: { id: request.id },
        data: { completed_at: new Date() },
      });

      // Log immutable audit record
      await db.deletionAudit.create({
        data: {
          deletion_request_id: request.id,
          action: 'COMPLETED',
          user_id: request.user_id,
          email: request.email,
          deleted_count: 1, // User record
        },
      });

      logger.info(`GDPR deletion completed for user ${request.user_id}`);
    } catch (error) {
      logger.error(`GDPR deletion failed for user ${request.user_id}:`, error);
      // Notify admin - manual intervention may be needed
    }
  }
}
```

**Schedule**: Run daily at 03:00 UTC (after audit log cleanup)

---

## 5. Backup Data Retention

### Neon Database Backups

Covered under [Neon Backup & Restore](./neon-backup-restore.md):

- **Starter Plan**: 7-day automatic retention
- **Pro Plan**: 30-day automatic retention
- **No manual action needed**: Neon handles deletion automatically

### R2 Object Versioning

If R2 versioning enabled:

- **Current objects**: Covered under CSV Upload policy (90/180 days)
- **Previous versions**: Retained for 30 days (allows accidental recovery)
- **Older versions**: Deleted automatically via lifecycle rules

---

## 6. Compliance Audit Trail

### Immutable Records (Never Delete)

These records are immutable and kept indefinitely for compliance:

- GDPR deletion requests and completion records
- System security events (unauthorized access attempts)
- Payment disputes and chargebacks
- Compliance audit tokens
- Account creation/suspension history

**Access**: Compliance officer + legal team only

---

## 7. Data Portability (GDPR Article 20)

### User Can Request Data Export

**Process**:

1. User requests export via support or API
2. System generates export containing:
   - All user personal data
   - All organizations user belongs to
   - All products user created or manages
   - All audit records related to user
3. Export format: JSON or CSV (user choice)
4. Sent to user email within 7 days

**Implementation**:

```typescript
async function exportUserData(userId: string) {
  const user = await db.user.findUnique({ where: { id: userId } });
  const organizations = await db.organization.findMany({
    where: { members: { some: { user_id: userId } } },
  });
  const products = await db.product.findMany({
    where: { created_by: userId },
  });

  return {
    user: sanitizeUser(user),
    organizations,
    products,
    export_date: new Date().toISOString(),
    retention_policy_url: 'https://yourdomain.com/legal/retention',
  };
}
```

---

## 8. Third-Party Data Processors

### Services with Data Access

| Service           | Data Type        | Retention                | Contact                |
| ----------------- | ---------------- | ------------------------ | ---------------------- |
| **Neon**          | Database records | 7-30 days (auto-backups) | privacy@neon.tech      |
| **Cloudflare R2** | CSV uploads      | 90-180 days (lifecycle)  | privacy@cloudflare.com |
| **Stripe**        | Payment info     | 7 years (PCI compliance) | privacy@stripe.com     |
| **Sentry**        | Error logs       | 90 days (auto-delete)    | privacy@sentry.io      |

**DPA Status**: All processors have signed Data Processing Agreements

---

## 9. Data Breach Notification

If data breach occurs:

1. **Immediate** (within 1 hour): Assess scope and notify legal team
2. **Within 24 hours**: Notify affected users
3. **Within 24 hours**: Notify regulatory authorities (if required by GDPR)
4. **Within 5 days**: File official breach report (if mandated)

**Notification Template**:

```
Subject: [URGENT] Data Security Notice - Action Required

We discovered unauthorized access to [DATA TYPE].
Investigation shows [SCOPE OF EXPOSURE].
Steps we took: [MITIGATION].
What you should do: [USER ACTIONS].
Questions? Contact: support@yourdomain.com
```

---

## 10. Retention Override Requests

### When Users Need Extended Retention

**Example**: Enterprise customer wants to retain CSV uploads for 2 years for audit

**Process**:

1. Customer submits request with business justification
2. Review by legal/compliance team (~1 week)
3. If approved: Update organization retention policy
4. Implement custom lifecycle rule in R2

**Cost**: Organization pays additional R2 storage costs

---

## 11. Annual Policy Review Checklist

**Complete annually (March):**

- [ ] Review GDPR/CCPA compliance requirements
- [ ] Audit actual retention vs. policy
- [ ] Check for any data sitting beyond retention periods
- [ ] Review customer requests for retention modifications
- [ ] Update legal hold list (litigation/investigations)
- [ ] Verify all deletion jobs running successfully
- [ ] Document any policy violations discovered

---

## 12. Employee Data Retention

### If Employee Leaves Company

**All employee access revoked immediately:**

- Remove API keys
- Delete session tokens
- Remove from all organizations
- Archive user records (not deleted)

**Emails**: Send to personal email (not company domain)

---

## Quick Reference Table

| Data Type            | Retention       | Hard Delete | Soft Delete | Compliance       |
| -------------------- | --------------- | ----------- | ----------- | ---------------- |
| **CSV Uploads**      | 90 days         | Day 180     | N/A         | Cost control     |
| **Database Records** | Indefinite      | Manual      | 30 days     | Business/legal   |
| **Audit Logs**       | 1 year          | Day 365     | N/A         | Security         |
| **Payment Records**  | 7 years         | Never       | N/A         | Tax/PCI          |
| **User Deletions**   | 30 days         | Day 30      | 7 days      | GDPR Article 17  |
| **API Keys**         | Indefinite      | On revoke   | N/A         | Security         |
| **Session Tokens**   | 30 days expired | Day 30      | N/A         | Session security |

---

## Related Documents

- **[Neon Backup & Restore](./neon-backup-restore.md)** - Database backup retention details
- **[R2 Data Recovery](./r2-recovery-procedure.md)** - R2 lifecycle configuration
- **[Incident Response Plan](./incident-response-plan.md)** - Data breach notification
- **[Master Disaster Recovery Plan](./disaster-recovery.md)** - Complete recovery scenarios

---

**Last Updated**: March 7, 2026  
**Legal Review**: Required before production launch  
**Owner**: Compliance Officer / Legal Counsel
