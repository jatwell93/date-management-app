# Observability Patterns

**Version:** 1.0  
**Last Updated:** February 2026  
**Purpose:** Metrics collection, structured logging, and correlation patterns

---

## Overview

This project uses **correlation IDs** and **structured logging** to trace requests across:
- **Cloudflare Workers** (edge/API gateway)
- **Backend** (Express/Prisma business logic)
- **Frontend** (React client)
- **Sentry** (error tracking and performance monitoring)

---

## 1. Correlation ID System

### 1.1 How It Works

Every API request gets a unique `correlationId` that flows through the entire stack:

```
Request → Workers (generate ID) → Backend (attach to logs) → Sentry (tag transaction)
```

**Benefits:**
- Trace a single request across distributed logs
- Debug user-reported issues by timestamp → correlation ID → full stack trace
- Connect frontend errors to backend failures

### 1.2 Implementation

**Workers Middleware** ([workers/src/middleware/metrics.middleware.ts](../../workers/src/middleware/metrics.middleware.ts))
```typescript
export const createMetricsInitializer = (): Middleware => {
  return async (req, res, next) => {
    // Generate unique correlation ID
    const correlationId =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Attach to request for downstream access
    req.correlationId = correlationId;
    
    // Add response header for client correlation
    res.setHeader('X-Correlation-ID', correlationId);
    
    next();
  };
};
```

**Backend Logging** ([backend/src/services/csv-parser.service.ts](../../backend/src/services/csv-parser.service.ts))
```typescript
// Emit metrics with correlation context
Logger.info('CSV processing complete', {
  uploadKey: context.uploadKey,
  userId: context.userId,
  totalRows,
  imported,
  updated,
  skipped,
  errorCount: errors.length,
  durationMs: Date.now() - startTime,
  correlationId: req.headers['x-correlation-id'] // From Workers
});
```

**Frontend Tracking** ([frontend/src/pages/CSVUploadPage.tsx](../../frontend/src/pages/CSVUploadPage.tsx))
```typescript
// Extract correlation ID from response headers
const correlationId = response.headers.get('X-Correlation-ID');

// Log to Sentry with correlation
logUploadMetric({
  status: 'success',
  fileSize: file.size,
  durationMs: Date.now() - startTime,
  correlationId
});
```

### 1.3 Querying by Correlation ID

**Scenario:** User reports "Upload failed at 10:30am on Feb 7"

**Step 1: Find correlation ID in Sentry**
1. Go to Sentry → Performance → Transactions
2. Filter by timestamp: `2026-02-07 10:30:00` ± 5 minutes
3. Click transaction → Copy `correlationId` tag

**Step 2: Search Workers logs**
```bash
npx wrangler tail --env production --search <correlationId>
# Output: Full request/response logs with status codes, timing
```

**Step 3: Search backend logs**
```bash
grep <correlationId> backend/logs/app.log
# Output: CSV processing metrics, DB queries, errors
```

**Step 4: Reconstruct timeline**
- Workers: Request received at 10:30:12.345
- Backend: CSV processing started at 10:30:12.456
- Backend: DB query slow at 10:30:13.789 (200ms+)
- Workers: Response sent at 10:30:14.123
- Diagnosis: Slow DB query caused timeout

---

## 2. Structured Logging

### 2.1 Log Format (JSON)

All logs use consistent JSON structure for machine parsing:

```json
{
  "timestamp": "2026-02-07T10:30:45.123Z",
  "level": "info",
  "message": "Request completed",
  "environment": "production",
  "correlationId": "550e8400-e29b-41d4-a716-446655440000",
  "metadata": {
    "method": "POST",
    "endpoint": "/api/v1/uploads",
    "statusClass": "2xx",
    "routeGroup": "/api/v1/uploads",
    "responseTime": 145
  }
}
```

**Why JSON?**
- Easy parsing in log aggregators (if upgraded to paid tier)
- Consistent field names across Workers/Backend
- Sentry auto-extracts structured data

