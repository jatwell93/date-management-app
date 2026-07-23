# Rate Limiting Strategy Research

## Executive Summary

Cloudflare offers **two production-viable rate limiting approaches**, both of which keep infrastructure centralized in Cloudflare:

1. **Cloudflare WAF Rate Limiting Rules** (Primary Recommendation)
   - Edge-level rate limiting (no backend involvement)
   - Built-in to Cloudflare platform
   - 0 external infrastructure needed
   - **Best for:** Invite creation, invite acceptance, role-change endpoints

2. **Cloudflare Durable Objects** (Advanced/Per-User)
   - Custom rate limiting logic in Workers
   - Can embed complex authorization checks
   - Scales per-IP/per-user basis
   - **Best for:** Upload endpoints needing organization-based limits

**Redis (Not Recommended for This Project)**

- Adds external infrastructure dependency
- Requires backend integration (middleware)
- Increases operational complexity
- Not needed given Cloudflare options

---

## Option 1: Cloudflare WAF Rate Limiting Rules ✅ RECOMMENDED

### What It Is

Built-in Cloudflare feature to throttle/block requests matching patterns when threshold exceeded.

### Capabilities by Plan

| Feature                      | Free       | Pro                         | Business                                 | Enterprise                       |
| ---------------------------- | ---------- | --------------------------- | ---------------------------------------- | -------------------------------- |
| **Number of Rules**          | 1          | 2                           | 5                                        | 100                              |
| **Counting Characteristics** | IP only    | IP                          | IP, IP+NAT, Query, Host, Headers, Cookie | All above + ASN, Country, Custom |
| **Expression Fields**        | Path, Bot  | Host, URI, Path, Query, Bot | All Pro + Method, IP, User Agent         | All above + Body, Header details |
| **Mitigation Timeout**       | 10s only   | Up to 1 hour                | Up to 1 day                              | Up to 1 day (custom)             |
| **Counting Period**          | 10s only   | Up to 60s                   | Up to 10 min                             | Up to 65,535s                    |
| **Throttle vs Block**        | Block only | Block only                  | Block only                               | Block + Throttle                 |

### How It Works

```
1. Define rule expression (e.g., "path contains /api/invites AND method=POST")
2. Set counting characteristic (e.g., IP address)
3. Set threshold (e.g., 10 requests per 60 seconds)
4. Set action (block) and duration (e.g., 5 minutes)
5. Deploy to zone
6. Cloudflare edge enforces globally
```

### Example Configuration

```
Rule: Protect invite creation endpoint
- Expression: (http.request.uri.path eq "/api/organization/invites") AND (http.request.method eq "POST")
- Characteristics: IP (count by source IP)
- Threshold: 10 requests per 60 seconds
- Action: Block
- Duration: 5 minutes
- Response: HTTP 429 "Too Many Requests"
```

### Advantages

✅ **No backend changes needed** — Cloudflare enforces at edge  
✅ **Global consistency** — Same limits everywhere  
✅ **Automatic scaling** — No infrastructure to manage  
✅ **Integrated dashboards** — Monitor from Cloudflare UI  
✅ **Multiple rules** — Can create separate limits per endpoint  
✅ **Cost predictable** — Included in Cloudflare plan

### Limitations

