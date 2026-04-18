# Monitoring & Alerting Guide

**Last Updated:** March 16, 2026  
**Status:** Production Ready

## Overview

Comprehensive monitoring and alerting strategy for production deployment. This guide covers:

- What to monitor
- How to set up alerts
- Dashboards and visualization
- On-call procedures
- Escalation paths

---

## 1. Monitoring Architecture

### Components

```
┌─────────────────────────────────────────────────────┐
│                   User Application                   │
└─────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
    ┌─────────┐         ┌──────────┐       ┌──────────┐
    │ Backend │         │ Workers  │       │ Frontend │
    └─────────┘         └──────────┘       └──────────┘
         │                    │                    │
         │ logs/errors        │ logs              │ errors
         │                    │                   │
         ▼                    ▼                   ▼
    ┌───────────────────────────────────────────────────┐
    │            Sentry (Error Tracking)                │
    └───────────────────────────────────────────────────┘
         │
         │ dashboards, alerts
         ▼
    ┌───────────────────────────────────────────────────┐
    │         PagerDuty (Incident Management)           │
    └───────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────┐
│            Database Monitoring (Neon)                 │
│  - Query performance                                  │
│  - Connection pool status                             │
│  - Disk usage                                         │
└───────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────┐
│           Infrastructure Monitoring                   │
│  - Cloudflare Workers performance                     │
│  - R2 bucket operations                               │
│  - API response times                                 │
└───────────────────────────────────────────────────────┘
```

---

## 2. Key Metrics to Monitor

### Backend Application

#### Response Times

- **Metric**: P50 / P95 / P99 response latency
- **Target**: P95 < 500ms for dashboard, <1s for CSV endpoints
- **Alert Threshold**: P95 > 1000ms for 5+ minutes
- **Tool**: Sentry Performance Monitoring

#### Error Rate

- **Metric**: 5xx errors per minute
- **Target**: <5 errors/min in normal operation
- **Alert Threshold**: >10 errors/min
- **Tool**: Sentry, CloudWatch

#### Database Queries

- **Metric**: Slow query count (queries > 1000ms)
- **Target**: <5 slow queries in 1 hour
- **Alert Threshold**: >20 slow queries in 1 hour
- **Tool**: Neon dashboard, pg_stat_statements

#### CSV Processing

- **Metric**: Processing time, rows processed/sec
- **Target**: 1000-10000 rows/sec
- **Alert Threshold**: <100 rows/sec (likely bottleneck)

### Workers (Serverless)

#### Request Count

- **Metric**: Requests per minute
- **Target**: Variable based on traffic
- **Alert Threshold**: Anomaly detection (>2x baseline)

#### Cold Start Times

- **Metric**: Time to first response after deploy
- **Target**: <100ms
- **Alert Threshold**: >500ms indicates memory issues

#### CPU & Memory

- **Metric**: CPU time per request, memory usage
- **Target**: <50ms CPU/request, <50MB memory
- **Alert Threshold**: >200ms CPU or >256MB memory

#### Database Connection Pool

- **Metric**: Active connections, pool wait time
- **Target**: <50% pool utilization during normal traffic
- **Alert Threshold**: >90% utilization or waits >100ms

### Database (Neon)

#### Connection Status

- **Metric**: Active connections in pool
- **Target**: <50% of max pool size
- **Alert Threshold**: >80% of pool connections used

#### Disk Usage

- **Metric**: Database size, growth rate
- **Target**: Monitor for unusual growth
- **Alert Threshold**: >95% of allocated space

#### Query Performance

- **Metric**: Max query execution time
- **Target**: <1s for 99th percentile
- **Alert Threshold**: 95th percentile > 2s

#### Replication Lag

- **Metric**: Standby replication delay (if applicable)
- **Target**: <100ms
- **Alert Threshold**: >1s lag

### Storage (Cloudflare R2)

#### Upload Success Rate

- **Metric**: Successful presigned uploads / total
- **Target**: >99.5%
- **Alert Threshold**: <99%

#### Request Latency

- **Metric**: Upload/download latency p95
- **Target**: <500ms
- **Alert Threshold**: >2s

#### Quota Usage

- **Metric**: Bytes stored, operations count
- **Target**: Monitor growth
- **Alert Threshold**: >80% of quota

---

## 3. Alerting Rules

### Critical Alerts (Notify on-call immediately)

