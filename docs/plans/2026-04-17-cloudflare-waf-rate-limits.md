# Cloudflare WAF Rate Limiting Rules — Task 3.4

## Overview

Three rate limiting rules to protect organization invite and role management endpoints.
Apply via **Cloudflare Dashboard → Security → WAF → Rate limiting rules** or via the Cloudflare API.

These rules apply to the Workers deployment (`date-management-api-prod`).

---

## Rule 1: Invite Creation

| Field | Value |
|---|---|
| **Name** | Rate limit invite creation |
| **Match** | `http.request.uri.path eq "/api/organization/invites"` AND `http.request.method eq "POST"` |
| **Rate** | 10 requests per 60 seconds |
| **Counting** | Per IP (`ip.src`) |
| **Action** | Block for 300 seconds (5 min) |
| **Response code** | 429 |

## Rule 2: Invite Acceptance

| Field | Value |
|---|---|
| **Name** | Rate limit invite acceptance |
| **Match** | `http.request.uri.path matches "^/api/organization/invites/[^/]+/accept$"` AND `http.request.method eq "POST"` |
| **Rate** | 5 requests per 60 seconds |
| **Counting** | Per IP (`ip.src`) |
| **Action** | Block for 300 seconds (5 min) |
| **Response code** | 429 |

## Rule 3: Role Assignment

| Field | Value |
|---|---|
| **Name** | Rate limit role changes |
| **Match** | `http.request.uri.path matches "^/api/organization/members/[^/]+/role$"` AND `http.request.method eq "POST"` |
| **Rate** | 20 requests per 3600 seconds |
| **Counting** | Per IP (`ip.src`) |
| **Action** | Block for 3600 seconds (1 hour) |
| **Response code** | 429 |

---

## Cloudflare API Equivalent (curl)

Replace `ZONE_ID` and `API_TOKEN` with your values.

```bash
# Rule 1: Invite creation
curl -X POST "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/rulesets" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "name": "rate-limit-invite-create",
    "kind": "zone",
    "phase": "http_ratelimit",
    "rules": [
      {
        "action": "block",
        "expression": "http.request.uri.path eq \"/api/organization/invites\" and http.request.method eq \"POST\"",
        "ratelimit": {
          "characteristics": ["ip.src"],
          "period": 60,
          "requests_per_period": 10,
          "mitigation_timeout": 300
        }
      }
    ]
  }'
```

> Repeat similarly for Rules 2 and 3 with the corresponding expressions and thresholds.

---

## Verification Checklist

- [ ] Rule 1: Send 11 POST requests to `/api/organization/invites` within 60s → 11th should return 429
- [ ] Rule 2: Send 6 POST requests to `/api/organization/invites/{id}/accept` within 60s → 6th should return 429
- [ ] Rule 3: Send 21 POST requests to `/api/organization/members/{id}/role` within 1 hour → 21st should return 429
- [ ] All 429 responses include `Retry-After` header
- [ ] Normal usage (well under threshold) is not affected
