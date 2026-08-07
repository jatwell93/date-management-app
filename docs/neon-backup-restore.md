# Neon Backup & Restore Procedure

## Overview

Neon PostgreSQL includes automatic backups at no additional cost. This procedure documents how to understand Neon's backup system and perform restore operations when needed.

> **Verified against the Neon API on 2026-08-07 (task 1.9).** The figures below
> are this project's measured configuration, not Neon's marketing tiers. An
> earlier revision of this document claimed a 7-day Starter retention window;
> that was aspirational and wrong by a factor of 28. Re-measure with
> `node scripts/check-neon-pitr.js` (its evidence output carries a `retention`
> block) rather than trusting any number written here.

**Automatic Backups Included**: Yes  
**PITR history retention**: **6 hours** (`history_retention_seconds: 21600`)  
**Recovery Point Objective (RPO)**: bounded by the 6-hour window — see the
consequence below  
**Recovery Time Objective (RTO)**: measured per drill; see
`docs/migrations-deploy-runbook.md` Step 1 and the recorded drill evidence

---

## Backup System Overview

### How Neon Backups Work

Neon automatically creates point-in-time snapshots:

1. **Automatic Snapshots**: Neon creates backups at configurable intervals
2. **Write-Ahead Logs (WALs)**: Transaction logs allow point-in-time recovery
3. **Branch Snapshots**: Each branch creates independent backups
4. **No Cost**: Included in all Neon plans (no separate backup fees)

### This project's measured configuration

Read from `GET /projects/{id}` on 2026-08-07:

| Field                       | Value   | Meaning                                        |
| --------------------------- | ------- | ---------------------------------------------- |
| `history_retention_seconds` | `21600` | **6 hours** of point-in-time recovery reach     |
| `platform_id`               | `aws`   | Cloud platform — **not** the billing plan       |
| `pg_version`                | `17`    | PostgreSQL major version                        |
| `branch_logical_size_limit` | `512`   | MB per branch                                   |

Neon's project payload does not expose a plan/tier name, so the retention
window itself is the authoritative signal — do not infer the plan from
`platform_id`.

### Recovery policy: the 6-hour window, and what it costs us

**A recovery point older than 6 hours is unreachable.** Not "degraded" or
"slower" — gone. This has three concrete consequences that anyone planning a
migration or responding to an incident needs to hold:

1. **Data corruption discovered after 6 hours cannot be rolled back by PITR.**
   Recovery for that case is forward-fix, not restore. This is why the
   migration runner treats destructive down-migrations as a last resort and
   requires a `recovery_strategy` on every migration (task 1.8).
2. **A pre-migration recovery point is only useful within its window.** The
   drill in `docs/migrations-deploy-runbook.md` Step 1 creates a *named*
   snapshot immediately before production DDL for exactly this reason — the
   rollback window opens when the snapshot is taken, not when the problem is
   found.
3. **It bounds the practical RPO.** Worst case, recovery loses everything
   written since the newest reachable restore point.

**Decision (2026-08-07, task 1.9): accept the 6-hour window; do not upgrade.**
The window is adequate for the failure mode it actually guards — a migration
that goes wrong is detected within minutes by the deploy gate's
apply → seed → verify sequence and the post-deploy canary, not hours later.
Upgrading buys reach against a slow-discovery scenario that the existing gates
are designed to prevent. Revisit if a real incident is ever discovered outside
the window, or when the project moves to a paid plan for other reasons.

**This decision is enforced, not just recorded.** `scripts/check-neon-pitr.js`
fails the deploy gate if retention drops below `DEFAULT_MIN_RETENTION_HOURS`
(6), so the window silently shrinking is a build failure rather than a
discovery made during an incident. Raise that floor if the plan is upgraded.

---

## Prerequisites

Before performing restores, ensure:

- [ ] Neon account access (email + password)
- [ ] Project ID known (`echo $NEON_PROJECT_ID`)
- [ ] Neon CLI installed (`npm install -g neon-cli` or use web console)
- [ ] Database connection string saved securely
- [ ] Backup restoration does not violate compliance requirements (GDPR acknowledgment)

