# SaaS Operations Runbook

## Overview
This runbook covers common operational procedures for the SaaS multi-tenant application, including incident response, monitoring, and maintenance tasks.

## Table of Contents
1. [Health Checks](#health-checks)
2. [Common Incidents](#common-incidents)
3. [Monitoring & Alerts](#monitoring--alerts)
4. [Maintenance Procedures](#maintenance-procedures)
5. [Escalation Contacts](#escalation-contacts)

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
