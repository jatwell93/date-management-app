## Why

Workers and backend services currently lack comprehensive observability beyond basic error tracking. Without metrics and structured logging, we cannot:

- Identify performance bottlenecks before they affect users
- Track CSV processing success/failure rates and performance
- Detect upload issues proactively
- Correlate errors with specific operations

This change establishes production-grade observability infrastructure to enable proactive monitoring, faster debugging, and data-driven optimization decisions.

## What Changes

- **Enable Cloudflare Workers Analytics** for infrastructure metrics (requests, errors, latency)
- **Add custom metrics collection** for business logic tracking (CSV processing time, row counts, error rates, upload sizes, durations)
- **Implement structured JSON logging** in Workers for consistent log aggregation
- **Configure Sentry Performance alerts** for database query monitoring (>200ms threshold)
- **Configure Cloudflare Alerts** for error rate (>1%) and 95th percentile response time (>500ms)
- **Create metrics dashboard** using Cloudflare Analytics (with Grafana migration path documented)

## Capabilities

### New Capabilities

- `backend-metrics`: Backend metrics collection and reporting for CSV processing operations
- `frontend-metrics`: Frontend metrics for upload tracking and user interactions
- `monitoring-dashboard`: Unified dashboard for viewing metrics across all services

### Modified Capabilities

- `cloudflare-workers-api`: Add structured logging and custom metrics middleware
- `csv-upload-processing`: Instrument CSV parser with processing metrics and error tracking

## Impact

**Affected Systems:**

- Workers (`workers/src/index.ts`) - Add metrics middleware and structured logging
- Backend CSV Parser (`backend/src/services/csv-parser.service.ts`) - Add metric emission
- Backend Upload Service (`backend/src/services/upload.service.ts`) - Add upload metrics
- Frontend Upload Component - Add client-side metrics tracking

**New Dependencies:**

- Cloudflare Analytics API (built-in, no package needed)
- Potential: `@opentelemetry/api` (lightweight, if needed for metric format standardization)

**Documentation Updates:**

- `docs/monitoring-alerting.md` - Alert configuration and runbooks
- `docs/observability.md` - Metrics collection patterns and dashboard usage

**Configuration:**

- Cloudflare Analytics enabled via Dashboard
- Sentry Performance alerts configured for Neon database queries
- Cloudflare Alert policies created for error rate and response time
