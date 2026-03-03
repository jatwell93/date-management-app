# Proposal: Secure Billing Protection from Scraping Attacks

## Why

**Current State:** The architecture uses Cloudflare Workers as the API gateway with Neon serverless Postgres (via Cloudflare Hyperdrive) as the database. A security assessment revealed that the current rate limiter is in-memory only (per-worker instance), making it trivially bypassable by distributed botnets. No Cloudflare-managed rate limiting or budget alerts are currently configured.

**Opportunity:** Implement defense-in-depth protections against scraping attacks that could cause unexpected billing spikes. The risk ranges from $50/day (low attack) to $10,000+/day (severe attack) in unexpected charges.

**Why Now:** Before launching to production, this security hardening must be in place to prevent bill shock from automated attacks.

## What Changes

We will implement:
- **Cloudflare Edge Protection:** Bot Fight Mode, WAF rate limiting rules, IP reputation blocking
- **Distributed Rate Limiting:** Migrate from in-memory to KV-backed rate limiting in Workers
- **Database Connection Protection:** Add connection pooling limits and query complexity controls
- **Budget Alerts:** Configure Cloudflare and Neon spending alerts
- **Monitoring & Detection:** Anomaly detection thresholds and alerting rules

**Outcome:** Production-ready security configuration that prevents billing attacks while allowing legitimate traffic.

## Capabilities

### New Capabilities

- `cloudflare-rate-limiting`: Cloudflare-managed distributed rate limiting that cannot be bypassed by IP rotation
- `bot-detection`: Cloudflare Bot Fight Mode + Turnstile challenges for suspicious traffic
- `kv-rate-limiter`: KV-backed rate limiter with distributed state across all Workers instances
- `connection-pool-limits`: Middleware to limit concurrent database connections
- `billing-alerts`: Budget alerts at $10/day, $50/week, $200/month thresholds
- `anomaly-detection`: Analytics Engine queries to detect scraping patterns

### Modified Capabilities

- `rate-limit-middleware`: Currently in-memory; will migrate to KV-backed storage
- `health-endpoints`: Currently unprotected; will add rate limiting
- `upload-endpoints`: Currently no query limits; will add complexity controls

## Impact

**Code Areas:**
- `workers/src/middleware/rate-limit.middleware.ts`: Migrate to KV storage
- `workers/wrangler.toml`: Add KV namespace binding, update rate limit config
- `workers/src/middleware/connection-limiter.middleware.ts`: New middleware
- Cloudflare Dashboard: WAF rules, Bot Fight Mode, budget alerts

**External Dependencies:**
- Cloudflare KV namespace for rate limiting
- Cloudflare Analytics Engine (enabled in dashboard)
- Neon project budget alerts

**Cost Impact:**
- Cloudflare KV: ~$0.50/10M writes (minimal)
- Cloudflare WAF: Included in Pro plan or free
- Analytics Engine: Free tier available

## Analysis

**Current:** `workers/src/middleware/rate-limit.middleware.ts:20`
- Uses in-memory Map for rate limit storage
- Each Worker instance has separate state
- Resets on deployment
- Easily bypassed by distributed attacks

**Affected:** `workers/wrangler.toml:33-35`, `workers/src/middleware/rate-limit.middleware.ts`, Neon console

**Pattern:** Extends existing rate limiting middleware with distributed KV storage

## Reuse Strategy

- Reuse existing rate limiter interface and headers
- Follow Cloudflare best practices for KV rate limiting
- Extend existing monitoring patterns from observability.md

## Implementation Steps

1. Create KV namespace for rate limiting
2. Migrate rate limiter to KV-backed storage
3. Configure Cloudflare WAF rate limiting rules
4. Enable Bot Fight Mode
5. Add connection limiter middleware
6. Configure budget alerts in Cloudflare
7. Configure budget alerts in Neon
8. Add anomaly detection queries
9. Document thresholds and runbook
10. Validate all protections work correctly