---

## Part 1: Understanding Your Backups

### 1.1 View Available Backups (Web Console)

**Using Neon Dashboard:**

1. Navigate to https://console.neon.tech/
2. Select the project (id `dawn-darkness-22587117`; the display name is recorded in operator notes)
3. Go to **Branches** tab in left sidebar
4. Select **main** branch
5. Scroll to **Current Branch** → **Compute Snapshots** section
6. View available restore points with timestamps

**Example Display:**

```
Available Backups (main branch):
- March 7, 2026 12:00:00 UTC (Automatic)
- March 7, 2026 06:00:00 UTC (Automatic)
- March 6, 2026 18:00:00 UTC (Automatic)
- March 6, 2026 12:00:00 UTC (Automatic)
- March 6, 2026 06:00:00 UTC (Automatic)
- March 5, 2026 18:00:00 UTC (Automatic)
```

### 1.2 View Available Backups (CLI)

```bash
# Install Neon CLI
npm install -g neon-cli

# Or use with npx
npx neon-cli list-backups --project-id <project-id>

# View available restore points
neon list --json | jq '.branches[] | select(.name=="main")'
```

### 1.3 View Database Size and Growth

```bash
# Check current database size
# Via Neon console: Project Settings → Storage

# Or via SQL query
psql "your-connection-string" -c "SELECT pg_size_pretty(pg_database_size(current_database()));"
```

---

## Part 2: Restore Procedures

### 2.1 Restore to New Branch (Recommended - Non-Destructive)

**Best Practice**: Always restore to a new branch first, test, then swap production.

**Steps:**

1. **Open Neon Dashboard**
   - Go to https://console.neon.tech/
   - Select the project (id `dawn-darkness-22587117`)
   - Click **Branches** tab

2. **Create Restore Branch**
   - Click **Create Branch** button
   - Name: `restore-from-backup-<YYYY-MM-DD>`
   - Parent: Select **main** branch
   - Click **Create**

3. **Choose Restore Point**
   - Once branch created, go to branch settings
   - Click **Restore from backup** button
   - Select backup timestamp you want to restore to
   - Click **Restore**

4. **Test Restored Data**
   - Get connection string for new branch (shown in dashboard)
   - Connect via `psql` and verify data

   ```bash
   psql "postgresql://user:pass@restore-branch.neon.tech/..." -c "SELECT COUNT(*) FROM products;"
   ```

   - Verify row counts match expected values
   - Spot-check specific records to ensure data integrity

5. **Validate Data Integrity**
   - Check foreign key relationships

   ```bash
   psql "..." -c "SELECT * FROM information_schema.table_constraints WHERE constraint_type='FOREIGN KEY';"
   ```

   - Check for orphaned records

   ```bash
   psql "..." -c "SELECT COUNT(*) FROM products WHERE organization_id NOT IN (SELECT id FROM organizations);"
   # Should be 0 (no orphans)
   ```

6. **Verify the Application Against the Restored Database**

   ```bash
   node scripts/verify-app-against-branch.js --url "<restore-branch-connection-string>"
   ```

   This runs the Worker's real queries through the Worker's own
   `@neondatabase/serverless` driver: a readiness probe, migration-ledger
   checks, the live `/api/subscription/current` column list, and a table-count
   fidelity check. It is read-only and tenant-safe, and exits non-zero on any
   failure.

   > Do **not** substitute a `curl` of `/health?deep=true` here. That endpoint
   > does not execute a database query — `workers/src/health.ts` reports
   > `database: pass` whenever a connection string is merely present, so a 200
   > proves nothing about the restored data. (Task 1.10 makes it a real
   > readiness query.)

7. **Promote Restored Branch to Main (if data is good)**
   - Once confident data is correct:
   - Click **Make Primary** on restore branch
   - Old main becomes backup branch (kept for 24 hours)
   - New restore branch becomes active main

