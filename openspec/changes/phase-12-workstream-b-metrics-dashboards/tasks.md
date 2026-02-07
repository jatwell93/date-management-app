# Workstream B Tasks - Metrics & Dashboards

## Task Checklist - Phase 12 Workstream B

### 12.1 - Cloudflare Analytics for Workers
- [x] Enable Cloudflare Analytics Engine in wrangler.toml (production environment)
- [x] Bind Analytics Engine dataset to Workers fetch handler
- [x] Add types for Analytics Engine to env.d.ts
- [x] Verify Analytics writes to Cloudflare dashboard (deployment ready)

### 12.2 - Custom Metrics Collection
- [x] Create metrics collection middleware (`workers/src/middleware/metrics.middleware.ts`)
- [x] Instrument CSV upload processing (capture: duration, file size, row count)
- [x] Instrument API endpoints (capture: response time, status code, endpoint)
- [x] Write metrics to Cloudflare Analytics Engine
- [x] Verify metrics appear in Cloudflare dashboard

### 12.3 - Neon Monitoring & Storage Quota Warnings

#### Part A: Founder/Operator Monitoring (No-Code via Neon Console)
**STATUS: MOVED TO PHASE 17 - Neon has no built in functionality for query monitory, must set up and then connect PgHero**
- [-] Enable Neon monitoring dashboard (Neon Console → Monitoring)
- [-] Configure alert for slow queries (threshold: >200ms)
- [-] Configure alert for connection pool saturation (threshold: >80%)
- [-] Configure alert for storage growth (threshold: >80% of quota)
- [-] Test alerts by generating load

#### Part B: User-Facing Storage Quota Warnings (Code Implementation)
Purpose: End users see warnings when approaching their storage limit, not performance metrics
- [x] Create storage quota check endpoint (`GET /api/users/:userId/storage-quota`)
  - Returns: `{ used: bytes, limit: bytes, percentageUsed: number }`
- [x] Add storage quota service (`backend/src/services/storageQuotaService.ts`)
  - Calculate bytes used by tenant
  - Compare against plan limits (free: 1GB, pro: 10GB, enterprise: unlimited)
- [x] Add storage quota warning modal to frontend
  - Show warning when usage >80%
  - Allow users to upgrade plan or request increase
  - Dismiss option (remind in 7 days)
- [x] Test with various storage levels

### 12.5 - Frontend Metrics Dashboard
**STATUS: OUT OF SCOPE** - Not needed for end users

End users need product management features, not infrastructure metrics. Operational metrics are accessible through:
- Cloudflare Analytics Dashboard (configured in Task 12.1)
- Neon Monitoring Dashboard (configured in Task 12.3)
- Sentry Dashboard (configured in Phase 12 Workstream A)

If user-facing analytics become necessary (inventory trends, usage patterns), create a separate change proposal for tenant-specific dashboards.

## Blockers & Dependencies
- None identified (parallel work possible)

## Notes
- **Founder/Operator Monitoring**: Cloudflare Analytics, Neon Monitoring, Sentry (no-code dashboards)
- **End User Monitoring**: Storage quota warnings only (when approaching limit)
- End users don't see performance metrics—they only care that the software works and data is safe
- Storage quotas tied to subscription plans (free/pro/enterprise)
- Neon monitoring dashboard is no-code (web UI only)
- Metrics are for operational monitoring (founder/operator use only)
- CSV processing instrumentation requires minimal code changes
