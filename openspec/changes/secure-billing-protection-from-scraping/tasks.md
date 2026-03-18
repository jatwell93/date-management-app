# Tasks: Secure Billing Protection from Scraping Attacks

## Overview

Implement defense-in-depth protections against scraping attacks and related auth/session abuse risks that could cause unexpected billing spikes or account compromise in Cloudflare Workers + Neon serverless Postgres architecture.

## Combined Execution Strategy (Options 1, 2, 3)

This change now combines two security concerns into one plan:
- Scraping and billing-abuse protection (distributed rate limiting + edge controls)
- Session transport hardening (in-memory token now, cookie migration later)

### Option 1: Commit now (pre-trial / launch gate)

**Goal:** Immediate risk reduction with currently configured stack (Cloudflare, Workers KV, Neon, Sentry, Clerk), without requiring Redis/Upstash.

**Workload:** Medium (roughly 2-4 engineering days + dashboard configuration)

**Current risk addressed:**
- High if multi-instance scraping bypass is possible
- Medium for cost spike from automated abuse

**Tasks included:** Phase 1 + Phase 2 + Phase 4.1 + Phase 4.2 + Phase 6.1 + Phase 6.2 + Phase 6.4

### Option 2: Continue during trial (hardening and tuning)

**Goal:** Use real traffic to tune controls and protect database cost/availability.

**Workload:** Medium (roughly 2-5 engineering days spread over trial)

**Current risk addressed:**
- Medium for false positives/false negatives in limits
- Medium for DB saturation and expensive query patterns

**Tasks included:** Phase 3 + Phase 5 + Phase 6.3 + Phase 6.5 + Phase 4.3 (optional)

### Option 3: Post-trial architecture hardening

**Goal:** Migrate from JavaScript-accessible bearer token transport to cookie-based `httpOnly` session transport.

**Workload:** High (roughly 1-2 weeks, cross-cutting frontend/backend auth changes)

**Current residual risk:**
- Tokens are no longer persisted in browser storage, but remain accessible at runtime to app JavaScript
- XSS impact is reduced but not eliminated compared with `httpOnly` cookies

**Tasks included:** Phase 7

## Tasks

### Phase 1 (Option 1): Cloudflare Edge Protection

