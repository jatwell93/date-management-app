## Context

Observability today is limited to error reporting. There is no consistent metrics stream for CSV processing and upload flows, and Workers logs are not structured. We need MVP-level observability with minimal overhead and zero additional infrastructure while keeping a future path to richer dashboards (Grafana) open.

Constraints:

- Prefer built-in Cloudflare Analytics for initial dashboarding
- Use Sentry + Cloudflare for alerting (no new paid services)
- Keep Worker bundle size and runtime overhead low

## Goals / Non-Goals

**Goals:**

- Enable Cloudflare Workers Analytics for baseline infrastructure metrics
- Emit custom metrics for CSV processing and upload operations (60/40 split)
- Add structured JSON logging in Workers for consistent log correlation
- Configure Sentry Performance alerts for slow DB queries (>200ms)
- Configure Cloudflare alerts for error rate and p95 latency thresholds
- Provide a dashboard using Cloudflare Analytics with a documented Grafana migration path

**Non-Goals:**

- Full OpenTelemetry pipeline and collector setup
- Vendor-specific dashboarding beyond Cloudflare Analytics
- Long-term retention or historical analytics beyond Cloudflare defaults
- Reworking data model or core service interfaces

## Decisions

1. **Use Cloudflare Workers Analytics for the initial dashboard**
   - **Why:** Built-in, zero setup, minimal maintenance, immediate value.
   - **Alternative:** Grafana + data source (deferred for later phase to avoid infrastructure overhead).

2. **Instrument metrics at service boundaries**
   - **Why:** Metrics attached to CSV parser and upload service provide the most actionable business insights.
   - **Alternative:** Request-level metrics only (insufficient to isolate CSV vs upload pipeline performance).

3. **Structured JSON logging in Workers**
   - **Why:** Enables consistent log parsing and correlation across environments.
   - **Alternative:** Free-form logs (harder to aggregate; no guaranteed schema).

4. **Dual alerting via Sentry and Cloudflare**
   - **Why:** Sentry for error and performance visibility; Cloudflare for infrastructure latency and error-rate alerts.
   - **Alternative:** Single-provider alerting (risk of blind spots in Workers vs backend).

## Risks / Trade-offs

- **Risk:** Metrics instrumentation adds runtime overhead.
  **Mitigation:** Keep metrics lightweight and aggregate locally before emitting.

- **Risk:** Cloudflare Analytics dashboard lacks deep customization.
  **Mitigation:** Document Grafana migration path and export strategies.

- **Risk:** Alert thresholds could be noisy initially.
  **Mitigation:** Start with conservative thresholds and iterate based on baseline data.

- **Risk:** Worker JSON logs increase log volume.
  **Mitigation:** Log only key events and use log level filtering.

## Migration Plan

1. Enable Cloudflare Workers Analytics in Cloudflare Dashboard.
2. Add metrics middleware and structured logging to Workers.
3. Instrument CSV processing and upload services with custom metrics.
4. Configure Sentry Performance alert for DB queries >200ms.
5. Configure Cloudflare alerts for error rate >1% and p95 latency >500ms.
6. Verify dashboard reflects new metrics and logs.

Rollback:

- Disable alert policies.
- Revert metrics/logging middleware if needed.

## Open Questions

- Should metrics be emitted to a dedicated endpoint for future aggregation?
- Do we need a shared schema for frontend metrics events?
- What baseline thresholds should we use after initial production data is collected?