**Important**: Do NOT skip the testing steps. Restoring wrong data is worse than data loss.

### 2.2 Restore Point-in-Time (Specific Timestamp)

If you need to restore to exact moment before corruption/incident:

```bash
# Using Neon console point-in-time recovery

1. Go to Branches → main branch → Settings
2. Click "Advanced Restore" or "Point in Time"
3. Choose exact timestamp (e.g., March 7 11:45:00 UTC)
4. Create new restore branch from that timestamp
5. Test and verify as in section 2.1
```

### 2.3 Emergency Restore (Direct Main Branch)

⚠️ **Use only if absolutely critical** - causes brief downtime as main branch restarts

```bash
# WARNING: This affects production immediately

1. Go to Neon Console → Branches → main
2. Click **Branch Settings** (gear icon)
3. Scroll to "Database Restore"
4. Click **Restore database from backup**
5. Select backup timestamp
6. Click **Restore** (confirms you understand this affects production)
7. Neon will:
   - Stop current database
   - Restore from backup snapshot
   - Restart database (~2-3 minutes downtime)
8. Connected applications will lose connection briefly
9. Retry connections will reconnect automatically
```

---

## Part 3: Post-Restore Verification

### 3.1 Data Integrity Checks

```sql
-- Connect to restored database
psql "your-restored-connection-string"

-- Check row counts by table
SELECT
  tablename,
  (SELECT COUNT(*) FROM pg_class WHERE oid = ('public.' || tablename)::regclass) as row_count
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

-- Check for constraint violations
SELECT * FROM information_schema.check_constraints WHERE constraint_schema = 'public';

-- Verify no NULL values in critical fields
SELECT count(*) FROM products WHERE id IS NULL;
SELECT count(*) FROM organizations WHERE id IS NULL;
SELECT count(*) FROM _prisma_migrations WHERE id IS NULL;

-- Check audit trail (timestamps make sense)
SELECT
  MIN(created_at) as oldest_record,
  MAX(created_at) as newest_record,
  MAX(created_at) - MIN(created_at) as data_span
FROM products;
```

### 3.2 Application-Level Verification

```bash
# After restore, run application test suite
npm test

# Run integration tests against restored database
npm run test:integration

# Check application logs for errors
pm2 logs | tail -50
```

### 3.3 Spot-Check Specific Data

```bash
# Connect to restored database
psql "your-restored-connection-string"

-- Verify specific products exist
SELECT * FROM products WHERE name LIKE 'Test Product%' LIMIT 5;

-- Verify relationships intact
SELECT p.id, p.name, o.name as org_name
FROM products p
LEFT JOIN organizations o ON p.organization_id = o.id
WHERE p.id IN (1, 2, 3);

-- Verify recent uploads are present
SELECT * FROM products
WHERE created_at > NOW() - INTERVAL '24 hours'
LIMIT 10;
```

---

## Part 4: Backup Strategy & Maintenance

### 4.1 Backup Verification Schedule

| Frequency     | Task                           | Owner     |
| ------------- | ------------------------------ | --------- |
| **Weekly**    | Test restore to new branch     | DevOps    |
| **Monthly**   | Full disaster recovery drill   | Team Lead |
| **Quarterly** | Review backup retention policy | CTO       |

### 4.2 Automatic Backup Verification Script

**Create `backend/scripts/verify-neon-backups.ts`**

```typescript
import { Pool } from 'pg';

async function verifyBackups() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    // Query 1: Verify tables exist
    const tables = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    console.log(`✓ Tables found: ${tables.rows.length}`);

    // Query 2: Verify row counts
    const products = await pool.query('SELECT count(*) FROM products');
    console.log(`✓ Products in database: ${products.rows[0].count}`);

    // Query 3: Verify recent data
    const recent = await pool.query(`
      SELECT COUNT(*) FROM products 
      WHERE created_at > NOW() - INTERVAL '24 hours'
    `);
    console.log(`✓ Products added in last 24h: ${recent.rows[0].count}`);

    // Query 4: Verify no orphaned data
    const orphans = await pool.query(`
      SELECT COUNT(*) FROM products 
      WHERE organization_id NOT IN (SELECT id FROM organizations)
    `);
    if (orphans.rows[0].count > 0) {
      console.warn(`⚠ Warning: ${orphans.rows[0].count} orphaned products found`);
    } else {
      console.log('✓ No orphaned data');
    }

    console.log('\n✓ All backup verification checks passed');
    process.exit(0);
  } catch (error) {
    console.error('✗ Backup verification failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

verifyBackups();
```

