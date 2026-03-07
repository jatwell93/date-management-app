# Status Page Setup

## Overview

This document defines the production status page setup for service availability tracking at `status.yourdomain.com`.

## Status Page Options

### Option A: Cloudflare Pages (current project path)

The project includes a static status page implementation in [status-page/index.html](../status-page/index.html).

Deployment flow:

1. Create a Cloudflare Pages project using the `status-page/` directory as the root.
2. Assign custom domain `status.yourdomain.com`.
3. Configure HTTPS and force-redirect HTTP to HTTPS.
4. Set cache headers to short TTL (`max-age=60`) so status updates appear quickly.

### Option B: Atlassian Statuspage.io

Use Statuspage.io when you need:

- Built-in subscriber notifications
- Component-level uptime history
- Incident timeline automation
- Enterprise audit logging

## Required Content

The status page must always show the following sections.

### 1. Current System Status

- Overall status: `Operational`, `Degraded`, or `Outage`
- Components:
  - Workers API
  - R2 Storage
  - Database
- Last refresh timestamp

### 2. Planned Maintenance

- Scheduled start time in UTC
- Maintenance summary
- Expected impact (none/degraded/outage)
- Expected end time

### 3. Incident History

For each incident, track:

- Incident start and resolution time (UTC)
- Severity (`P1`, `P2`, `P3`, `P4`)
- Affected components
- Customer-visible impact summary
- Resolution summary

Retention recommendation:

- Public history: at least 90 days
- Internal detailed timeline: at least 1 year

## Health Endpoint Integration

Preferred endpoint:

- `GET /health?deep=true`

Expected shape:

```json
{
  "status": "healthy",
  "checks": {
    "workers": { "status": "pass", "responseTime": 42 },
    "r2": { "status": "pass", "responseTime": 55 },
    "database": { "status": "pass", "responseTime": 34 }
  }
}
```

Refresh policy:

- Poll every 60 seconds
- On fetch failure, mark overall status `UNREACHABLE`

## Operational Workflow

### Planned Maintenance Process

1. Add maintenance notice at least 24 hours before start.
2. Update status to `Degraded` when maintenance begins (if user impact exists).
3. Clear banner and post completion message after maintenance.

### Incident Process

1. Create incident note within 5 minutes of confirmation.
2. Update every 15 minutes for `P1` or `P2` incidents.
3. Post final resolution note with UTC timestamps.
4. Move incident to history after resolution.

## Ownership

- Primary owner: On-call engineer
- Secondary owner: Engineering lead
- Escalation reference: [docs/incident-response-plan.md](incident-response-plan.md)

## Validation Checklist

- [ ] Public URL responds over HTTPS
- [ ] Overall status visible without login
- [ ] Planned maintenance section present
- [ ] Incident history section present
- [ ] Health polling runs every 60 seconds
- [ ] Last-updated timestamp visible
