## 1. Cloudflare Analytics Enablement

- [x] 1.1 Enable Workers Analytics in Cloudflare dashboard (prod + preview)
- [x] 1.2 Validate baseline metrics (requests, errors, latency) appear in dashboard

## 2. Workers Metrics + Structured Logging

- [x] 2.1 Add structured JSON logger for Workers with correlation id
- [x] 2.2 Emit request metrics (status class + latency) in Workers middleware
- [x] 2.3 Ensure sensitive fields are filtered from logs

## 3. Backend Metrics Instrumentation

- [x] 3.1 Add CSV processing metrics emission in `csv-parser.service.ts`
- [x] 3.2 Add upload metrics emission in `upload.service.ts`
- [x] 3.3 Correlate backend metrics with upload/session identifiers

## 4. Frontend Metrics Instrumentation

- [x] 4.1 Add client upload metrics (size, duration, result, method)
- [x] 4.2 Track upload retries with error category and outcome

## 5. Alerts Configuration

- [x] 5.1 Configure Sentry Performance alert for DB queries >200ms
- [x] 5.2 Configure Sentry error alerts (Free tier: no Cloudflare error rate alerts)
- [x] 5.3 Use Sentry Performance monitoring for p95 latency (Free tier alternative)

## 6. Dashboard + Documentation

- [x] 6.1 Use Sentry dashboards + Workers Logs for observability (Free tier: no advanced Cloudflare Analytics)
- [x] 6.2 Document metrics and alerting runbook in `docs/monitoring-alerting.md`
- [x] 6.3 Document metrics collection patterns in `docs/observability.md`