```yaml
- name: 'Error Rate High'
  condition: '5xx_errors_per_minute > 20'
  duration: '2 minutes'
  severity: 'CRITICAL'
  action: 'PagerDuty -> Immediate notification'

- name: 'Database Down'
  condition: 'neon_connection_failed'
  duration: '30 seconds'
  severity: 'CRITICAL'
  action: 'PagerDuty -> Page oncall, Slack #oncall'

- name: 'Workers Deployment Failed'
  condition: 'workers_deploy_error'
  duration: 'N/A'
  severity: 'CRITICAL'
  action: 'Email + Slack notification'

- name: 'Presigned URL Expiry Issue'
  condition: 'presigned_url_expired_during_upload'
  duration: '5 minutes'
  severity: 'CRITICAL'
  action: 'PagerDuty + Slack'

- name: 'CSV Parser Memory Leak'
  condition: 'csv_parser_memory > 500MB'
  duration: '5 minutes'
  severity: 'CRITICAL'
  action: 'PagerDuty -> Memory investigation'

- name: 'Payment Processing Failure'
  condition: 'stripe_webhook_failures > 10'
  duration: '10 minutes'
  severity: 'CRITICAL'
  action: 'PagerDuty + CFO notification'
```

### High Priority Alerts (Page during business hours)

```yaml
- name: 'High Response Time'
  condition: 'p95_latency_ms > 1000'
  duration: '5 minutes'
  severity: 'HIGH'
  action: 'PagerDuty if during business hours, else Slack'

- name: 'Slow Query Spike'
  condition: 'slow_queries_per_hour > 20'
  duration: '10 minutes'
  severity: 'HIGH'
  action: 'Auto-investigate with database query analyzer'

- name: 'Database Connection Pool Warning'
  condition: 'pool_utilization > 80%'
  duration: '5 minutes'
  severity: 'HIGH'
  action: 'Slack notification, prepare to scale'

- name: 'CSV Upload Failures'
  condition: 'csv_upload_error_rate > 5%'
  duration: '15 minutes'
  severity: 'HIGH'
  action: 'Slack + review R2 connectivity'

- name: 'Presigned URL Rate Limit Triggered'
  condition: 'presigned_url_rate_limit_exceeded'
  duration: 'N/A'
  severity: 'MEDIUM'
  action: 'Log and monitor, possible bot activity'
```

### Medium Priority Alerts (Slack notification)

```yaml
- name: 'Disk Usage Growing Rapidly'
  condition: 'database_size_growth > 10GB per hour'
  duration: '1 hour'
  severity: 'MEDIUM'
  action: 'Slack notification, investigate bulk loads'

- name: 'Backup Failure'
  condition: 'neon_backup_failed'
  duration: 'N/A'
  severity: 'MEDIUM'
  action: 'Slack #ops, retry manually if needed'

- name: 'Certificate Expiration Warning'
  condition: 'ssl_cert_expires_in < 30 days'
  duration: 'N/A'
  severity: 'LOW'
  action: 'Email reminder to renew'
```

---

## 4. Setting Up Alerts

### Sentry Alerts

**Configuration Path**: Sentry → Project Settings → Alerts

#### Issue Alert: High Error Rate

1. **Name**: "5xx Error Rate Spike"
2. **Conditions**:
   - When "error.level" is "error"
   - AND "http.status_code" matches "5\d\d"
   - Alert you in "PagerDuty" integration when count > 20 in 5 minutes
3. **Actions**: Send to PagerDuty (critical), #incidents Slack channel

#### Performance Alert: Slow Transactions

1. **Name**: "Slow API Response"
2. **Conditions**:
   - When transaction duration is >= 1000ms
   - AND transaction name starts with "/api/"
   - For the last 5 minutes
   - If there are more than 10 occurrences
3. **Actions**: Send to #performance Slack channel

### Neon Alerts

**Configuration Path**: Neon Dashboard → Project → Monitoring

#### Query Performance

```sql
-- Query to find slow queries (Neon pg_stat_statements)
SELECT query, mean_time, max_time, calls
FROM pg_stat_statements
WHERE mean_time > 1000 OR max_time > 2000
ORDER BY max_time DESC
LIMIT 20;
```

**Alert Setup**:

- Slow query detection: Built-in Neon feature
- Threshold: >1000ms mean execution time
- Notification: Email to #ops

#### Connection Pool

**Alert Setup**:

