# Proposal: Phase 12 Workstream B - Metrics & Dashboards

## Analysis

**Current State:**
- Error monitoring deployed (Workstream A: Sentry on backend, frontend, Workers)
- Logger utility type-safe and tested
- Production secrets configured (SENTRY_DSN, database, R2, JWT)

**Affected Layers:**
- Workers (Cloudflare Analytics integration)
- Neon PostgreSQL (Monitoring dashboard, alerts)
- Frontend (Display metrics/alerts dashboard)

**Scope (Parallel Tasks):**

| Task ID | Area | Description | Type |
|---------|------|-------------|------|
| 12.1 | Workers | Enable Cloudflare Analytics for Workers | Infrastructure |
| 12.2 | Workers | Configure custom metrics (CSV processing time, upload size) | Instrumentation |
| 12.3 | Neon | Set up Neon monitoring dashboard alerts | Infrastructure |
| 12.5 | Frontend | Create dashboard for key metrics (response times, error rates, upload counts) | UI Feature |

## Reuse Strategy

- **Cloudflare Analytics**: Use existing wrangler.toml configuration; no new dependencies needed
- **Neon Monitoring**: Leverage existing Neon dashboard (no code changes required)
- **Metrics Dashboard**: Create React component using existing design system (@tanstack/react-query for data fetching)
- **Patterns**: Follow existing middleware pattern in Workers (create metrics collection middleware)

## Why This Approach

1. **No External Dependencies**: Use Cloudflare and Neon native monitoring (not additional SaaS)
2. **Low Friction**: Metrics collected automatically by Cloudflare; Neon alerts configured via dashboard
3. **Production Visibility**: Real-time dashboards + alerts enable proactive issue detection
4. **Parallel Work**: 12.1-12.3 can be done in parallel (independent systems)

## Implementation Steps

1. **12.1**: Enable Cloudflare Analytics in wrangler.toml
2. **12.2**: Add metrics collection middleware to Workers (CSV processing, upload handling)
3. **12.3**: Configure Neon dashboard alerts (slow queries, connection pool, storage)
4. **12.5**: Build React metrics dashboard component (fetch from Cloudflare + Neon APIs via backend)

## Next Steps

- Validate delta specs for each task
- Implement in parallel: 12.1-12.2 on Workers, 12.3 via Neon dashboard, 12.5 on Frontend
- Mock Cloudflare API responses for local development
- Add metrics endpoints to backend API for dashboard data fetching