- [ ] **1.1** Enable Cloudflare Bot Fight Mode
  - Go to Cloudflare Dashboard → Workers → Security → Bot Fight Mode
  - Enable for production environment
  - Reference: [Cloudflare Bot Management](https://developers.cloudflare.com/bots/)

- [ ] **1.2** Configure Cloudflare WAF Rate Limiting Rules
  - Go to Security → WAF → Rate Limiting Rules
  - Create rule for `/api/*` endpoints:
    - Match: `http.request.uri.path` matches `/api/*`
    - Action: Block
    - Threshold: 100 requests/minute
    - Period: 60 seconds
  - Create rule for `/health` endpoint:
    - Match: `http.request.uri.path` matches `/health*`
    - Action: Block
    - Threshold: 30 requests/minute
    - Period: 60 seconds

- [ ] **1.3** Add Custom Firewall Rules
  - Go to Security → WAF → Custom Rules
  - Create rule: Block Known Scrapers
    - Expression: `(cf.threat_score > 10)`
    - Action: JS Challenge

- [ ] **1.4** Enable Cloudflare Analytics Engine
  - Go to Cloudflare Dashboard → Workers → Analytics Engine
  - Enable the feature
  - Note: Required for anomaly detection queries

### Phase 2 (Option 1): KV-Backed Distributed Rate Limiter

> NOTE: Redis/Upstash is not required for this phase. Use Cloudflare KV as the distributed state store.

- [x] **2.1** Create KV Namespace
  ```bash
  cd workers
  npx wrangler kv namespace create RATE_LIMITER
  ```

- [x] **2.2** Update wrangler.toml with KV binding
  ```toml
  [[env.production.kv_namespaces]]
  binding = "RATE_LIMITER"
  id = "a0b277b9636144cba1bacdcb247a2d40"

  [[env.development.kv_namespaces]]
  binding = "RATE_LIMITER"
  id = "bc5312ed84fa4ff1bf59d3dc067309be"
  ```

- [x] **2.3** Migrate rate limiter to KV storage
  - Update `workers/src/middleware/rate-limit.middleware.ts`
  - Replace in-memory Map with KV namespace calls
  - Implement sliding window algorithm
  - Add TTL for automatic cleanup

- [x] **2.4** Update rate limit configuration
  - Reduce anonymous limit: 10 → 5 requests/minute
  - Reduce authenticated limit: 100 → 30 requests/minute
  - Update wrangler.toml:
    ```toml
    RATE_LIMIT_WINDOW = "60000"
    RATE_LIMIT_MAX_REQUESTS = "5"
    RATE_LIMIT_MAX_AUTHENTICATED = "30"
    ```

- [x] **2.5** Configure JWT secret in Cloudflare Workers (development)
  - Set `JWT_SECRET` via Wrangler secret for `date-management-api-dev`
  - Redeploy Worker after secret update
  - Remove `JWT_SECRET is required` runtime failure on protected endpoints

### Phase 3 (Option 2): Database Connection Protection

- [x] **3.1** Create connection limiter middleware
  - Create `workers/src/middleware/connection-limiter.middleware.ts`
  - Implement MAX_CONCURRENT_CONNECTIONS = 50
  - Return 503 when limit exceeded

- [x] **3.2** Add query complexity limits
  - Add max results limit (100) to all list endpoints
  - Add query timeout (10 seconds)
  - Create `workers/src/middleware/query-limiter.middleware.ts`

- [x] **3.3** Configure Neon connection limits
  - Go to Neon Console → Project Settings
  - Set max connections per branch
  - Enable connection pooling warning alerts

### Phase 4 (Option 1/2): Budget Alerts

- [ ] **4.1** Configure Cloudflare Budget Alerts
  - Go to Cloudflare Dashboard → Account → Billing → Alerts
  - Create alerts:
    - Daily spend > $10: Email + SMS
    - Weekly spend > $50: Email + SMS
    - Monthly spend > $200: Email + SMS
    - Spike > 200% baseline: Immediate alert

- [x] **4.2** Configure Neon Budget Alerts
  - Go to Neon Console → Project → Billing
  - Set monthly budget limit
  - Enable email notifications
  - N/A on Neon Free plan; deferred until upgrade. Review after launch

- [ ] **4.3** Add Slack/Discord notifications (optional)
  - Configure incoming webhook for Cloudflare alerts
  - Configure incoming webhook for Neon alerts

### Phase 5 (Option 2): Monitoring & Detection

- [x] **5.1** Create Analytics Engine anomaly queries
  ```sql
  -- Detect scraping patterns
  SELECT 
    count() as request_count,
    any(cf.source_ip) as sample_ip,
    bin(time, 1 minute) as minute
  FROM analytics_events
  WHERE endpoint LIKE '/api/v1/%'
  GROUP BY minute
  HAVING request_count > 1000
  ```

- [x] **5.2** Define alert thresholds
  - Requests/min > 500: Warning
  - Requests/min > 2,000: Alert
  - Unique IPs/min > 200: Warning
  - Unique IPs/min > 1,000: Alert
  - DB connections > 50: Warning
  - DB connections > 100: Alert
  - Implemented in `backend/docs/operational-runbooks.md` with Analytics Engine SQL set and source mapping for Unique IP metrics via Cloudflare Security Analytics

- [x] **5.3** Document runbook for security incidents
  - Add to `backend/docs/operational-runbooks.md`
  - Include: attack detection, mitigation steps, escalation

### Phase 6 (Option 1/2): Validation & Testing

- [x] **6.1** Test rate limiting
  - Send 10 requests/min from same IP (should be blocked)
  - Verify headers: X-RateLimit-Limit, X-RateLimit-Remaining

- [x] **6.2** Test KV persistence
  - Deploy new version
  - Verify rate limits persist across deployments

- [x] **6.6** Verify protected/auth endpoint behavior after JWT secret configuration
  - Confirm `/api/products` returns `401` (unauthorized) instead of `500`
  - Confirm `/health` returns `200`
  - Confirm `/api/health` returns `200`

- [x] **6.3** Test connection limiting
  - Simulate high connection scenario
  - Verify 503 response when limit exceeded

- [ ] **6.4** Test Cloudflare rate limiting
  - Configure test rule with low threshold
  - Verify requests are blocked at edge

- [ ] **6.5** Verify budget alerts
  - Trigger test alert (use sandbox mode if available)
  - Verify notification delivery

### Phase 7 (Option 3): Session Transport Hardening (post-trial)

- [ ] **7.1** Define cookie-based session architecture
  - Replace JS-managed bearer transport with secure cookie transport for browser requests
  - Define access/refresh lifecycle, rotation, and revocation behavior
  - Confirm compatibility with Clerk session model

- [ ] **7.2** Backend cookie auth support
  - Add cookie parsing and session validation middleware to backend API
  - Ensure protected routes accept cookie-authenticated sessions
  - Keep backward compatibility flag for controlled rollout

- [ ] **7.3** CSRF protection controls
  - Implement CSRF mitigation for cookie-authenticated state-changing requests
  - Document allowed origins and credential policies
  - Add tests for CSRF rejection and valid token acceptance

- [ ] **7.4** Frontend migration from Authorization headers to credentialed requests
  - Remove remaining direct bearer-token header injection in browser fetch paths
  - Update API client to use credentialed cookie transport
  - Validate offline-sync strategy compatibility and fallback behavior

- [ ] **7.5** Security validation for session migration
  - Pen-test or DAST focus on session fixation, CSRF, and auth bypass
  - Verify forced logout/revocation behavior
  - Add runbook updates for auth incidents

## Configuration Summary

| Setting | Current | New Value |
|---------|---------|-----------|
| Anonymous rate limit | 10/min | 5/min |
| Authenticated rate limit | 100/min | 30/min |
| Health endpoint rate limit | None | 30/min |
| Concurrent DB connections | Unlimited | 50 |
| Query result limit | Unlimited | 100 |
| Query timeout | 30s | 10s |
| Daily budget alert | None | $10 |
| Weekly budget alert | None | $50 |
| Monthly budget alert | None | $200 |
| Browser token persistence | Removed | In-memory only (current) |
| Browser auth transport target | Bearer in JS runtime | httpOnly cookie transport (Phase 7) |

## References

- [Cloudflare Rate Limiting](https://developers.cloudflare.com/waf/rate-limiting/)
- [Cloudflare Bot Fight Mode](https://developers.cloudflare.com/bots/)
- [Cloudflare KV](https://developers.cloudflare.com/workers/runtime-apis/kv/)
- [Neon Connection Pooling](https://neon.tech/docs/connect/connection-pooling)
- [Cloudflare WAF](https://developers.cloudflare.com/waf/)
- [OWASP ASVS Session Management](https://owasp.org/www-project-application-security-verification-standard/)
