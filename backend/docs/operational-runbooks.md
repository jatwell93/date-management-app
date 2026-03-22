# Operational Runbooks for Date Management Application

## Overview
This document provides runbooks for common operational scenarios and procedures for the Date Management Application in production.

## Table of Contents
1. [Emergency Response Procedures](#emergency-response-procedures)
2. [Daily Operations](#daily-operations)
3. [Troubleshooting Common Issues](#troubleshooting-common-issues)
4. [Performance Monitoring](#performance-monitoring)
5. [Incident Response](#incident-response)

## Emergency Response Procedures

### Application is Unavailable
1. Check application status:
   ```bash
   pm2 status
   ```

2. If application is not running:
   ```bash
   pm2 start date-management-app
   ```

3. If application is running but not responding:
   ```bash
   # Check logs
   pm2 logs date-management-app --lines 50
   
   # Restart the application
   pm2 restart date-management-app
   ```

4. Check reverse proxy status (Nginx/Apache):
   ```bash
   sudo systemctl status nginx
   # or
   sudo systemctl status apache2
   ```

5. Check system resources:
   ```bash
   top
   df -h  # Check disk space
   free -h  # Check memory
   ```

### Database Connection Issues
1. Check database file accessibility:
   ```bash
   ls -la /path/to/database.sqlite
   ```

2. Check database file permissions:
   ```bash
   stat /path/to/database.sqlite
   ```

3. Check if database is locked:
   ```bash
   # Look for -wal and -shm files
   ls -la /path/to/database*
   # If present, the database might be locked
   ```

4. If database is locked, restart the application:
   ```bash
   pm2 restart date-management-app
   ```

### High Memory/CPU Usage
1. Check current resource usage:
   ```bash
   pm2 monit
   ```

2. Identify problematic processes:
   ```bash
   ps aux | grep node
   ```

3. Restart the application if needed:
   ```bash
   pm2 restart date-management-app
   ```

4. Consider scaling up or optimizing queries if issue persists

## Daily Operations

### Backup Verification
1. Check backup files:
   ```bash
   ls -la /path/to/backups/
   ```

2. Verify backup cron job is running:
   ```bash
   crontab -l
   ```

3. Check backup logs for any errors:
   ```bash
   tail -f /path/to/backup/logs/backup.log
   ```

### Log Monitoring
1. Check application logs:
   ```bash
   pm2 logs date-management-app --lines 100
   ```

2. Check reverse proxy logs:
   ```bash
   sudo tail -f /var/log/nginx/access.log
   sudo tail -f /var/log/nginx/error.log
   # or for Apache:
   sudo tail -f /var/log/apache2/access.log
   sudo tail -f /var/log/apache2/error.log
   ```

### Health Checks
1. Verify health endpoints:
   ```bash
   curl -i https://yourdomain.com/health
   curl -i https://yourdomain.com/live
   curl -i https://yourdomain.com/ready
   ```

2. Check for any alerts in monitoring system:
   - Check database monitoring alerts
   - Review slow query logs
   - Verify system resource utilization

## Troubleshooting Common Issues

### Slow Query Detection
1. Check database monitoring metrics:
   ```bash
   curl -i https://yourdomain.com/health/database-metrics
   ```

2. Review slow query logs in application logs:
   ```bash
   pm2 logs date-management-app | grep "Slow query detected"
   ```

3. Identify and optimize queries causing performance issues

### Authentication Issues
1. Verify JWT secret is correctly set:
   ```bash
   # Check your .env file
   cat .env | grep JWT_SECRET
   ```

2. Check if JWT tokens are properly configured:
   - Token expiration settings
   - Algorithm configuration

3. Clear and regenerate tokens if needed

### Service Worker Cache Issues
1. Clear service worker cache:
   - In browser developer tools, go to Application tab
   - Clear storage/cache for the domain
   - Or force-refresh (Ctrl+Shift+R or Cmd+Shift+R)

2. Check service worker status:
   ```bash
   curl -i https://yourdomain.com/sw.js
   ```

## Performance Monitoring

### Key Metrics to Monitor
- **API Response Times**: Monitor 95th percentile response times
- **Database Performance**: Track slow queries and connection pool metrics
- **System Resources**: CPU, memory, and disk utilization
- **Error Rates**: Monitor HTTP error rates and application errors
- **User Activity**: Track requests per minute and concurrent users

### Database-Specific Metrics
- **Connection Pool**: Monitor utilization against threshold (90%)
- **Slow Queries**: Track queries taking >100ms
- **Table Sizes**: Monitor growth, especially inventory_items table
- **Row Counts**: Track against threshold (100k rows)

### Alert Thresholds
- **High**: >90% connection pool utilization
- **High**: >100 slow queries per minute
- **Medium**: Table size >100MB
- **Medium**: Row count >100k records per table
- **High**: Disk space utilization >85%

## Incident Response

### Incident Classification
- **Critical**: Application completely unavailable
- **High**: Core functionality impaired
- **Medium**: Performance degradation
- **Low**: Minor issues with workarounds available

### Response Procedures
1. **Acknowledge**: Confirm incident received within 15 minutes
2. **Assess**: Determine scope and impact within 30 minutes
3. **Communicate**: Notify stakeholders about issue
4. **Mitigate**: Implement immediate fixes
5. **Resolve**: Apply permanent solution
6. **Review**: Conduct post-incident review

### Communication Template
```
Subject: [PRIORITY] Date Management Application Incident - [DATE]

Status: [Investigating|Identified|Mitigated|Resolved]
Priority: [Critical|High|Medium|Low]
ETA to Resolution: [Time]

Description:
[Clear description of the problem]

Impact:
[Who is affected and how]

Action Taken:
[Steps already taken]

Next Steps:
[Planned actions and timeline]

Updates will be provided every [time interval] or as status changes.
```

## Maintenance Windows
- **Weekly**: Check logs, verify backups, review performance metrics
- **Monthly**: Security updates, dependency updates, database maintenance
- **Quarterly**: System resource review, scaling assessment

## Scraping and Billing Abuse Runbook (Cloudflare + Neon)

### Purpose
Apply manual dashboard controls that reduce scraping-driven cost spikes before and during trial launch.

### Preconditions
- Production Cloudflare account access (WAF, Workers, Billing Alerts)
- Neon project owner/editor access (Billing + Connection settings)
- On-call email and SMS destinations confirmed

### Part A: Cloudflare Dashboard Setup

1. Enable Bot protection
   - Navigate to `Cloudflare Dashboard -> Security -> Bots`.
   - Enable bot protection mode applicable to your plan.
   - Record the exact setting and timestamp in incident notes.

2. Configure WAF rate limits for API endpoints
   - Navigate to `Security -> WAF -> Rate limiting rules`.
   - Add rule for `api/*` paths.
   - Start with threshold `100 requests / 60 seconds` per IP (tune during trial).
   - Action: `Block` or `Managed Challenge` depending on false-positive tolerance.

3. Configure WAF rate limit for health endpoints
   - Add rule for `health*` paths.
   - Start with threshold `30 requests / 60 seconds` per IP.
   - Action: `Block`.

4. Add custom threat-score rule
   - Navigate to `Security -> WAF -> Custom rules`.
   - Create rule where threat score exceeds baseline threshold (for example, >10).
   - Action: `JS Challenge`.

5. Enable Workers Analytics Engine dataset usage
   - Navigate to `Workers -> Analytics Engine` and ensure feature is enabled.
   - Confirm dataset binding is configured in `workers/wrangler.toml` and deployment is current.

### Part B: Cloudflare Usage/Billing Alerts (Current Plan + Fallback)

1. Navigate to `Cloudflare Dashboard -> Notifications -> Usage Based Billing`.
2. Configure all native alerts available on current plan.
   - Confirmed available baseline: R2 storage threshold notifications.
3. Configure launch baseline for available native notifications:
   - R2 storage warning at 8 GB
   - R2 storage alert at 10 GB
4. Document unsupported native thresholds (current account):
   - R2 API calls (target: warn 2M/month, alert 3M/month)
   - Workers requests (target: warn 500k/day, alert 1M/day)
   - Workers execution duration budget (target: warn 80%, alert 95%)
5. Use fallback scheduled monitor design for unsupported metrics.
   - Run cadence: hourly (monthly counters), every 5 minutes (daily counters)
   - Dedupe state: KV cooldown keys per metric/severity
   - Routing: warning to digest email, alert/critical to immediate email + SMS

### Part C: Neon Protection and Alerts

1. Navigate to `Neon Console -> Project -> Billing`.
2. Set monthly budget threshold and enable email alerting.
3. Navigate to project connection settings and review max connection posture.
4. Enable connection-pool warning alerts where available.

### Part D: Analytics Engine Anomaly Queries

Use Workers Analytics Engine SQL API against the `analytics_events` dataset.
These queries align with the current Worker metrics schema:
- `index1`: route group / endpoint
- `index2`: method
- `index3`: status class (for example `2xx`, `4xx`, `5xx`)
- `double1`: response time (ms)

1. Request volume by minute (all API)
```sql
SELECT
   intDiv(toUInt32(timestamp), 60) * 60 AS minute_bucket,
   SUM(_sample_interval) AS request_count
FROM analytics_events
WHERE timestamp >= NOW() - INTERVAL '60' MINUTE
   AND index1 LIKE '/api/%'
GROUP BY minute_bucket
ORDER BY minute_bucket DESC
LIMIT 120;
```

2. Request volume by route + method by minute
```sql
SELECT
   intDiv(toUInt32(timestamp), 60) * 60 AS minute_bucket,
   index1 AS route_group,
   index2 AS method,
   SUM(_sample_interval) AS request_count
FROM analytics_events
WHERE timestamp >= NOW() - INTERVAL '60' MINUTE
   AND index1 LIKE '/api/%'
GROUP BY minute_bucket, route_group, method
ORDER BY minute_bucket DESC, request_count DESC
LIMIT 500;
```

3. 5xx surge detection by minute
```sql
SELECT
   intDiv(toUInt32(timestamp), 60) * 60 AS minute_bucket,
   SUM(_sample_interval) AS server_error_count
FROM analytics_events
WHERE timestamp >= NOW() - INTERVAL '60' MINUTE
   AND index3 = '5xx'
GROUP BY minute_bucket
HAVING server_error_count > 50
ORDER BY minute_bucket DESC
LIMIT 120;
```

4. High latency by route over trailing 15 minutes
```sql
SELECT
   index1 AS route_group,
   SUM(_sample_interval * double1) / SUM(_sample_interval) AS avg_latency_ms,
   SUM(_sample_interval) AS request_count
FROM analytics_events
WHERE timestamp >= NOW() - INTERVAL '15' MINUTE
   AND index1 LIKE '/api/%'
GROUP BY route_group
HAVING request_count >= 30
ORDER BY avg_latency_ms DESC
LIMIT 50;
```

5. Top noisy routes (latest 10 minutes)
```sql
SELECT
   index1 AS route_group,
   SUM(_sample_interval) AS request_count
FROM analytics_events
WHERE timestamp >= NOW() - INTERVAL '10' MINUTE
   AND index1 LIKE '/api/%'
GROUP BY route_group
ORDER BY request_count DESC
LIMIT 20;
```

### Part E: Alert Thresholds (Option 2 Trial Tuning)

Start with these thresholds and tune weekly during trial:

| Metric | Source | Warning | Alert | Notes |
|---|---|---:|---:|---|
| Requests/min (all API) | Analytics Engine Query #1 | >500 | >2,000 | Matches launch checklist target |
| 5xx/min | Analytics Engine Query #3 | >25 | >100 | Indicates instability or abusive traffic |
| Average route latency (15m) | Analytics Engine Query #4 | >500ms | >1,500ms | Use only routes with `request_count >= 30` |
| DB active connections | Neon Monitoring | >50 | >100 | Compare against branch connection posture |
| Unique IPs/min | Cloudflare Security Analytics | >200 | >1,000 | Use Cloudflare dashboard/logs (not in WAE dataset schema) |

Operational note:
- Unique IP thresholds are intentionally sourced from Cloudflare Security Analytics because current `analytics_events` schema does not include client IP dimensions.
- If needed later, add anonymized IP cardinality dimensions via Worker metrics and update queries.

### Verification Checklist

1. Trigger test traffic against `/api` and verify Cloudflare rule counters increase.
2. Trigger controlled threshold breach in non-production and verify block/challenge action.
   - Use temporary low-threshold WAF rule (for example, 3 req/60s).
   - Ensure requests are blocked/challenged at edge before origin execution.
   - Capture security event evidence (rule match + action outcome).
3. Verify billing test alerts deliver to configured recipients.
4. Verify anomaly visibility in Workers Analytics dashboards.
5. Capture screenshots or audit exports for launch evidence.

### Escalation During Trial

1. If request spikes exceed expected baseline:
   - Tighten WAF thresholds incrementally.
   - Switch challenge to block for abusive signatures.
2. If spend alert triggers:
   - Confirm source paths and IP profiles.
   - Apply temporary stricter limits and notify stakeholders.
3. Document every threshold change and reason in incident log.

## Escalation Contacts
- Primary: [Contact Information]
- Secondary: [Contact Information]
- Vendor Support: [Contact Information if applicable]