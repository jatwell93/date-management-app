# Monitoring & Alerting Runbook

**Version:** 1.0  
**Last Updated:** February 2026  
**Stack:** Sentry (Free tier) + Cloudflare Workers Logs + Analytics Engine

---

## Overview

This project uses a **Free-tier optimized observability stack**:

- **Sentry**: Error tracking, performance monitoring, alerting (5,000 events/month)
- **Cloudflare Workers**: Structured logging with correlation IDs (3-day retention)
- **Analytics Engine**: Basic request/error counts (Free tier—limited querying)

---

## 1. Alert Configuration

### 1.1 Sentry Performance Alerts

**Database Query Duration (>200ms)**

- **Platform:** Sentry → Alerts → Performance Alerts
- **Trigger:** Database query duration exceeds 200ms
- **Notification:** Email to account owner
- **Response:**
  1. Check Sentry transaction trace
  2. Identify slow query in backend logs
  3. Review [database-patterns.md](database-patterns.md#query-optimization)
  4. Add database index if N+1 query detected

**P95 Latency Monitoring**

- **Platform:** Sentry → Performance → Trends
- **Baseline:** <500ms for CSV upload endpoints
- **Check frequency:** Weekly review
- **Response:** Profile slow endpoints, check Hyperdrive connection pooling

### 1.2 Sentry Error Alerts

**Automatic Error Tracking**

- **Platform:** Sentry → Issues
- **Coverage:** Backend, Frontend, Workers
- **Trigger:** Any uncaught exception or logged error
- **Notification:** Email (immediate), Slack integration (optional)
- **Response:**
  1. Check error stack trace and breadcrumbs
  2. Reproduce in dev environment
  3. Review correlation ID in Workers logs for full request context
  4. Fix and deploy

---

## 2. Metrics & Dashboards

### 2.1 Sentry Dashboards

**Performance Dashboard** (Default)

- Transaction throughput (requests/min)
- Apdex score (user satisfaction)
- P95/P99 latency by endpoint
- Database query duration

**Access:** [sentry.io](https://sentry.io) → Projects → date-management-app → Performance

**Business Metrics** (Custom)

- CSV upload success rate
- Upload retry frequency
- Error categorization (initiate_failed, processing_failed, upload_failed)

**Access:** Sentry → Discover → Create custom query

### 2.2 Cloudflare Workers Logs

**Real-Time Monitoring**

```bash
# Tail production logs
cd workers
npx wrangler tail --env production

# Filter for errors only
npx wrangler tail --env production --status error

# Sample output:
# {
#   "timestamp": "2026-02-07T10:30:45.123Z",
#   "level": "info",
#   "message": "Request completed",
#   "environment": "production",
#   "correlationId": "550e8400-e29b-41d4-a716-446655440000",
#   "statusClass": "2xx",
#   "routeGroup": "/api/v1/uploads",
#   "responseTime": 145
# }
```

**Dashboard Access**

1. Go to: **Cloudflare Dashboard** → **Workers & Pages** → **date-management-api-prod**
2. Click **Observability** → **Logs**
3. Filter by:
   - Status code (4xx, 5xx)
   - Time range (last 3 days—Free tier limit)
   - Correlation ID (trace full request flow)

### 2.3 Analytics Engine (Basic Metrics)

**Available on Free Tier:**

- Total request count
- Error count (status 500+)
- Basic latency histogram

**Query via Investigate Tab:**

1. Go to: **Workers Logs** → **Investigate**
2. Example query:
   ```sql
   SELECT
     blob1 AS routeGroup,
     blob2 AS statusClass,
     double1 AS responseTime,
     COUNT(*) as requests
   FROM analytics_events
   WHERE timestamp > NOW() - INTERVAL '1 hour'
   GROUP BY routeGroup, statusClass
   ```

**⚠️ Free Tier Limitations:**

- No real-time dashboards (use Workers Logs instead)
- No saved queries (Enterprise feature)
- No alerting (use Sentry instead)

---

## 3. Key Metrics Reference

### 3.1 Infrastructure Metrics

| Metric                  | Source               | Target/Threshold | Alert                  |
| ----------------------- | -------------------- | ---------------- | ---------------------- |
| Request Latency (p95)   | Sentry Performance   | <500ms           | Weekly review          |
| Error Rate              | Sentry Issues        | <1%              | Email on any error     |
| Database Query Duration | Sentry Performance   | <200ms           | Email alert configured |
| Worker CPU Time         | Cloudflare Dashboard | <10ms            | Manual check monthly   |
| Hyperdrive Connections  | Backend logs         | <50 concurrent   | Manual check           |

### 3.2 Business Metrics

| Metric                   | Source                        | Target            | Monitoring                       |
| ------------------------ | ----------------------------- | ----------------- | -------------------------------- |
| CSV Upload Success Rate  | Frontend logs + Sentry        | >95%              | Weekly Sentry Discover query     |
| Upload Retry Rate        | Frontend metrics              | <10%              | Check Sentry breadcrumbs         |
| CSV Processing Time      | Backend logs                  | <2s per 1000 rows | Check correlation ID in logs     |
| Storage Quota Violations | Backend logs (quota warnings) | 0/day             | Search logs for "quota exceeded" |

---

## 4. Incident Response Playbook

### 4.1 High Error Rate

**Symptom:** Multiple error emails from Sentry within 5 minutes

**Diagnosis:**

1. Check Sentry Issues for common error pattern
2. Review [deployment history](deployment.md#rollback-procedure) (recent deploy?)
3. Check Cloudflare Workers status: [cloudflarestatus.com](https://www.cloudflarestatus.com)
4. Tail Workers logs for correlation IDs: `npx wrangler tail --env production`

**Mitigation:**

- If deployment-related: Rollback via `git revert` + `npm run deploy:prod`
- If Cloudflare incident: Wait for resolution (check status page)
- If database-related: Check Neon console for connection issues

### 4.2 Slow Database Queries

**Symptom:** Sentry alert "DB query >200ms"

**Diagnosis:**

1. Open Sentry transaction trace
2. Identify slow query (e.g., `SELECT * FROM uploads WHERE userId = ?`)
3. Check Prisma query in backend code
4. Review database indexes: `npx prisma studio` → Inspect table

**Mitigation:**

- Add database index if missing (see [database-patterns.md](database-patterns.md#indexing-strategy))
- Review for N+1 queries (multiple queries in loop—should be batch query)
- Consider Prisma `include` optimization (reduce joins)

### 4.3 Upload Failures

**Symptom:** User reports CSV upload failure + Frontend shows retry exhausted

**Diagnosis:**

1. Get upload key from user
2. Search backend logs: `grep <uploadKey> backend/logs/app.log`
3. Find correlation ID in logs
4. Search Workers logs: `npx wrangler tail --env production --search <correlationId>`
5. Check Sentry breadcrumbs for error category (initiate_failed, processing_failed, upload_failed)

**Mitigation:**

- `initiate_failed`: Check R2 bucket permissions, verify presigned URL generation
- `processing_failed`: Check CSV format, review parser logs for row errors
- `upload_failed`: Check R2 connectivity, verify bucket exists

---

## 5. Log Correlation Guide

Our logs use **correlation IDs** to trace requests across distributed systems:

```
User clicks "Upload CSV"
  ↓
Frontend: Logs upload attempt with uploadKey=abc123
  ↓
Workers: Generates correlationId=550e8400-... (attached to request)
  ↓
Backend: Logs CSV processing with uploadKey=abc123 + correlationId=550e8400-...
  ↓
Sentry: Captures transaction with correlationId tag
```

**How to trace an issue:**

1. User reports problem with timestamp
2. Search Sentry for timestamp → Find transaction with correlationId
3. Search Workers logs: `npx wrangler tail --env production --search 550e8400`
4. Search backend logs: `grep 550e8400 backend/logs/app.log`
5. Reconstruct full request flow from logs

---

## 6. Maintenance Tasks

### Daily

- ✅ Check Sentry inbox for new errors (auto-emailed)

### Weekly

- ✅ Review Sentry Performance dashboard (p95 latency trends)
- ✅ Check CSV upload success rate in Sentry Discover
- ✅ Review Workers Logs for quota warnings: `npx wrangler tail --search "quota"`

### Monthly

- ✅ Review Cloudflare Workers analytics (request volume trends)
- ✅ Check Sentry event usage (stay under 5,000/month limit)
- ✅ Validate alert email delivery (test with `throw new Error()` in dev)

---

## 7. Free Tier Cost Monitoring

**Sentry (5,000 events/month)**

- Current usage: Check Sentry → Settings → Usage & Billing
- If nearing limit: Filter noisy errors (e.g., ignore 404s)

**Cloudflare Workers (100,000 requests/day)**

- Current usage: Cloudflare Dashboard → Workers → date-management-api-prod → Metrics
- If nearing limit: Implement rate limiting (already configured in wrangler.toml)

**Neon Database (3GB storage, 191.9 compute hours/month)**

- Current usage: [Neon Console](https://console.neon.tech) → Project → Usage
- If nearing limit: Review data retention policy, consider archiving old uploads

---

## 8. Scaling Beyond Free Tier

When you outgrow free tiers, upgrade:

1. **Sentry ($26/month)**: 50,000 events, performance monitoring, custom dashboards
2. **Cloudflare Workers ($5/month + $0.50/million requests)**: Advanced analytics, custom alerts
3. **Neon ($19/month)**: Autoscaling, point-in-time restore, unlimited branches

**Upgrade thresholds:**

- Sentry: >4,000 events/month sustained
- Cloudflare: >80,000 requests/day sustained
- Neon: >2.5GB data or >150 compute hours/month

---

## 9. Troubleshooting

### "Sentry alert not received"

- Check spam folder
- Verify email in Sentry → Settings → Account → Email
- Test alert manually: throw error in dev environment

### "Workers logs not showing up"

- Verify `observability.logs.enabled = true` in wrangler.toml
- Check 3-day retention window (Free tier)
- Redeploy: `npx wrangler deploy --env production`

### "Analytics Engine dataset empty"

- Confirm binding enabled: `wrangler tail` should show "ANALYTICS dataset connected"
- Check code emits metrics: `env.ANALYTICS.writeDataPoint()`
- Wait 5-10 minutes for data ingestion

---

## 10. Related Documentation

- [database-patterns.md](database-patterns.md) - Query optimization
- [deployment.md](deployment.md) - Deployment and rollback procedures
- [storage-patterns.md](storage-patterns.md) - R2 troubleshooting
- [observability.md](observability.md) - Metrics collection patterns

---

**Need help?** Check Sentry trace → Find correlation ID → Search Workers logs → Review backend logs → Open GitHub issue with full context.