### 2.2 Log Levels

| Level | Use Case | Example |
|-------|----------|---------|
| **ERROR** | Exceptions that need immediate attention | Uncaught exception, DB connection failure |
| **WARN** | Degraded state, not critical | Storage quota >80%, slow query 150-200ms |
| **INFO** | Business metrics, audit trail | CSV upload complete, user created |
| **DEBUG** | Development troubleshooting | Variable values, conditional branches |

**Production Logger** ([backend/src/utils/logger.ts](../../backend/src/utils/logger.ts))
```typescript
import { Logger } from './utils/logger';

// ✅ Good: Structured metadata
Logger.info('Upload completed', {
  uploadKey: 'abc123',
  userId: 42,
  fileSize: 1048576,
  durationMs: 2500
});

// ❌ Avoid: String concatenation (not machine-parsable)
Logger.info(`Upload abc123 completed for user 42 in 2500ms`);
```

### 2.3 Sensitive Data Filtering

**Automatic Sanitization** ([workers/src/middleware/error-handler.middleware.ts](../../workers/src/middleware/error-handler.middleware.ts))
```typescript
const SENSITIVE_FIELDS = ['password', 'token', 'authorization', 'api_key', 'secret'];

function sanitizeForLogging(obj: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_FIELDS.some((field) => key.toLowerCase().includes(field))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeForLogging(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }
  
  return sanitized;
}

// Example: Request logging
const sanitizedHeaders = sanitizeForLogging(req.headers);
// { authorization: '[REDACTED]', 'content-type': 'application/json' }
```

**Always sanitize:**
- HTTP headers (authorization, cookies)
- Request bodies (passwords, API keys)
- Error messages (user input with PII)

---

## 3. Metrics Emission

### 3.1 Workers Metrics

**Request Metrics** ([workers/src/middleware/metrics.middleware.ts](../../workers/src/middleware/metrics.middleware.ts))
```typescript
// Metrics collected per request
interface RequestMetrics {
  timestamp: number;
  method: string;
  endpoint: string;
  statusCode: number;
  statusClass: string;      // "2xx", "4xx", "5xx" (for aggregation)
  routeGroup: string;       // "/api/v1/uploads" (reduce cardinality)
  responseTime: number;     // milliseconds
  correlationId?: string;
}

// Emit to Analytics Engine (if enabled)
export const formatMetricsForAnalytics = (metrics: RequestMetrics) => {
  return {
    blobs: [
      metrics.routeGroup,     // Index for grouping
      metrics.method,
      metrics.statusClass,
      metrics.correlationId || 'unknown'
    ],
    doubles: [metrics.responseTime],
    indexes: [metrics.routeGroup]  // Fast filtering
  };
};
```

**Why status class grouping?**
- Reduce series cardinality (3 classes vs. 50+ status codes)
- Aggregate across similar errors (all 4xx = client errors)

**Why route grouping?**
- `/api/v1/uploads/abc123` → `/api/v1/uploads` (reduce unique routes)
- Works with dynamic path parameters

### 3.2 Backend Metrics

**CSV Processing Metrics** ([backend/src/services/csv-parser.service.ts](../../backend/src/services/csv-parser.service.ts))
```typescript
// Emit after processing completes
Logger.info('CSV processing complete', {
  uploadKey: context.uploadKey,
  userId: context.userId,
  totalRows,
  imported,
  updated,
  skipped,
  errorCount: errors.length,
  durationMs: Date.now() - startTime
});
```

**Upload Metrics** ([backend/src/services/upload.service.ts](../../backend/src/services/upload.service.ts))
```typescript
// Track upload success/failure
Logger.info('Upload operation complete', {
  operation: 'completeUpload',
  uploadKey,
  userId: upload.userId,
  fileSize: upload.fileSize,
  contentType: upload.contentType,
  processingDurationMs: Date.now() - startTime,
  status: 'success'  // or 'failure'
});
```

