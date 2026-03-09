# SaaS Operations Runbook

## Overview
This runbook covers common operational procedures for the SaaS multi-tenant application, including incident response, monitoring, and maintenance tasks.

## Table of Contents
1. [Health Checks](#health-checks)
2. [Common Incidents](#common-incidents)
3. [Cloudflare Workers Operations](#cloudflare-workers-operations)
4. [Monitoring & Alerts](#monitoring--alerts)
5. [Maintenance Procedures](#maintenance-procedures)
6. [Escalation Contacts](#escalation-contacts)

---

## Health Checks

### Endpoint Status
- **Health Check**: `GET /health` - Overall system health including database and tier flags
- **Liveness**: `GET /live` - Basic service availability
- **Readiness**: `GET /ready` - Database connectivity check
- **Metrics**: `GET /metrics` - System metrics (uptime, memory, CPU)
- **Database**: `GET /database-metrics` - Database performance metrics
- **Database Health**: `GET /database-health` - Database connectivity and integrity

### Healthy Response Example
```json
{
  "status": "healthy",
  "timestamp": "2026-03-02T12:00:00.000Z",
  "services": {
    "database": "healthy",
    "api": "healthy",
    "tierFeatureFlags": "configured"
  },
  "tierFlags": {
    "validatedAt": "2026-03-02T11:00:00.000Z",
    "flagCounts": {
      "starter": 10,
      "professional": 8,
      "premium": 5,
      "concierge": 3
    }
  }
}
```

---

## Common Incidents

### 1. Tier Feature Flags Not Configured (503 Error)

**Symptoms**: 
- `/health` returns 503 with `tierFeatureFlags: 'unconfigured'`
- Missing features error in response

**Resolution**:
```bash
# Run the tier flag seeding script
npm run seed:tier-flags
```

**Verification**:
```bash
curl http://localhost:3001/health | jq .
```

---

### 2. Database Connectivity Issues

**Symptoms**:
- `/health` returns 503 with `database: 'unhealthy'`
- `/database-health` shows `connected: false`

**Resolution**:
1. Check database file exists and is accessible
2. Verify database permissions
3. Restart application to re-establish connection
4. Check disk space for database file

**Verification**:
```bash
curl http://localhost:3001/database-health | jq .
```

---

### 3. High Webhook Failure Rate

**Symptoms**:
- Sentry alerts for webhook failures
- `webhookFailureRate > 5%` in metrics

**Investigation**:
```bash
# Check webhook logs
npm run diagnose:webhook

# View processed webhook events in database
SELECT event_type, COUNT(*) as count, 
       SUM(CASE WHEN processed_at IS NOT NULL THEN 1 ELSE 0 END) as processed
FROM processed_webhook_events 
WHERE created_at > datetime('now', '-1 hour')
GROUP BY event_type;
```

**Common Causes**:
- Stripe webhook secret mismatch
- Endpoint not publicly accessible
- SSL certificate issues

**Resolution**:
1. Verify `STRIPE_WEBHOOK_SECRET` environment variable
2. Check webhook endpoint is accessible: `curl -I https://your-domain.com/api/webhooks/stripe`
3. Update webhook endpoint in Stripe Dashboard if needed

---

### 4. Trial Abuse Detection

**Symptoms**:
- Multiple trial signups from same email
- Sentry alerts for `ConflictError: Trial abuse detected`

**Investigation**:
```sql
-- Check trial history for suspicious email
SELECT organization_id, email, trial_started_at, trial_end_date, status
FROM subscription_tiers st
JOIN organizations o ON st.organization_id = o.id
WHERE o.contact_email = 'suspicious@example.com'
ORDER BY trial_started_at DESC;
```

**Resolution**:
- System automatically blocks trials within 90 days
- Manual override: Update `trial_blocked_until` in organization record if needed

---

### 5. Usage Limit Violations

**Symptoms**:
- Users report unable to create products/users
- `checkUsageLimit` middleware returning 403

**Investigation**:
```sql
-- Check organization usage
SELECT * FROM organization_usage 
WHERE organization_id = 'org-uuid-here';

-- Check subscription tier
SELECT * FROM subscription_tiers 
WHERE organization_id = 'org-uuid-here' 
ORDER BY created_at DESC LIMIT 1;
```

**Resolution**:
- If legitimate overage: Guide user to upgrade
- If count incorrect: Run usage recalculation (contact dev team)

---

## Cloudflare Workers Operations

### Deployment Status

**Check Workers health:**
```bash
# Check if Workers service is running
curl https://api.yourdomain.com/health

# Expected response (Workers):
{
  "status": "healthy",
  "database": "connected",
  "timestamp": "2026-03-09T12:00:00Z"
}

# Get detailed metrics
curl https://api.yourdomain.com/metrics
```

### Workers Incident: Service Unavailable (502/503)

**Symptoms:**
- Workers returns 502 Bad Gateway
- `https://api.yourdomain.com` unreachable
- Cloudflare dashboard shows critical alerts

**Quick Resolution (< 5 minutes):**

```bash
# 1. Check Workers deployment status
wrangler deployments list --env production

# 2. View recent logs
wrangler tail --env production | head -20

# If recent deployment looks bad:

# 3. Rollback to previous version
wrangler rollback --env production

# 4. Verify health check returns 200
curl https://api.yourdomain.com/health --write-out '\n%{http_code}\n'
```

**Verification:**
- Health endpoint returns 200 OK
- Database connectivity confirmed
- No errors in Sentry from Workers

### Workers Incident: Slow Responses (p95 > 500ms)

**Symptoms:**
- API requests taking > 1 second
- Users report timeouts
- Cloudflare Analytics show high TTFB

**Investigation:**

```bash
# 1. Check database query performance
# In Neon dashboard: Monitoring → Query Performance
# Look for queries > 200ms

# 2. Check Workers logs for slow requests
wrangler tail --env production --format json | \
  jq 'select(.outcome != "ok") | .'

# 3. Monitor Hyperdrive connection pool
# Cloudflare Dashboard → Workers → Hyperdrive
# Check "Active Connections" and "Pool Utilization"
```

**Common Causes & Fixes:**

| Cause | Indicator | Fix |
|-------|-----------|-----|
| Slow DB query | Query time >200ms in Neon | Add index (see performance.md) |
| Connection pool exhausted | High pool utilization | Increase Hyperdrive pool size |
| N+1 query problem | Multiple queries for single request | Use Prisma `include` for batch |
| Large payload | Response size >1MB | Compress with gzip (already enabled) |
| Cold start | First request slow | Normal for Workers, <300ms acceptable |

**Fix Example: Add Missing Index**

```sql
-- In Neon dashboard or via psql:
CREATE INDEX CONCURRENTLY idx_products_orgid_expiry 
ON products(organization_id, expiry_date DESC);

-- Verify Workers cached config is cleared:
wrangler secret put DATABASE_URL --env production
```

### Workers Incident: Secret/Configuration Issues

**Symptoms:**
- `401 Unauthorized` on all requests
- `Error: DATABASE_URL undefined`
- JWT validation failures

**Resolution:**

```bash
# 1. Verify all required secrets are set
wrangler secret list --env production

# Expected output should include:
# DATABASE_URL
# JWT_SECRET
# NEON_CONNECTION_STRING
# R2_ACCOUNT_ID
# R2_ACCESS_KEY_ID

# 2. If secret missing, add it
wrangler secret put JWT_SECRET --env production
# (Prompts for value)

# 3. Verify secret value (will be masked)
wrangler secret list --env production

# 4. Redeploy to pick up new secret
wrangler publish --env production
```

### Workers Incident: Memory or CPU Limit Errors

**Symptoms:**
- Errors: "Worker exceeded CPU time limit"
- Response: "503 - Gateway Timeout"
- Large file uploads fail (>50MB CSV)

**Investigation:**

```bash
# 1. Check what operations are slow
wrangler tail --env production | grep -i "cpu\|timeout\|exceeded"

# 2. Profile upload performance
curl -X POST https://api.yourdomain.com/api/upload/initiate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"filename":"large.csv","fileSize":104857600}' \
  -w "Time: %{time_total}s\n"
```

**Fixes:**

```typescript
// Optimize large file processing
// Instead of processing whole file in memory:
// ❌ const data = await request.arrayBuffer(); // All in RAM
// ✅ Use streaming with csv-parse

const stream = Readable.from(await request.text());
const csvStream = stream.pipe(parse());

for await (const row of csvStream) {
  await processBatch([row]); // Process incrementally
}
```

**Workaround for MVP:**
- Current limit: 30 seconds CPU per request
- CSV processing: ~1MB per second throughput
- Max file: ~30MB safely processable
- Users uploading >30MB: Add to roadmap for Phase 20 (batch processing)

### Workers Deployment Checklist

Before pushing to production:

- [ ] Local tests pass: `npm run test:workers`
- [ ] Bundle size acceptable: `npm run build:workers` (< 500KB)
- [ ] No console.errors in Dev build
- [ ] Secrets set in Wrangler: `wrangler secret list --env production`
- [ ] Deploy to preview first: `wrangler publish --env preview`
- [ ] Test in preview: `curl https://preview.yourdomain.com/health`
- [ ] Review deployment diff: `wrangler deployments list --env production`
- [ ] Deploy to production: `wrangler publish --env production`
- [ ] Verify health endpoint: `curl https://api.yourdomain.com/health`
- [ ] Monitor Sentry for 5 minutes post-deploy

---

## Monitoring & Alerts

### Sentry Configuration
- **DSN**: Set via `SENTRY_DSN` environment variable
- **Frontend DSN**: Set via `SENTRY_FRONTEND_DSN` for client-side errors
- **Alerts**: Configured for:
  - Uncaught exceptions
  - Webhook failures > threshold
  - Database connection errors
  - High error rates

### Daily Metrics Job
- **Schedule**: Runs at 23:59 UTC daily
- **Purpose**: Stores metrics snapshot, checks alert conditions
- **Lock**: Distributed locking prevents duplicate runs
- **Logs**: Check for `[JOB] Daily metrics job` entries

### Key Metrics to Monitor

| Metric | Threshold | Alert Level |
|--------|-------------|-------------|
| Webhook Failure Rate | > 5% | High |
| Idempotency Skip Rate | > 10% | Medium |
| Trial Conversion Rate | < 10% | Medium |
| Churn Rate | > 5% | High |
| Database Response Time | > 500ms | Critical |
| Error Rate | > 1% | Critical |

### SaaS Business Metrics
- **MRR**: Monthly Recurring Revenue
- **ARPU**: Average Revenue Per User
- **Trial Conversion Rate**: % of trials converting to paid
- **Churn Rate**: % of subscriptions canceled

---

## Maintenance Procedures

### Daily
1. Review Sentry for new errors
2. Check `/health` endpoint status
3. Review daily metrics email (if configured)

### Weekly
1. Review webhook processing stats
2. Check for trial abuse patterns
3. Verify backup completion

### Monthly
1. Review tier distribution metrics
2. Analyze conversion funnel
3. Update feature flags if needed

---

## Environment Variables

### Required for Production
```bash
# Database
DATABASE_URL="file:./production.db"

# Authentication
CLERK_SECRET_KEY="sk_live_..."
CLERK_PUBLISHABLE_KEY="pk_live_..."
JWT_SECRET="your-jwt-secret"

# Stripe
STRIPE_SECRET_KEY="sk_live_..."
STRIPE_WEBHOOK_SECRET="whsec_..."

# Email (SendGrid)
SENDGRID_API_KEY="SG.xxx"
SENDGRID_FROM_EMAIL="noreply@yourdomain.com"

# Monitoring
SENTRY_DSN="https://xxx@sentry.io/yyy"

# Application
FRONTEND_URL="https://yourdomain.com"
NODE_ENV="production"
```

---

## Escalation Contacts

| Issue Type | Contact | Response Time |
|------------|---------|---------------|
| Critical Outage | DevOps Team | 15 minutes |
| Payment/Stripe Issues | Backend Team | 1 hour |
| Auth/Clerk Issues | Backend Team | 1 hour |
| Database Issues | Database Admin | 2 hours |
| Feature Questions | Product Team | 24 hours |

---

## Quick Reference Commands

```bash
# Health check
curl http://localhost:3001/health | jq .

# Database metrics
curl http://localhost:3001/database-metrics | jq .

# Run tier flag seeding
npm run seed:tier-flags

# Run schema audit
npm run audit:org-ids

# Diagnose webhook issues
npm run diagnose:webhook

# View recent logs
npm run logs | grep ERROR

# Database backup
npm run backup:database

# Check test suite
npm test -- --testPathPattern="integration"
```

---

## Related Documentation
- [Architecture Decision Records](../docs/adr/)
- [API Documentation](../docs/api/)
- [Feature Flags](../docs/feature-flags.md)
- [Stripe Integration](../docs/stripe-integration.md)

---

*Last Updated: March 2, 2026*
*Version: 1.0.0*