- In Neon compute settings
- Alert on connection count > 80% of max
- Notification: Email alert

### Cloudflare Alert Policy

**Configuration Path**: Cloudflare Dashboard → Notifications → Alerting Rules

#### Workers Deployment

```
Trigger: Every deployment
Condition: Failure detected
Notification: Email
```

#### R2 Request Failures

```
Trigger: 4xx/5xx responses from R2
Condition: >5 per minute
Notification: Slack via webhook
```

---

## 5. Dashboards

### Main Operations Dashboard (Grafana/Datadog Alternative)

**Key Panels**:

1. **System Health**
   - Workers status
   - Database connection pool
   - R2 availability
   - Stripe API status

2. **API Performance**
   - Request rate (requests/sec)
   - Error rate by endpoint
   - P50, P95, P99 latencies
   - Response size distribution

3. **Database**
   - Query count per second
   - Slow query count
   - Connection pool utilization
   - Disk usage trend

4. **User Activity**
   - Active users
   - CSV uploads in progress
   - Failed uploads (last 24h)
   - Revenue (if tracked)

### Per-Service Dashboards

#### Backend Dashboard

- Request count by endpoint
- Error rate by status code
- CPU/Memory utilization
- Database query performance

#### Workers Dashboard

- Requests per region
- CPU time per request
- Cold start count
- Memory usage

#### Frontend Dashboard

- JavaScript errors
- Page load times
- User interactions
- Crash rate

---

## 6. Logging

### Log Levels

| Level | When                          | Example                                       |
| ----- | ----------------------------- | --------------------------------------------- |
| ERROR | Failures needing intervention | "CSV parse failed: invalid encoding"          |
| WARN  | Degraded but functioning      | "Response time > 1s", "Retry attempt 2/3"     |
| INFO  | Important events              | "CSV upload started", "User signup completed" |
| DEBUG | Development/troubleshooting   | "Query execution: 234ms", "Cache hit"         |

### Log Aggregation

**Central Location**: CloudWatch (for AWS) or Loki (self-hosted)

**Backend Logs**:

```
Format: [timestamp] [level] [service] message
Example: 2026-03-16T10:30:45Z ERROR csv-processor Parse error at row 1500
```

**Workers Logs**:

```
// Access via Cloudflare dashboard → Workers → Tail

[TIMESTAMP] [Level] [Request ID] Message
```

**Database Logs**:

```
// Neon: Query logs visible in dashboard
SELECT * FROM pg_log WHERE level = 'error'
```

### Log Retention

- **Backend/Workers**: 30 days
- **Database queries**: 7 days (slow queries archived)
- **Error tracking**: 90 days in Sentry
- **Compliance logs**: 1 year (for audit trail)

---

## 7. On-Call Rotation & Escalation

### On-Call Schedule

**Team Members**: [List names]

**Rotation**:

- Weekly rotation (Monday 9am → next Monday 9am)
- Primary on-call: Responds to alerts
- Secondary on-call: Backup for primary unavailable

**Access Requirements**:

- PagerDuty account with incident response
- Neon project admin access
- Cloudflare Workers deployment access
- Stripe dashboard access
- CloudWatch/Sentry access via VPN

### Incident Response Flow

```
Alert triggered
       ↓
PagerDuty notifies on-call
       ↓
On-call acknowledges in <5 min
       ↓
Investigate root cause
  ├─ Check Sentry for error context
  ├─ Review recent deployments
  ├─ Check database status
  └─ Review CloudWatch logs
       ↓
Decide: Fix or Rollback?
  ├─ Fix: Deploy patch, test in staging first
  └─ Rollback: Revert last deployment
       ↓
Test in production
       ↓
Create incident report (postmortem)
       ↓
Update runbooks with learnings
```

### Escalation Path

```
Level 1 (On-Call Engineer):
  - Responds to alerts
  - Follows runbooks
  - Escalates if unresolved in 15 min

Level 2 (Team Lead):
  - Called for P1/P2 incidents
  - Authorization for risky changes
  - Communication with stakeholders

Level 3 (Director/VP):
  - Called for P1 incidents lasting >30 min
  - Customer communication decisions
  - Emergency vendor escalation
```

### Contact Information

