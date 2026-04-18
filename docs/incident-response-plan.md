# Incident Response Plan

## Overview

This document defines how the team responds to production incidents, including severity levels, escalation paths, and step-by-step runbooks for common failure scenarios.

**Purpose**: Minimize incident duration, reduce customer impact, and ensure coordinated response  
**Effective Date**: March 7, 2026  
**Last Review**: March 7, 2026  
**Owner**: Engineering Lead / On-Call Engineer  
**References**: Operational Runbook, Disaster Recovery Plan

---

## Part 1: Severity Levels & SLOs

### Severity Definitions

| Level  | Name     | Description                                           | Customer Impact                                         | SLA                                  |
| ------ | -------- | ----------------------------------------------------- | ------------------------------------------------------- | ------------------------------------ |
| **P1** | Critical | Service completely unavailable or data loss occurring | All customers unable to use system                      | 1 hour response, 4 hour resolution   |
| **P2** | High     | Significant degradation, core features unavailable    | Some users/features unavailable                         | 4 hour response, 8 hour resolution   |
| **P3** | Medium   | Partial feature outage, workaround exists             | Limited users affected, feature degraded but not broken | 24 hour response, 48 hour resolution |
| **P4** | Low      | Minor issue, cosmetic or edge case                    | Single user or rare scenario, cosmetic issue            | Best effort (no SLA)                 |

### Examples by Severity

**P1 (Critical)**:

- API completely down (all endpoints 500 error)
- Database unreachable (no queries work)
- All users locked out (authentication failure)
- Data corruption or loss detected
- Security breach or unauthorized access confirmed
- Revenue-impacting: payments cannot be processed

**P2 (High)**:

- CSV upload feature failing for all users
- API slow (>5s response times for >50% requests)
- Some endpoints down but core features work
- Database degraded (slow queries, connection pool exhausted)
- Limited data corruption (specific tables only)

**P3 (Medium)**:

