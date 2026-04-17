# Stripe Integration — Webhooks & Billing (Phase 10)

## Summary ✅

This document describes the Stripe webhook integration implemented in Phase 10.
It covers the six webhook handlers, required metadata, idempotency, email flows, monitoring, testing and deployment checklist.

## Handlers implemented

- `customer.subscription.created` — create `SubscriptionTier`, update `OrganizationUsage`, log audit event.
- `customer.subscription.updated` — sync subscription state, detect downgrades and queue downgrade warning email.
- `customer.subscription.deleted` — cancel subscription, downgrade to `starter`, queue warning if usage > starter limits.
- `checkout.session.completed` — mark trial as converted (clear `trialEndDate`, set active).
- `invoice.payment_failed` — set subscription `past_due`, log dunning audit, queue dunning email.
- `customer.subscription.trial_will_end` — compute days remaining and queue trial reminder email.

## Key integration details

- Metadata source of truth: Stripe `customer.metadata.organizationId` (DECISION 17.5.5).
- Idempotency: DB-backed `ProcessedWebhookEvent` prevents replay processing.
- Transactions: All DB changes for a single webhook are wrapped in `prisma.$transaction()` to ensure atomicity.
- Email: SendGrid used via `EmailService` (trial reminders, dunning, downgrade warning).
- Soft lock: on downgrade-over-limit we queue a downgrade warning and (future) set `readOnlyMode`.

## Environment variables

- STRIPE_SECRET_KEY — optional for SDK (required in production for signature verification)
- STRIPE_WEBHOOK_SECRET — required for verifying incoming webhook signatures
- SENDGRID_API_KEY — required to send emails via SendGrid
- SENTRY_DSN — (optional) send errors/alerts to Sentry

## Monitoring & Alerts

- Sentry captures handler failures and validation warnings (context: eventId, eventType, organizationId, subscriptionId/invoiceId).
- ApplicationMonitoringService records webhook metrics:
  - Latency per event type
  - Failure count by event type
  - Idempotency skip count (replays)
- Alerts configured via ApplicationMonitoringService and forwarded to Sentry (webhook failures, idempotency anomalies).

## Testing

- Unit tests: full mocking for handlers and idempotency (see `backend/src/tests/unit/webhook.service.test.ts`).
- Integration tests: Prisma + SQLite for DB behavior, idempotency and concurrency (`backend/src/tests/integration`).
- Edge cases: missing metadata, deleted customers, out-of-order events, concurrent processing covered.

## Subscription Lifecycle

```
Checkout → subscription.created → trial_will_end → (trial converts) checkout.session.completed → subscription.updated (active)
Upgrade  → subscription.updated (tier up) → invoice.paid
Downgrade→ subscription.updated (tier down) → invoice.paid → 7-day grace → over-limit? downgrade warning email
Cancel   → subscription.deleted → usage locked, read-only mode until period end
```

## Local Testing & CLI Tips

```bash
# Trigger Stripe test event delivery to local server (requires Stripe CLI)
stripe listen --events customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.payment_failed \
  --forward-to http://localhost:3000/api/webhooks/stripe

# Replay the last event
stripe events resend evt_123

# Generate fake checkout session
node scripts/stripe/create-test-checkout.js --tier professional --org fake-org-uuid
```

## Testing Matrix

| Scenario                               | Expected DB change                                           | Email queued      | Test file                      |
| -------------------------------------- | ------------------------------------------------------------ | ----------------- | ------------------------------ |
| Trial signup → conversion              | `SubscriptionTier=starter→professional`, `trialEndDate=null` | trial_welcome     | `webhook.service.test.ts`      |
| Upgrade professional→premium           | Tier row updated                                             | none              | `subscription-upgrade.test.ts` |
| Downgrade premium→starter (over limit) | Tier updated, `readOnlyMode=pending`                         | downgrade_warning | `downgrade-over-limit.test.ts` |
| Payment failed (past_due)              | `status=past_due`                                            | dunning_email     | `payment-failed.test.ts`       |
| Cancel subscription                    | `status=canceled`, tier=starter                              | cancel_confirm    | `subscription-cancel.test.ts`  |

## Operational notes

- Webhook route: `POST /api/webhooks/stripe` — uses `express.raw()` for signature verification.
- Duplicate events: returned 200 OK (idempotency skip); replays counted in metrics.
- Retry behavior: return 500 for transient/server errors so Stripe will retry.

## Acceptance criteria

- All 6 handlers implemented and covered by tests
- No duplicate processing (DB idempotency)
- Emails queued for trial reminders, dunning, downgrade warnings
- Monitoring and Sentry alerts in place for failures and anomalies

---

For implementation details and examples, see `backend/src/services/webhook.service.ts` and the tests under `backend/src/tests/*/webhook*`.
