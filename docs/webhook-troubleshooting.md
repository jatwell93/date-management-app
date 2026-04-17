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
- Cause: Missing/incorrect `STRIPE_WEBHOOK_SECRET` or request body not raw.
- Fix:
  - Ensure `STRIPE_WEBHOOK_SECRET` in environment matches Stripe dashboard.
  - Confirm route uses `express.raw()` (already configured in `index.ts`).
  - Replay event via Stripe CLI once fixed: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`.
    **Diagnostic**:

```bash
npm run diagnose:webhook -- --recent
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
npm run diagnose:webhook -- --event-id <evt_id> --verbose
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

### 6) Email sending failed (SendGrid)

- Symptom: Emails not delivered; logs show `SENDGRID_API_KEY not set`.
- Fix:
  - Set `SENDGRID_API_KEY` in environment and verify sender domain.
  - Check SendGrid dashboard for suppressed recipients and template IDs.
    **Fix**:
- Set `SENDGRID_API_KEY` in environment and verify sender domain.
- Check SendGrid dashboard for suppressed recipients and template IDs.
- Verify template IDs in `backend/src/services/email.service.ts`:
  - `trialEndingSoon`: d-916668c6137341c292fad8cf219cb0ee
  - `paymentFailed`: d-731aef13fcd5415095708633599d37b6
  - `downgradeWarning`: d-a4639fceab7747d798b1931b955163e2

### 7) DB unique constraint errors when marking processed

- Symptom: Prisma P2002 on `processedWebhookEvent.create()`.
- Cause: Concurrent attempts to mark same event processed.
- Fix:
  - This is expected; handler swallows P2002 and treats event as already processed.
  - Monitor idempotency skip rate to detect replay attacks.
    **Fix**:
- This is expected; handler swallows P2002 and treats event as already processed.
- Monitor idempotency skip rate to detect replay attacks.

### 8) Webhook Not Processing (No Events Received)

- Where to look:
  - Sentry: handler failures and validation warnings
  - Application monitoring: webhook latency, failure count, idempotency skip rate
  - DB: `processed_webhook_event` growth (possible replay attack)

---

## Webhook Handler Reference

The system handles 8 webhook event types:

| Event                                  | Handler                          | Purpose                                          |
| -------------------------------------- | -------------------------------- | ------------------------------------------------ |
| `customer.subscription.created`        | `handleSubscriptionCreated`      | Creates subscription record, sets usage limits   |
| `customer.subscription.updated`        | `handleSubscriptionUpdated`      | Updates tier, applies creation lock on downgrade |
| `customer.subscription.deleted`        | `handleSubscriptionDeleted`      | Cancels subscription, downgrades to Starter      |
| `checkout.session.completed`           | `handleCheckoutSessionCompleted` | Marks trial as converted                         |
| `invoice.payment_failed`               | `handleInvoicePaymentFailed`     | Sets past_due, queues dunning email              |
| `customer.subscription.trial_will_end` | `handleTrialWillEnd`             | Sends trial reminder email                       |
| `payment_intent.succeeded`             | `handlePaymentIntentSucceeded`   | Confirms trial conversion                        |
| `payment_intent.payment_failed`        | `handlePaymentIntentFailed`      | Logs failure, sends alert                        |

### Handler Behavior

**Success (200)**: Event processed successfully or was a duplicate (idempotent).

**Client Error (400)**:

- Signature verification failed
- Invalid payload
- Missing required metadata

**Server Error (500)**:

- Database errors (Stripe will retry)
- External service failures (Stripe will retry)

---

## Diagnostic Tools

### Built-in Diagnostic Script

```bash
# Check recent webhook health
npm run diagnose:webhook -- --recent

# Investigate specific event
npm run diagnose:webhook -- --event-id evt_1234567890 --verbose

# Check specific organization
npm run diagnose:webhook -- --org <org_id> --verbose
```

### Manual Database Queries

**Check processed events**:

```sql
-- Recent events by type
SELECT event_type, COUNT(*) as count
FROM processed_webhook_events
WHERE processed_at > datetime('now', '-24 hours')
GROUP BY event_type;
```

**Check for missing events**:

```sql
-- Find organizations without recent subscription events
SELECT o.id, o.name, st.tier_level, st.status
FROM organizations o
JOIN subscription_tiers st ON o.id = st.organization_id
LEFT JOIN processed_webhook_events pwe
  ON pwe.event_type LIKE 'customer.subscription%'
  AND pwe.processed_at > datetime('now', '-7 days')
WHERE pwe.id IS NULL;
```

---

## Event-Specific Troubleshooting

### customer.subscription.created

**Fails when**:

- Stripe customer missing `organizationId` metadata
- Organization doesn't exist in database

**Log location**: `webhook.service.ts:290-380`

**Recovery**:

1. Check metadata: `npm run diagnose:webhook -- --org <org_id>`
2. If org missing, create organization manually
3. Replay event: `stripe events resend <evt_id>`

---

### invoice.payment_failed

**Timeline**:

- Day 0: Event received, status → `past_due`, dunning email sent
- Days 1-7: Grace period (access continues)
- Day 8: Dunning job auto-downgrades to Starter

**Check dunning status**:

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
stripe listen --forward-to localhost:3001/api/webhooks/stripe

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