❌ **Plan-dependent** — Free only allows 1 rule total  
❌ **Coarse counting** — Limited to IP-based (can't count per authenticated user on Free/Pro)  
❌ **Delay before enforcement** — Up to 5 seconds before rate limit detected in rare cases  
❌ **No per-organization limits** — Can't say "10/min per org", only "10/min per IP"

### Pricing

**Included in all Cloudflare plans** (no overage charges)

---

## Option 2: Cloudflare Durable Objects + Workers

### What It Is

Custom rate limiting logic that runs in your Workers code, backed by Durable Objects for state tracking.

### How It Works

```
1. User makes request to Workers
2. Workers extracts identifying characteristic (IP, user ID, org ID, etc.)
3. Calls Durable Object RateLimiter for that ID
4. Durable Object tracks tokens/timestamps in storage
5. Returns milliseconds_until_allowed (0 = allow, >0 = deny)
6. Workers returns 429 if needed
```

### Example Code Pattern

```typescript
// In Workers handler
const ip = request.headers.get('CF-Connecting-IP');
const stub = env.RATE_LIMITER.getByName(ip);
const msToWait = await stub.checkRateLimit();

if (msToWait > 0) {
  return new Response('Rate limit exceeded', {
    status: 429,
    headers: { 'Retry-After': Math.ceil(msToWait / 1000) },
  });
}

// Allow request to proceed
return handleUpload(request, env, ctx);
```

### Advantages

✅ **Custom authorization logic** — Can use org context from Clerk  
✅ **Per-user rate limits** — Count by user ID instead of just IP  
✅ **Sophisticated algorithms** — Token bucket, sliding window, etc.  
✅ **Graceful degradation** — Can implement backoff/throttle behavior  
✅ **Audit-aware** — Can track which users hit limits

### Limitations

❌ **Pricing** — Durable Objects have per-request and storage costs  
❌ **Complexity** — Requires Workers-specific code patterns  
❌ **State management** — Need to design cleanup/expiration logic  
❌ **Debugging** — Harder to troubleshoot than edge rules  
❌ **Multi-region consideration** — Per-IP rate limiting may have edge location issues

### Pricing

- **Request fee:** $0.15 per 1M requests
- **Storage:** $1.25 per GB-month
- **Typical cost** for moderate traffic: $5-50/month

---

## Option 3: Redis + Backend Middleware ❌ NOT RECOMMENDED

### Why Not?

- Adds infrastructure dependency (Redis instance to manage)
- Requires backend middleware on every protected route
- Higher operational burden (backups, monitoring, failover)
- Higher cost than Cloudflare-native solutions
- Doesn't scale globally without Redis cluster

---

## Recommendation for Your Project

### Tier 1: WAF Rate Limiting Rules (Primary)

**For Invite & Role Management Endpoints**

Deploy Cloudflare WAF rate limiting rules at the zone level:

```
Rule 1: Invite Creation
- Endpoint: POST /api/organization/invites
- Limit: 10 requests per 60 seconds per IP
- Duration: 5 minutes
- Plan: Pro+ (Business for better field matching)

Rule 2: Invite Acceptance
- Endpoint: POST /api/organization/invites/{id}/accept
- Limit: 5 requests per 60 seconds per IP
- Duration: 5 minutes
- Plan: Pro+

Rule 3: Role Management
- Endpoint: POST /api/organization/members/{id}/role
- Limit: 20 requests per 3600 seconds per IP
- Duration: 1 hour
- Plan: Business+ (for better expression support)
```

**No backend code needed** — deployed via Cloudflare API/Dashboard

### Tier 2: Durable Objects (Optional - Advanced)

**If You Need Per-Organization Limits**

If standard rate limiting proves insufficient and you need limits like:

- "10 invites per organization per hour" (not per IP)
- "5 failed attempts per user per hour"

Then add Durable Object rate limiter for:

- Upload authorization endpoint (fine-grained org-based limits)
- Invite acceptance with brute-force protection

**Cost justification:** Would only activate if abuse patterns require it.

---

## Implementation Path

### Phase 1: WAF Rules (Week 1)

1. ✅ Upgrade Cloudflare plan to **Business** (if not already) for better field matching
2. Create 3 WAF rate limiting rules via Cloudflare API
3. Test with curl/postman to verify 429 responses
4. Monitor in Cloudflare dashboard for 72 hours

### Phase 2: Backend Validation (Week 1-2)

1. Add backend rate limit middleware as **defense in depth** (optional but recommended)
   - Counts by authenticated user, not just IP
   - Catches distributed attacks (multiple IPs, same user)
   - Provides audit trail

Example backend middleware:

```typescript
// Simplified example
const rateLimitKey = `user:${userId}:invites:${Math.floor(Date.now() / 60000)}`;
const count = await redis.incr(rateLimitKey);
if (count > 10) {
  return res.status(429).json({ error: 'Rate limit exceeded' });
}
redis.expire(rateLimitKey, 120); // 2 min TTL
```

**OR** (if you don't want Redis):

Use in-memory cache with TTL + request deduplication:

```typescript
const memoryCache = new Map();
const rateLimitKey = `user:${userId}:invites`;

if (memoryCache.has(rateLimitKey)) {
  const { count, resetTime } = memoryCache.get(rateLimitKey);
  if (Date.now() < resetTime) {
    if (count > 10) return res.status(429);
  }
}
```

### Phase 3: Durable Objects (If Needed)

Only if abuse patterns emerge:

1. Design per-organization rate limiting
2. Implement Durable Object rate limiter
3. Integrate into upload handler

---

## Plan Recommendation by Use Case

### If You're on Cloudflare **Free Plan**

- **Option:** Implement Rate Limiting in Workers (Durable Objects)
- **Why:** Free plan only allows 1 WAF rule
- **Cost:** ~$5-15/month for moderate traffic

### If You're on Cloudflare **Pro Plan**

- **Option:** 2 WAF rules (best choice) + backend validation
- **Coverage:** Invite creation, invite acceptance
- **Upload rate limiting:** In Workers or backend

### If You're on Cloudflare **Business/Enterprise**

- **Option:** All 3-5 WAF rules + backend validation
- **Coverage:** All endpoints
- **Audit trail:** Full backend tracking
- **Most resilient:** Multiple layers of protection

---

## Final Decision: Hybrid Approach (RECOMMENDED)

**Deploy both for defense-in-depth:**

```
Layer 1: Cloudflare WAF Rules
├─ POST /api/organization/invites → 10/min per IP
├─ POST /api/organization/invites/{id}/accept → 5/min per IP
└─ POST /api/organization/members/{id}/role → 20/hour per IP

Layer 2: Backend Middleware (Optional)
├─ Rate limit by authenticated userId (not just IP)
├─ Provide audit trail
└─ Catch distributed attacks

Layer 3: Durable Objects (If Needed Later)
└─ Per-organization limits for uploads
```

**Benefits:**
✅ Cloudflare edge stops obvious attacks  
✅ Backend catches sophisticated attacks (multiple IPs)  
✅ Can upgrade to Durable Objects without rewriting  
✅ Audit trail for forensics  
✅ Scales globally

---

## Next Steps

1. **Verify Cloudflare plan level** (Free/Pro/Business/Enterprise)
2. **If Business+:** Create 3 WAF rules via API or Dashboard
3. **If Pro or lower:** Implement Durable Objects rate limiter in Workers
4. **Add optional backend validation** for defense-in-depth
5. **Test with load testing** to verify thresholds are reasonable

---

## References

- [Cloudflare WAF Rate Limiting Rules](https://developers.cloudflare.com/waf/rate-limiting-rules/)
- [Durable Objects Rate Limiter Example](https://developers.cloudflare.com/durable-objects/examples/build-a-rate-limiter/)
- [Cloudflare Pricing](https://www.cloudflare.com/pricing/)
