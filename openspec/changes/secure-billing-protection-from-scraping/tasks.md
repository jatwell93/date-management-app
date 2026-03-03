# Tasks: Secure Billing Protection from Scraping Attacks

## Overview

Implement defense-in-depth protections against scraping attacks that could cause unexpected billing spikes in Cloudflare Workers + Neon serverless Postgres architecture.

## Tasks

### Phase 1: Cloudflare Edge Protection

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

### Phase 2: KV-Backed Rate Limiter

- [ ] **2.1** Create KV Namespace
  ```bash
  cd workers
  npx wrangler kv:namespace create RATE_LIMITER
  ```

- [ ] **2.2** Update wrangler.toml with KV binding
  ```toml
  [[kv_namespaces]]
  binding = "RATE_LIMITER"
  id = "<namespace-id-from-step-2.1>"
  ```

- [ ] **2.3** Migrate rate limiter to KV storage
  - Update `workers/src/middleware/rate-limit.middleware.ts`
  - Replace in-memory Map with KV namespace calls
  - Implement sliding window algorithm
  - Add TTL for automatic cleanup

- [ ] **2.4** Update rate limit configuration
  - Reduce anonymous limit: 10 → 5 requests/minute
  - Reduce authenticated limit: 100 → 30 requests/minute
  - Update wrangler.toml:
    ```toml
    RATE_LIMIT_WINDOW = "60000"
    RATE_LIMIT_MAX_REQUESTS = "5"
    RATE_LIMIT_MAX_AUTHENTICATED = "30"
    ```

### Phase 3: Database Connection Protection

- [ ] **3.1** Create connection limiter middleware
  - Create `workers/src/middleware/connection-limiter.middleware.ts`
  - Implement MAX_CONCURRENT_CONNECTIONS = 50
  - Return 503 when limit exceeded

- [ ] **3.2** Add query complexity limits
  - Add max results limit (100) to all list endpoints
  - Add query timeout (10 seconds)
  - Create `workers/src/middleware/query-limiter.middleware.ts`

- [ ] **3.3** Configure Neon connection limits
  - Go to Neon Console → Project Settings
  - Set max connections per branch
  - Enable connection pooling warning alerts

### Phase 4: Budget Alerts

- [ ] **4.1** Configure Cloudflare Budget Alerts
  - Go to Cloudflare Dashboard → Account → Billing → Alerts
  - Create alerts:
    - Daily spend > $10: Email + SMS
    - Weekly spend > $50: Email + SMS
    - Monthly spend > $200: Email + SMS
    - Spike > 200% baseline: Immediate alert

- [ ] **4.2** Configure Neon Budget Alerts
  - Go to Neon Console → Project → Billing
  - Set monthly budget limit
  - Enable email notifications

- [ ] **4.3** Add Slack/Discord notifications (optional)
  - Configure incoming webhook for Cloudflare alerts
  - Configure incoming webhook for Neon alerts

### Phase 5: Monitoring & Detection

- [ ] **5.1** Create Analytics Engine anomaly queries
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

- [ ] **5.2** Define alert thresholds
  - Requests/min > 500: Warning
  - Requests/min > 2,000: Alert
  - Unique IPs/min > 200: Warning
  - Unique IPs/min > 1,000: Alert
  - DB connections > 50: Warning
  - DB connections > 100: Alert

- [ ] **5.3** Document runbook for security incidents
  - Add to `backend/docs/operational-runbooks.md`
  - Include: attack detection, mitigation steps, escalation

### Phase 6: Validation & Testing

- [ ] **6.1** Test rate limiting
  - Send 10 requests/min from same IP (should be blocked)
  - Verify headers: X-RateLimit-Limit, X-RateLimit-Remaining

- [ ] **6.2** Test KV persistence
  - Deploy new version
  - Verify rate limits persist across deployments

- [ ] **6.3** Test connection limiting
  - Simulate high connection scenario
  - Verify 503 response when limit exceeded

- [ ] **6.4** Test Cloudflare rate limiting
  - Configure test rule with low threshold
  - Verify requests are blocked at edge

- [ ] **6.5** Verify budget alerts
  - Trigger test alert (use sandbox mode if available)
  - Verify notification delivery

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

## References

- [Cloudflare Rate Limiting](https://developers.cloudflare.com/waf/rate-limiting/)
- [Cloudflare Bot Fight Mode](https://developers.cloudflare.com/bots/)
- [Cloudflare KV](https://developers.cloudflare.com/workers/runtime-apis/kv/)
- [Neon Connection Pooling](https://neon.tech/docs/connect/connection-pooling)
- [Cloudflare WAF](https://developers.cloudflare.com/waf/)