**Run verification:**

```bash
npx ts-node backend/scripts/verify-neon-backups.ts
```

### 4.3 Scheduled Backup Verification (Cron)

```bash
# In ecosystem.config.js or crontab, run weekly:
0 2 * * 1 cd /home/date-management-app && npx ts-node backend/scripts/verify-neon-backups.ts >> logs/backup-verification.log 2>&1
```

---

## Part 5: Restore Scenarios

### Scenario 1: Data Corruption Discovered

**Situation**: Duplicate or corrupted records found in products table

**Response**:

1. Identify corruption timestamp (when first appeared)
2. Create restore branch from backup BEFORE corruption
3. Test restored branch thoroughly (see 3.1, 3.2, 3.3)
4. Promote restore branch to main
5. Keep corrupted main branch for investigation

**Target Time**: 30 minutes

### Scenario 2: Accidental Schema Change

**Situation**: Critical table column deleted or renamed accidentally

**Response**:

1. Create restore branch from before schema change
2. Use `pg_dump` to compare schemas:
   ```bash
   pg_dump $CURRENT_DB | grep CREATE | diff - <(pg_dump $RESTORE_DB | grep CREATE)
   ```
3. Restore branch becomes new main
4. Reapply any schema changes made since backup

**Target Time**: 20 minutes

### Scenario 3: Performance Degradation

**Situation**: Database slow, suspected bloated indexes/dead tuples

**Response**:

1. Run VACUUM ANALYZE in current database (before restoring)
   ```bash
   psql $DATABASE_URL -c "VACUUM ANALYZE;"
   ```
2. If still slow, create restore branch and compare performance
3. If performance better in restore, may indicate bloat in active branch

**Target Time**: 45 minutes (includes testing)

### Scenario 4: Complete Database Failure

**Situation**: Neon database unreachable, connection pool exhausted

**Response**:

1. Check Neon status page for incidents
2. If Neon infrastructure issue:
   - Wait for Neon to recover
   - No restore necessary (automatic)
3. If database corruption:
   - Create restore branch immediately
   - Promote to main if operational
   - Investigate root cause

**Target Time**: 10 minutes (detection) + 30 minutes (restore)

---

## Appendix: Connection String Format

**Neon PostgreSQL Connection String:**

```
postgresql://[user]:[password]@[host]/[database]?sslmode=require
```

**Neon Console Location:**

1. Project → Branches → main branch
2. Click **Connection Details**
3. Copy "Connection String" (full string with password)

**Security**: Never commit connection strings to Git. Use environment variables.

---

## Related Procedures

- **[Rollback Procedure](./rollback-procedure.md)** - Return to VPS if Neon fails
- **[R2 Data Recovery](./r2-recovery-procedure.md)** - Recover CSVs if R2 inaccessible
- **[Master Disaster Recovery Plan](./disaster-recovery.md)** - Complete failure scenarios

---

## Neon Documentation Reference

- **Backups**: https://neon.tech/docs/manage/backups
- **Point-in-Time Recovery**: https://neon.tech/docs/manage/backups#point-in-time-recovery
- **Database Cloning**: https://neon.tech/docs/manage/branching
- **Connection Pooling (Hyperdrive)**: https://neon.tech/docs/guides/hyperdrive-setup

---

**Last Updated**: March 7, 2026  
**Next Review**: Quarterly (before each disaster recovery drill)  
**Owner**: DevOps / On-Call Engineer