**Querying backend metrics:**
```bash
# Find all failed uploads today
grep "Upload operation complete" backend/logs/app.log | grep '"status":"failure"'

# Calculate average CSV processing time
grep "CSV processing complete" backend/logs/app.log | jq '.durationMs' | awk '{ sum += $1; n++ } END { print sum/n }'
```

### 3.3 Frontend Metrics

**Client-Side Tracking** ([frontend/src/pages/CSVUploadPage.tsx](../../frontend/src/pages/CSVUploadPage.tsx))
```typescript
// Log upload metrics to Sentry
const logUploadMetric = (metrics: {
  status: 'success' | 'failure';
  fileSize: number;
  durationMs: number;
  method: 'direct' | 'presigned';
  errorCategory?: 'initiate_failed' | 'processing_failed' | 'upload_failed';
}) => {
  Sentry.captureMessage(`Upload ${metrics.status}`, {
    level: 'info',
    tags: {
      status: metrics.status,
      method: metrics.method,
      errorCategory: metrics.errorCategory
    },
    extra: {
      fileSize: metrics.fileSize,
      durationMs: metrics.durationMs
    }
  });
};
```

**Why categorize errors?**
- `initiate_failed`: API connection issue (check backend health)
- `processing_failed`: CSV parsing error (check file format)
- `upload_failed`: R2 storage issue (check bucket permissions)

**Retry Tracking:**
```typescript
// Log each retry attempt
console.log('[Upload Metrics] Retry attempt', {
  attempt: attemptNumber,
  errorCategory: categorizeUploadError(error),
  willRetry: attemptNumber < maxRetries
});
```

---

## 4. Metrics Aggregation Queries

### 4.1 Sentry Discover (Custom Queries)

**CSV Upload Success Rate (Last 7 Days)**
```
Query: 
  event.type:transaction
  AND transaction:/api/v1/uploads/*
  
Columns:
  - timestamp.to_day
  - count()
  - count_if(transaction.status:ok)
  
Formula: 
  (count_if(ok) / count()) * 100
  
Expected: >95% success rate
```

**Upload Retry Frequency**
```
Query:
  message:"Retry attempt"
  
Columns:
  - timestamp.to_hour
  - count()
  
Expected: <10% of total uploads
```

### 4.2 Workers Logs Queries

**Error Rate by Route (Last 3 Days)**
```bash
# Download logs via wrangler tail, then parse with jq
npx wrangler tail --env production --format json > logs.json

# Calculate error rate per route
jq -r 'select(.statusClass == "5xx") | .routeGroup' logs.json \
  | sort | uniq -c | sort -rn
```

**P95 Latency by Endpoint**
```bash
# Extract response times
jq -r 'select(.metadata.responseTime) | .metadata.responseTime' logs.json \
  | sort -n | awk '{ p95 = int(NR*0.95); if (NR == p95) print $0 }'
```

### 4.3 Backend Log Analysis

**Slow CSV Processing (>5 seconds)**
```bash
grep "CSV processing complete" backend/logs/app.log \
  | jq 'select(.durationMs > 5000) | { uploadKey, totalRows, durationMs }' \
  | jq -s 'sort_by(.durationMs) | reverse | .[:10]'
```

**Storage Quota Violations**
```bash
grep "quota" backend/logs/app.log \
  | jq 'select(.level == "WARN" or .level == "ERROR") | { timestamp, userId, message }'
```

---

## 5. Performance Profiling

### 5.1 Sentry Transaction Tracing

**Enable for all routes** (already configured in [backend/src/index.ts](../../backend/src/index.ts))
```typescript
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,  // 100% sampling (fine for current volume)
  integrations: [
    new Sentry.Integrations.Http({ tracing: true }),
    new Prisma.Integrations.Prisma({ prisma: prismaClient })
  ]
});
```