- Single user unable to login (account-specific issue)
- Feature partially broken (e.g., sorting in dashboard works but filtering doesn't)
- Performance issue for specific operation (e.g., large CSV uploads slow)
- Minor UI bug affecting workflow
- Notification/email system down

**P4 (Low)**:

- Typo in email template
- CSS styling issue on one page
- Rare error path not covered
- Non-critical feature behaving unexpectedly
- Documentation out of date

---

## Part 2: On-Call Escalation

### On-Call Rotation

| Role                   | Contact                | Name          | Backup        |
| ---------------------- | ---------------------- | ------------- | ------------- |
| **Primary On-Call**    | Slack @on-call         | [Name]        | [Backup Name] |
| **Secondary (Backup)** | Slack @on-call-backup  | [Backup Name] | [Third Name]  |
| **Manager On-Call**    | Slack @manager-on-call | [Manager]     | [Director]    |
| **CTO (Escalation)**   | Slack @cto             | [CTO Name]    | [VP Eng]      |

### Escalation Matrix

```
P1 Incident:
- 0 min: Alert Primary On-Call (via Slack + SMS + PagerDuty)
- 5 min: If no response, alert Backup On-Call
- 10 min: If no response, alert Manager On-Call
- 15 min: If no response, alert CTO
- 20 min: Page all team members

P2 Incident:
- 0 min: Alert Primary On-Call (via Slack)
- 15 min: If no response, alert Backup
- 30 min: If no response, alert Manager

P3 Incident:
- Best effort response during business hours
- On-call handles if after hours

P4 Incident:
- Slack #incidents channel
- No escalation needed
```

### Team War Room During P1

**Meeting created automatically** upon P1 logging:

1. **Zoom Room**: https://zoom.us/my/incident-war-room (standing)
2. **Slack Channel**: #incident-P1-[YYYY-MM-DD-HHmm]
3. **Attendees**:
   - Primary On-Call (Incident Commander)
   - Backend Engineer (on-call)
   - Frontend Engineer (if relevant)
   - DevOps/Infrastructure (if relevant)
   - Manager (observer, handles external comms)

---

## Part 3: Incident Commander Responsibilities

The first engineer responding becomes **Incident Commander (IC)**.

### IC Checklist

**Immediate (0-2 minutes)**:

- [ ] Acknowledge incident in Slack (#incidents)
- [ ] Declare severity level (P1/P2/P3/P4)
- [ ] Create war room if P1 or P2
- [ ] Start logging all actions in Slack thread (timestamp each)
- [ ] Assign roles:
  - [ ] Communications Lead (updates external status page)
  - [ ] Tech Lead (drives debugging)
  - [ ] Scribe (documents timeline)

**First 5 Minutes (Diagnosis)**:

- [ ] Verify incident is real (not false alert)
  - Check `GET /health` endpoint
  - Monitor API response times
  - Look for error spikes in logs/Sentry
  - Check Cloudflare/Neon status pages for infrastructure issues
- [ ] Determine scope:
  - How many users affected?
  - Which features broken?
  - Is data at risk (P1) or just availability (P2)?
- [ ] Check recent changes (deployments, DB migrations, config changes)

**Ongoing**:

- [ ] Update war room every 15 minutes with status
- [ ] Make command decisions (revert, rollback, scale, etc.)
- [ ] Keep manager informed (for customer communication)
- [ ] Escalate if incident not progressing toward resolution

### Communication Your Decision

```
[In Slack #incidents]

🚨 P1 INCIDENT: API Down (March 7, 2:15 PM UTC)
- Status: INVESTIGATING
- Affected: All users, cannot login
- Action: Checking health endpoints and logs
- Last update: 2:15 PM
- Next update: 2:20 PM
```

---

## Part 4: Common Incident Runbooks

### Runbook 1: API Complete Outage (All Endpoints Returning 500)

**Symptom**: `GET /health`, `GET /api/products`, etc. all return HTTP 500  
**Severity**: P1  
**Start**: **\_** UTC  
**Target Resolution**: < 1 hour

**Investigation (5 minutes)**:

```bash
# 1. Check if Cloudflare Workers deployed correctly
wrangler tail  # View real-time logs

# Look for:
# - Deployment errors
# - Initialization failures
# - Database connection errors
```

**Query**:

```
[2026-03-07 14:15:23.456] Error: Database connection failed: ENOENT /var/run/postgresql/.s.PGSQL.5432
```

=> Database not running or connection string wrong

**Action (10 minutes)**:

**Option A: Database Connection Issue**

```bash
# SSH into VPS or check Neon
ssh root@vps-ip

# Verify Neon is up (check status page)
curl https://status.neon.tech

# If Neon unavailable: Activate ROLLBACK procedure
# See: docs/rollback-procedure.md

# If Neon available, check connection string:
echo $DATABASE_URL  # Verify connection string in .env

# Test connection:
npx ts-node -e "
  const { Prisma } = require('@prisma/client');
  (async () => {
    const db = await Prisma.openConnection();
    console.log('✓ Connected');
  })()
"

# If connection error: Update .env and redeploy
wrangler secret put DATABASE_URL  # Update Worker secrets
wrangler deploy
```

**Option B: Code Deployment Issue**

```bash
# Check if deployment had errors
wrangler deployments list

# If last deployment failed:
wrangler rollback --version <previous-version>

# Or manually revert:
git revert HEAD
npm run build:workers
wrangler deploy
```

**Option C: Out of Memory / CPU Limit**

```bash
# Check Cloudflare Worker usage
wrangler metrics

# If hitting limits:
# P1: Immediately scale (contact Cloudflare support)
# Temporary: Route traffic to VPS via rollback procedure
```

**Verification (5 minutes)**:

```bash
# Test health endpoint
curl https://api.yourdomain.com/health
# Should return 200 with {"status": "healthy"}

# Test product list
curl -H "Authorization: Bearer $TEST_TOKEN" https://api.yourdomain.com/api/products
# Should return 200 with product array

# Check error rate in Sentry
# Should be <0.1%

# Monitor for next 10 minutes for re-occurrence
```

**Post-Resolution**:

- [ ] If rollback activated: Plan for P1 post-mortem
- [ ] If deployment issue: Root cause analysis (code review)
- [ ] If infrastructure issue: Contact vendor (Cloudflare/Neon)

---

### Runbook 2: Neon Database Connection Pool Exhausted

**Symptom**: "Too many connections" errors, new connections time out  
**Severity**: P1  
**Start**: **\_** UTC  
**Target Resolution**: 30 minutes

**Investigation (5 minutes)**:

```sql
-- Connect to Neon and check connections
SELECT count(*) FROM pg_stat_activity;
-- Should be < 100 (typical)
-- Problem: > 150 (pool limit)

SELECT
  datname,
  usename,
  application_name,
  count(*) as connection_count
FROM pg_stat_activity
GROUP BY datname, usename, application_name
ORDER BY connection_count DESC;

-- Look for:
-- - Single application holding hundreds of connections
-- - Connections in "idle" state for hours (connection leak)
```

**Action (10 minutes)**:

**Option A: Connection Leak in Application**

```bash
# Identify leaking service
# Check in Sentry for: QueryFailedError relating to pool exhaustion

# Common causes:
# 1. Missing await on async DB query
# 2. Connection not returned to pool after error
# 3. Long-running transaction blocking others

# Fix in code:
// BEFORE (leak):
const product = db.product.findUnique({ where: { id: 1 } });
// Missing await!

// AFTER (fixed):
const product = await db.product.findUnique({ where: { id: 1 } });

# Redeploy:
wrangler deploy

# Monitor:
SELECT count(*) FROM pg_stat_activity;
# Should return to normal < 100
```

**Option B: Long Transaction Blocking Pool**

```sql
-- Find long-running transactions
SELECT
  pid,
  usename,
  query_start,
  state,
  query
FROM pg_stat_activity
WHERE query_start < NOW() - INTERVAL '5 minutes'
  AND state = 'active';

-- Kill blocking process:
SELECT pg_terminate_backend(pid) FROM pg_stat_activity
WHERE query_start < NOW() - INTERVAL '5 minutes';
```

**Option C: Hyperdrive Connection Limit**

```bash
# Check Hyperdrive configuration
# 100 connections is default limit

# Solution: Increase via Neon console or request Cloudflare increase
# Temporary: Restart Hyperdrive to reset connections

# In Neon console:
# Settings → Hyperdrive → Advanced → Connection Limit: 100 → 200
```

**Verification (5 minutes)**:

```sql
-- Verify connection count returned to normal
SELECT count(*) FROM pg_stat_activity;
-- Should be 20-50

-- Test application
curl https://api.yourdomain.com/api/products
-- Should return 200 (not timeout)
```

---

### Runbook 3: R2 Bucket Inaccessible / Files Missing

**Symptom**: File downloads fail, uploads fail with 403 Forbidden  
**Severity**: P1 (if no fallback), P2 (if VPS rollback available)  
**Start**: **\_** UTC  
**Target Resolution**: 30 min (diagnosis) + 2 hours (recovery)

**Investigation (5 minutes)**:

```bash
# 1. Check R2 status
curl -I https://youraccount.r2.cloudflarestorage.com/csv-uploads-prod/test.txt

# 2. Check Cloudflare status page
https://www.cloudflarestatus.com/

# 3. If R2 operational, check in Workers logs
wrangler tail

# Look for: "R2 bucket not found" or "403 Forbidden" or "InvalidAccessKeyId"
```

**Action (10 minutes)**:

**Option A: R2 Credentials Invalid**

```bash
# Check .env R2 credentials are correct
echo $R2_ACCESS_KEY_ID
echo $R2_SECRET_ACCESS_KEY

# If incorrect, update:
wrangler secret put R2_ACCESS_KEY_ID
# Enter correct key

wrangler secret put R2_SECRET_ACCESS_KEY
# Enter correct secret

wrangler deploy
```

**Option B: R2 Bucket Deleted or Misconfigured**

```bash
# Check if bucket exists
aws s3 ls --endpoint-url https://youraccount.r2.cloudflarestorage.com

# If bucket missing:
# 1. Activate ROLLBACK procedure to use local filesystem
# 2. In parallel: Restore R2 from backup (if versioning enabled)
# 3. Recreate bucket if necessary

# Recreate bucket:
aws s3api create-bucket \
  --bucket csv-uploads-prod \
  --endpoint-url https://youraccount.r2.cloudflarestorage.com
```

**Option C: R2 Service Outage**

```bash
# If Cloudflare R2 is down (check status page):
# 1. Activate ROLLBACK procedure
#    (Revert to VPS with local filesystem storage)
# 2. Wait for R2 recovery OR recover from backup

# Rollback: See docs/rollback-procedure.md
```

**Verification**:

```bash
# Test file upload
curl -X POST -F "file=@test.csv" https://api.yourdomain.com/api/csv-upload

# Should succeed
```

---

### Runbook 4: Data Corruption Detected

**Symptom**: Database contains invalid data, referential integrity errors  
**Severity**: P1  
**Start**: **\_** UTC  
**Target Resolution**: 1-2 hours (depending on scope)

**Investigation (5 minutes)**:

```sql
-- Check for common issues

-- 1. Orphaned records
SELECT count(*) FROM products
WHERE organization_id NOT IN (SELECT id FROM organizations);

-- 2. Duplicate primary keys
SELECT id, count(*)
FROM products
GROUP BY id
HAVING count(*) > 1;

-- 3. Null in non-nullable columns
SELECT * FROM products WHERE id IS NULL;

-- 4. Constraint violations
SELECT * FROM information_schema.check_constraints;
```

**Action (30 minutes)**:

**Identify Corruption Scope**:

- Single table or multiple?
- How many records affected?
- When did corruption start?

**Option A: Minor Corruption (< 100 rows)**

```sql
-- Fix manually if safe
UPDATE products
SET organization_id = (SELECT id FROM organizations LIMIT 1)
WHERE organization_id NOT IN (SELECT id FROM organizations);

-- Verify fix
SELECT * FROM products WHERE organization_id NOT IN (SELECT id FROM organizations);
```

**Option B: Significant Corruption (> 100 rows)**

```bash
# Activate RESTORE procedure
# See: docs/neon-backup-restore.md

# 1. Create restore branch from backup BEFORE corruption
# 2. Test restored data thoroughly
# 3. Promote restore branch to main
# 4. Investigate root cause of corruption
```

**Verification**:

```sql
-- Verify data integrity
SELECT
  tablename,
  (SELECT COUNT(*) FROM pg_class WHERE oid = ('public.' || tablename)::regclass) as row_count
FROM pg_tables
WHERE schemaname = 'public';

-- Run application health checks
curl https://api.yourdomain.com/health
# Should show "database": "healthy"
```

---

### Runbook 5: Security Breach / Unauthorized Access

**Symptom**: Suspicious account activity, unauthorized API access, data exposed  
**Severity**: P1  
**Start**: **\_** UTC  
**Target Resolution**: 1 hour (contain), 4 hours (full remediation)

**Immediate Actions (0-30 minutes)**:

```
🚨 P1 SECURITY INCIDENT ACTIVATED

Step 1: Contains Breach (IMMEDIATE)
- Revoke all API keys/tokens (except admin)
- Change all deployed secrets (DATABASE_URL, R2 credentials)
- Block/disable suspicious user accounts
- Check for active admin sessions and revoke

Step 2: Assess Damage (15 minutes)
- What data was accessed?
- Which accounts were compromised?
- How long was breach active?
- Check audit logs for who did what

Step 3: Mitigate (30 minutes)
- Deploy new API keys to Workers
- Communicate to affected users
- Reset user passwords (force re-auth)
- Enable enhanced monitoring
```

**Detailed Steps**:

```bash
# 1. REVOKE ALL CURRENT API SESSIONS
# In database:
DELETE FROM user_sessions WHERE expires_at > NOW();

# 2. CHANGE ALL SECRETS
wrangler secret put DATABASE_URL [new_connection_string]
wrangler secret put R2_ACCESS_KEY_ID [new_access_key]
wrangler secret put R2_SECRET_ACCESS_KEY [new_secret_key]
wrangler deploy

# 3. ROTATE NEON PASSWORD
# Via Neon Console: Databases → date-management-prod → Users → Reset password

# 4. ROTATE R2 API TOKEN
# Via Cloudflare Console: R2 → Manage R2 API Tokens → Delete old → Create new

# 5. BLOCK COMPROMISED ACCOUNTS
# In database:
UPDATE users SET status = 'BLOCKED', blocked_reason = 'Security incident'
WHERE id IN ('user1', 'user2', ...);

# 6. FORCE PASSWORD RESET FOR ALL ADMINS
UPDATE users SET force_password_reset = true WHERE role = 'ADMIN';

# 7. SEND SECURITY ALERT EMAIL
# Template: "We detected unauthorized access to your account..."
```

**Investigation**:

```bash
# Analyze audit logs
# What happened, when, by whom?

# Check in Sentry for:
# - Unusual API patterns
# - Multiple failed login attempts
# - Data access from unusual locations

# Review VCS logs:
git log --all --oneline | head -20
# Look for suspicious commits

# Check deployment history:
wrangler deployments list
# Look for unexpected deployments
```

**Notification to Users**:

```
Subject: [URGENT] Security Incident - Please Reset Your Password

On [DATE at TIME UTC], we detected unauthorized access to your account.

What happened:
- [Describe what data was accessed]
- [When the breach was active]
- [How we discovered it]

What you should do:
1. Reset your password immediately: [password reset link]
2. Change passwords on other services (especially email account)
3. Monitor your account for suspicious activity
4. Contact us with questions: security@yourdomain.com

What we did:
- Revoked all API tokens
- Blocked unauthorized access
- Restored from backup if data modified
- Enhanced security monitoring
```

**Post-Incident (24 hours)**:

- [ ] Post-mortem meeting scheduled
- [ ] Root cause analysis document created
- [ ] Security audit performed
- [ ] New security measures implemented
- [ ] Incident report filed with authorities (if required by law)

---

## Part 5: Incident Prevention

### Monitoring & Alerting

**Real-Time Alerts** (Sentry):

- Error rate > 1% → Slack alert
- P1 exception thrown → Slack + SMS
- Database connection failures → Slack alert

**Health Checks** (every 1 minute):

```bash
curl https://api.yourdomain.com/health
# Response time > 5s → Create P2 incident
# Response code 5xx → Create P1 incident
```

**Scheduled Checks** (hourly):

- Neon backup completed
- R2 bucket accessible
- All API endpoints responding

### Preventing Common Incidents

**Connection Pool Exhaustion**:

- Always `await` async database calls
- Use connection pooling (Hyperdrive for Neon)
- Monitor connection count in dashboard

**API Timeouts**:

- Set query timeout: 30 seconds
- Add circuit breaker pattern for external APIs
- Use request timeouts in Express

**Data Corruption**:

- Use database transactions for multi-step operations
- Add data validation layer
- Regular backup verification drills

**Security Breaches**:

- Rotate secrets quarterly
- Enable API key scoping (limit permissions)
- Enable audit logging on all user actions
- Regular security scans

---

## Part 6: Post-Incident Process

### Incident Report Template

```markdown
# Incident Report: [INCIDENT_NAME]

## Summary

- Start Time: [UTC]
- Resolution Time: [UTC]
- Duration: [mins]
- Severity: [P1/P2/P3/P4]
- User Impact: [% users affected]

## Timeline

- 14:15 - Alert triggered (API 500 errors)
- 14:18 - IC began investigation
- 14:25 - Root cause identified (DB connection pool exhausted)
- 14:32 - Fix deployed (connection limit increased)
- 14:35 - Verification complete (all endpoints healthy)

## Root Cause (5 Whys)

1. Why: Database connection pool exhausted
2. Why: Connections not returned to pool after query
3. Why: Missing `await` on async database call in recent deploy
4. Why: Code review missed async/await issue
5. Why: No automated linting rule for missing await

## Remediation

- [x] Deploy fix (commit abc123)
- [x] Review all recent code for similar issues
- [x] Add ESLint rule to catch missing await
- [ ] Add connection pool monitoring dashboard
- [ ] Training on async/await patterns (scheduled)

## Prevention

- Added automated connection pool alert (>80% utilization)
- Added ESLint rule: prefer-await-for-async-calls
- Increased connection pool size from 100 to 200

## Lessons Learned

1. Missing await can cascade into production incident
2. Need more automated linting and type checking
3. Connection pooling is critical infrastructure

## Action Items

- [ ] Implement connection pool dashboard (Owner: DevOps, Due: March 10)
- [ ] Review all async code for missing await (Owner: Backend Team, Due: March 8)
- [ ] Add performance testing to CI/CD (Owner: QA, Due: March 15)
```

### Post-Incident Meeting (within 24 hours)

**Attendees**: Engineers involved + team lead (no blame atmosphere)

**Agenda**:

1. What happened? (Timeline)
2. Why did it happen? (Root cause)
3. How do we prevent this again? (Action items)

**Notes**: Capture in shared doc, link from incident report

---

## Quick Reference: Who to Call

```
P1 Production Issue:
- Slack @on-call (immediate)
- PagerDuty page (if no response in 5 min)
- Manager (for external comms)

P2 Significant Issue:
- Slack @on-call (within 15 min response)
- Create incident ticket

P3 Partial Outage:
- Slack #incidents (threaded discussion)
- Plan fix for next business day

P4 Minor Issue:
- Slack #bug-reports (no urgency)
```

---

## Escalation Contacts

| Role                 | Name   | Phone        | Email   | GitHub   |
| -------------------- | ------ | ------------ | ------- | -------- |
| **Primary On-Call**  | [Name] | [+1-555-...] | [email] | [handle] |
| **Backup On-Call**   | [Name] | [+1-555-...] | [email] | [handle] |
| **Engineering Lead** | [Name] | [+1-555-...] | [email] | [handle] |
| **CTO**              | [Name] | [+1-555-...] | [email] | [handle] |

---

## Related Documents

- **[Operational Runbook](./operational-runbook.md)** - Day-to-day operational procedures
- **[Master Disaster Recovery Plan](./disaster-recovery.md)** - All failure scenarios
- **[Rollback Procedure](./rollback-procedure.md)** - Emergency revert to VPS
- **[Data Retention Policy](./data-retention-policy.md)** - Data handling in incidents

---

**Last Updated**: March 7, 2026  
**Next Review**: Quarterly (after each major incident or quarterly training)  
**Owner**: Engineering Lead / On-Call Engineer