| Role               | Name       | Phone      | Email                  | Backup     |
| ------------------ | ---------- | ---------- | ---------------------- | ---------- |
| On-Call Primary    | **\_\_\_** | **\_\_\_** | **\_\_\_**             | **\_\_\_** |
| On-Call Secondary  | **\_\_\_** | **\_\_\_** | **\_\_\_**             | **\_\_\_** |
| Team Lead          | **\_\_\_** | **\_\_\_** | **\_\_\_**             | **\_\_\_** |
| VP Engineering     | **\_\_\_** | **\_\_\_** | **\_\_\_**             | **\_\_\_** |
| Neon Support       | -          | -          | support@neon.tech      | 24/7       |
| Stripe Support     | -          | -          | support@stripe.com     | 24/7       |
| Cloudflare Support | -          | -          | support@cloudflare.com | 24/7       |

---

## 8. Runbooks

### Runbook: High 5xx Error Rate

**Diagnosis**:

1. Check Sentry dashboard for error patterns
2. Identify if specific endpoint affected
3. Check recent deployments

**Quick Fixes** (in order):

1. Check database connection: `SELECT NOW()` in Neon
2. Check Workers deployment status
3. Check R2 bucket availability
4. Restart connection pool if hanging

**If Unresolved**:

- Rollback last Workers deployment
- Rollback last backend deployment
- Scale up database compute

### Runbook: Database Connection Pool Exhausted

**Symptoms**: "Too many connections" errors, request timeouts

**Steps**:

1. Check pool utilization: Neon dashboard → Monitoring
2. Kill idle connections:
   ```sql
   SELECT pg_terminate_backend(pid)
   FROM pg_stat_activity
   WHERE state = 'idle' AND query_start < now() - interval '10 min';
   ```
3. Increase pool size if legitimate load
4. Check for connection leaks in code

**Prevention**:

- Review CSV processor for proper cleanup (finally blocks)
- Verify retry logic closes connections
- Monitor for unhandled rejections

### Runbook: CSV Upload Failures

**Check**:

1. Is R2 bucket accessible? (Cloudflare dashboard)
2. Are presigned URLs expiring too fast?
   - Check: `PRESIGNED_URL_EXPIRY_SECONDS` env var
   - Should be 21600+ (6 hours)
3. Is disk quota exceeded? (Check Neon dashboard)
4. Is CSV parser hanging? (Check memory usage)

**Fix**:

1. Increase presigned URL expiry
2. Clear old files from R2 (if quota full)
3. Restart CSV processor if hanging
4. Check file encoding (UTF-8 required)

---

## 9. Regular Maintenance Tasks

### Daily (Automated)

- [ ] Database backup verification
- [ ] Error rate trend analysis
- [ ] SSL certificate status check

### Weekly (Manual)

- [ ] Review slow query logs
- [ ] Check disk usage growth
- [ ] Review security logs for access anomalies
- [ ] On-call handoff meeting

### Monthly (Manual)

- [ ] Capacity planning review
- [ ] Alert threshold tuning
- [ ] Document any configuration changes
- [ ] Security audit of access logs
- [ ] Cost analysis (Stripe, Neon, Cloudflare)

### Quarterly (Manual)

- [ ] Disaster recovery drill
- [ ] Team training on runbooks
- [ ] Vendor SLA review (Neon, Stripe, Cloudflare)
- [ ] Security penetration test

---

## 10. Useful Commands & Queries

### Database Health Check

```sql
-- Connection pool status
SELECT count(*), state FROM pg_stat_activity GROUP BY state;

-- Slow queries
SELECT query, calls, mean_time, max_time
FROM pg_stat_statements
WHERE mean_time > 1000
ORDER BY max_time DESC LIMIT 10;

-- Database size
SELECT pg_size_pretty(pg_database_size(current_database()));

-- Active long transactions
SELECT pid, usename, state, query_start, state_change
FROM pg_stat_activity
WHERE state != 'idle'
AND query_start < now() - interval '5 min';
```

### Workers Debugging

```bash
# Tail live logs
wrangler tail --project-name=date-management-app

# Check deployment status
wrangler rollback --dry-run

# View environment variables
wrangler secret list
```

### Performance Profiling

```javascript
// In Workers handler
const start = Date.now();
// ... operation ...
console.log(`Operation took ${Date.now() - start}ms`);
```

---

## Conclusion

This monitoring and alerting strategy ensures production application health and enables rapid incident response. Customize thresholds based on your actual traffic patterns and team capacity.

**Review Schedule**: Quarterly  
**Last Reviewed**: March 16, 2026  
**Next Review**: June 16, 2026