**View traces:**
1. Sentry → Performance → Transactions
2. Click transaction → View trace waterfall
3. See:
   - HTTP request → 5ms
   - Prisma query → 150ms
   - CSV processing → 2000ms
   - R2 upload → 200ms

### 5.2 Custom Performance Marks

**Add to critical code paths:**
```typescript
// Start timing
const startTime = Date.now();

// ... expensive operation ...

// Log duration
const durationMs = Date.now() - startTime;
Logger.info('Operation complete', { operation: 'csvParsing', durationMs });

// Also send to Sentry
Sentry.addBreadcrumb({
  category: 'performance',
  message: 'CSV parsing',
  level: 'info',
  data: { durationMs }
});
```

---

## 6. Debugging Workflows

### 6.1 "User reports upload failure"

**Step-by-step:**
1. Ask user for approximate timestamp
2. Search Sentry transactions by timestamp
3. Find failed transaction → Extract correlation ID
4. Search Workers logs: `npx wrangler tail --search <correlationId>`
5. Search backend logs: `grep <correlationId> backend/logs/app.log`
6. Check Sentry breadcrumbs for error category
7. Reproduce in dev with same CSV file

**Common findings:**
- 413 error → File too large (check `MAX_FILE_SIZE` in wrangler.toml)
- 500 error → CSV parsing failed (check row format)
- Timeout → Slow DB query (check Sentry performance tab)

### 6.2 "Sudden spike in errors"

**Step-by-step:**
1. Check Sentry Issues → Sort by frequency
2. Group by error message (same root cause?)
3. Check deployment timeline (recent code push?)
4. Review Cloudflare status: [cloudflarestatus.com](https://www.cloudflarestatus.com)
5. Check Neon database status: [status.neon.tech](https://status.neon.tech)
6. Roll back if deployment-related: `git revert HEAD && npm run deploy:prod`

### 6.3 "Dashboard shows high p95 latency"

**Step-by-step:**
1. Sentry → Performance → Web Vitals → Sort by slowest transactions
2. Click slowest transaction → View span breakdown
3. Identify bottleneck:
   - Database query >200ms → Add index (see [database-patterns.md](database-patterns.md))
   - R2 upload >1000ms → Check Hyperdrive connection
   - CSV parsing >5000ms → Check file size, consider chunking
4. Profile in dev with same data load
5. Implement fix + measure improvement in staging

---

## 7. Best Practices

### ✅ DO:
- Include correlation ID in all logs
- Use structured JSON (not string concatenation)
- Sanitize sensitive fields before logging
- Emit metrics at business logic boundaries (upload complete, CSV parsed)
- Add Sentry breadcrumbs for debugging context
- Group metrics by status class/route group (reduce cardinality)

### ❌ DON'T:
- Log inside tight loops (creates noise)
- Include passwords/tokens in logs (security risk)
- Use INFO level for debug noise (keep logs clean)
- Emit metrics for every individual row (aggregate instead)
- Forget to flush async loggers before Lambda timeout

---

## 8. Future Improvements

When outgrowing Free tier, consider:

**Log Aggregation:**
- **Grafana Loki**: Free, self-hosted log aggregation
- **Datadog**: Paid, advanced querying + alerting

**Real-Time Dashboards:**
- **Grafana Cloud**: Free tier, visualize Sentry + custom metrics
- **Cloudflare Workers Analytics Engine**: Paid tier for advanced queries

**Distributed Tracing:**
- **Jaeger**: Free, self-hosted, OpenTelemetry-compatible
- **Sentry Performance**: Paid tier for full tracing + profiling

---

## 9. Related Documentation

- [monitoring-alerting.md](monitoring-alerting.md) - Alert configuration and runbooks
- [database-patterns.md](database-patterns.md) - Query optimization
- [deployment.md](deployment.md) - Deploy and rollback procedures

---

**Questions?** Check correlation ID in logs → Trace request flow → Open GitHub issue with context.
