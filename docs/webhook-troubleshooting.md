# Webhook Troubleshooting Guide

Quick reference for common Stripe webhook problems and how to resolve them.

## Table of Contents

1. [Common Issues](#common-issues)
2. [Webhook Handler Reference](#webhook-handler-reference)
3. [Diagnostic Tools](#diagnostic-tools)
4. [Event-Specific Troubleshooting](#event-specific-troubleshooting)
5. [Testing & Replay](#testing--replay)
6. [Monitoring & Alerting](#monitoring--alerting)

---

## Common Issues

### 1) Signature verification failed

- Symptom: 400 from `/api/webhooks/stripe` with "signature verification failed".
- Cause: Missing/incorrect `STRIPE_WEBHOOK_SECRET`, or the request body was altered. The Worker verifies the signature over the raw body.
- Fix:
  - Ensure `STRIPE_WEBHOOK_SECRET` (Wrangler secret) matches the Stripe dashboard endpoint, or the `whsec_...` printed by `stripe listen` when testing locally.
  - A 503 "Stripe webhooks are not configured" means the secret is not set.
  - Replay the event via Stripe CLI once fixed: `stripe listen --forward-to 127.0.0.1:8787/api/webhooks/stripe`.
    **Diagnostic**:

```bash
npm run diagnose:webhook
```

### 2) Missing organizationId in customer metadata

- Symptom: Handler throws `Missing organizationId in Stripe customer metadata`.
- Cause: Stripe `customer.metadata.organizationId` not set.
- Fix:
  - Add `organizationId` to the Stripe Customer metadata in your billing/checkout flow.
  - For tests, mock `customer.metadata.organizationId` with the organization id.
    **Check with diagnostic**:

```bash
npm run diagnose:webhook -- --org <org_id>
```

### 3) Duplicate/replayed events

- Symptom: Same event processed multiple times or duplicate DB rows.
- Cause: No idempotency check or race on marking processed.
- Fix:
  - `ProcessedWebhookEvent` model enforces idempotency (unique `id`).
  - Handler returns 200 for duplicates and records idempotency skips for monitoring.
    **Verification**:

```bash
npm run diagnose:webhook -- --event-id <evt_id>
```

### 4) Customer deleted

- Symptom: `Customer has been deleted` / NotFoundError.
- Cause: Stripe customer is deleted; metadata unavailable.
- Fix:
  - Skip processing or reconcile customer in Stripe/DB.
  - Use audit logs to review affected orgs.
    **Fix**:
- Skip processing or reconcile customer in Stripe/DB.
- Use audit logs to review affected orgs:

```sql
SELECT * FROM audit_logs
WHERE action LIKE '%subscription%'
  AND change_description LIKE '%<customer_id>%'
ORDER BY created_at DESC;
```

### 5) Missing tier metadata (price.metadata.tier)

- Symptom: Handler defaults to `starter` tier or logs warning.
- Fix: Ensure price objects used in subscriptions include `metadata.tier` or rely on default behavior.
  **Fix**: Ensure price objects used in subscriptions include `metadata.tier`:

```bash
stripe prices update <price_id> -d "metadata[tier]=professional"
```

Or rely on default behavior (defaults to 'starter' if not specified).

### 6) Email sending failed (Resend)

- Symptom: Emails not delivered; the email queue consumer logs that Resend is not configured.
- Fix:
  - Set `RESEND_API_KEY` and `RESEND_FROM_EMAIL` on the Worker and verify the sender domain in Resend.
  - Check the Resend dashboard for suppressed recipients.
  - Check the `notification-emails` queue and its dead-letter queue in the Cloudflare dashboard.
  - Message content is built in `workers/src/notifications/messages.ts`; there are no external template IDs.

### 7) DB unique constraint errors when marking processed

- Symptom: a second delivery of the same event id is acknowledged but does nothing.
- Cause: Stripe delivers at least once, so concurrent redelivery is expected. The first delivery claims the event id in `processed_webhook_events`; a delivery that finds a live claim or a completed one is acknowledged without processing.
- Fix:
  - This is expected. A claim older than 60 seconds that never completed is taken over by the next delivery.
  - Monitor the skip rate to detect replay attacks, and use `npm run diagnose:webhook` to inspect a stuck claim.

### 8) Webhook Not Processing (No Events Received)

- Where to look:
  - Sentry: handler failures and validation warnings
  - `webhook_metrics`: outcomes per event type per day
  - DB: `processed_webhook_events` growth (possible replay attack)
  - `npm run diagnose:webhook` for health in the last 24 hours

---

## Webhook Handler Reference

The Worker acts on three Stripe event types and acknowledges the rest without side effects (see [`stripe-integration.md`](./stripe-integration.md)):

| Event                           | Handler                    | Purpose                                                  |
| ------------------------------- | -------------------------- | -------------------------------------------------------- |
| `customer.subscription.created` | `processSubscriptionEvent` | Creates the subscription record                          |
| `customer.subscription.updated` | `processSubscriptionEvent` | Updates tier and status; sets or clears `past_due_since` |
| `customer.subscription.deleted` | `processSubscriptionEvent` | Cancels the subscription                                 |
| Any other event type            | (none)                     | Acknowledged and logged, so Stripe stops retrying        |

### Handler Behavior

**Success (200)**: Event processed, was a duplicate (idempotent), or was an unhandled type.

**Client Error (400)**:

- Missing `stripe-signature` header or signature verification failed
- Invalid payload or no event id

**Not configured (503)**: `STRIPE_WEBHOOK_SECRET` is not set.

**Server Error (500)**:

- Database errors (Stripe will retry; the claim is released first)
- External service failures (Stripe will retry)

---

## Diagnostic Tools

### Built-in Diagnostic Script

Read-only. It needs the `DATABASE_URL_UNPOOLED` and `MIGRATION_*` environment described in [`migrations.md`](./migrations.md) section 2.

```bash
# Check recent webhook health (default window: 24 hours)
npm run diagnose:webhook

# Investigate specific event
npm run diagnose:webhook -- --event-id evt_1234567890

# Check specific organization (compares with Stripe when STRIPE_SECRET_KEY is set)
npm run diagnose:webhook -- --org <org_id>

# Change the window, or get JSON
npm run diagnose:webhook -- --hours 72 --json
```

### Manual Database Queries

**Check processed events**:

```sql
-- Recent events by type
SELECT event_type, COUNT(*) as count
FROM processed_webhook_events
WHERE processed_at > NOW() - INTERVAL '24 hours'
GROUP BY event_type;
```

**Check for stuck claims**:

```sql
-- Claimed but never completed
SELECT id, event_type, processed_at
FROM processed_webhook_events
WHERE completed_at IS NULL
ORDER BY processed_at;
```

Use a read-only session. Do not edit ledger rows by hand.

---

## Event-Specific Troubleshooting

### customer.subscription.created

**Fails when**:

- The subscription cannot be attributed to an organization (missing metadata)
- The organization does not exist in the database

Both are non-recoverable: the event is acknowledged and logged, because a redelivery carries the same body.

**Log location**: `workers/src/stripe/subscription-events.ts` (`processSubscriptionEvent`)

**Recovery**:

1. Check metadata: `npm run diagnose:webhook -- --org <org_id>`
2. Fix the missing metadata or organization
3. Replay event: `stripe events resend <evt_id>`

---

### Payment failure (`past_due`)

**Timeline**:

- Day 0: `customer.subscription.updated` with status `past_due`; `past_due_since` is set
- Days 1-7: Grace period (access continues)
- After day 7: the Worker treats the subscription as lapsed at request time. There is no dunning job. Creation is refused only when `SUBSCRIPTION_GATE_ENFORCE=true`.

**Check status**:

```sql
SELECT status, past_due_since
FROM subscription_tiers
WHERE organization_id = '<org_id>';
```

---

## Testing & Replay

### Local Testing with Stripe CLI

```bash
# Forward webhooks to local dev server
stripe listen --forward-to 127.0.0.1:8787/api/webhooks/stripe

# Trigger test events
stripe trigger customer.subscription.created
stripe trigger customer.subscription.updated
stripe trigger invoice.payment_failed
stripe trigger customer.subscription.trial_will_end
```

### Replay Specific Events

```bash
# Get recent events
stripe events list --limit 5

# Replay specific event
stripe events resend <event_id>
```

---

## Monitoring & Alerting

### Sentry Alerts

| Alert                    | Trigger          | Severity |
| ------------------------ | ---------------- | -------- |
| webhook_handler_error    | >1/day           | Error    |
| webhook_critical_failure | Missing metadata | Fatal    |
| idempotency_skip_anomaly | Sudden spike     | Warning  |

### When to Return 500 vs 200

| Response | Use When                             | Stripe Behavior      |
| -------- | ------------------------------------ | -------------------- |
| **200**  | Success, duplicate, validation error | No retry             |
| **400**  | Signature failed, invalid payload    | No retry             |
| **500**  | Database error, transient failure    | Retries with backoff |

---

## Related Documentation

- [SaaS Operational Runbook](./SAAS_OPERATIONAL_RUNBOOK.md) - Billing operations
- [Stripe Integration](./stripe-integration.md) - Setup and configuration
- [Tier Downgrade Guide](./tier-downgrade-guide.md) - Downgrade handling

---

_Last updated: March 2026_
