# Proposal: Secure Billing and Session Protection from Scraping Attacks

## Why

**Current State:** The architecture uses Cloudflare Workers as the API gateway with Neon serverless Postgres (via Cloudflare Hyperdrive) as the database. A security assessment revealed that the current rate limiter is in-memory only (per-worker instance), making it trivially bypassable by distributed botnets. No Cloudflare-managed rate limiting or budget alerts are currently configured. Separately, frontend auth has been improved from persistent browser token storage to in-memory token handling, but browser-session transport is not yet at `httpOnly` cookie isolation.

**Opportunity:** Implement defense-in-depth protections against scraping attacks that could cause unexpected billing spikes, while defining a clear path for stronger browser session transport security.

**Why Now:** Before and during trial launch, this security hardening must be in place to prevent bill shock from automated attacks and reduce auth/session residual risk in a phased way.

## What Changes

We will implement:

- **Cloudflare Edge Protection:** Bot Fight Mode, WAF rate limiting rules, IP reputation blocking
- **Distributed Rate Limiting:** Migrate from in-memory to KV-backed rate limiting in Workers
- **Database Connection Protection:** Add connection pooling limits and query complexity controls
- **Budget Alerts:** Configure Cloudflare and Neon spending alerts
- **Monitoring & Detection:** Anomaly detection thresholds and alerting rules
- **Session Transport Hardening Plan:** Add post-trial migration path from JS-managed bearer transport to cookie-based `httpOnly` transport

**Outcome:** A single combined security program with clear sequencing:

1. Pre-trial controls for immediate billing-abuse protection
2. In-trial tuning and DB cost protection
3. Post-trial session transport architecture hardening

## Capabilities

### New Capabilities

- `cloudflare-rate-limiting`: Cloudflare-managed distributed rate limiting that cannot be bypassed by IP rotation
- `bot-detection`: Cloudflare Bot Fight Mode + Turnstile challenges for suspicious traffic
- `kv-rate-limiter`: KV-backed rate limiter with distributed state across all Workers instances
- `connection-pool-limits`: Middleware to limit concurrent database connections
- `billing-alerts`: Budget alerts at $10/day, $50/week, $200/month thresholds
- `anomaly-detection`: Analytics Engine queries to detect scraping patterns
- `session-transport-migration`: planned migration to `httpOnly` cookie transport with CSRF protection

### Modified Capabilities

- `rate-limit-middleware`: Currently in-memory; will migrate to KV-backed storage
- `health-endpoints`: Currently unprotected; will add rate limiting
- `upload-endpoints`: Currently no query limits; will add complexity controls
- `browser-auth-transport`: currently in-memory bearer tokens; target architecture is `httpOnly` cookie transport

## Impact

**Code Areas:**

- `workers/src/middleware/rate-limit.middleware.ts`: Migrate to KV storage
- `workers/wrangler.toml`: Add KV namespace binding, update rate limit config
- `workers/src/middleware/connection-limiter.middleware.ts`: New middleware
- `frontend/src/components/ClerkAuthProvider.tsx`: Existing in-memory token handling baseline
- backend auth middleware and frontend API clients (future option 3): cookie transport migration
- Cloudflare Dashboard: WAF rules, Bot Fight Mode, budget alerts

**External Dependencies:**

- Cloudflare KV namespace for rate limiting
- Cloudflare Analytics Engine (enabled in dashboard)
- Neon project budget alerts
- No Redis/Upstash required for initial distributed rate limiting path

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

1. Option 1 (now): implement Cloudflare edge controls + KV-backed distributed rate limiting + billing alerts
2. Option 1 (now): validate abuse protection and verify alerting paths
3. Option 2 (during trial): implement DB connection/query protections and tune thresholds from observed traffic
4. Option 2 (during trial): complete anomaly runbooks and incident detection workflows
5. Option 3 (post-trial): migrate browser auth transport to `httpOnly` cookie architecture with CSRF protections
6. Option 3 (post-trial): complete auth/session security validation and rollout runbook
