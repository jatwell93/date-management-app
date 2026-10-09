# Stripe Integration — Webhooks & Billing

## Summary

This document describes the Stripe integration in the Worker (`workers/src/stripe/`). It covers the events handled, required metadata, idempotency, email flows, monitoring, testing and operational notes.

The receiver is `POST /api/webhooks/stripe` (`workers/src/stripe/webhook-handler.ts`). The earlier Express handlers (`backend/src/services/webhook.service.ts`) are retired; the last revision is the tag `express-sqlite-last`.

## Events handled

Only three events change state. They carry the authoritative subscription object, and between them they write every column the Worker reads to decide entitlement (`tier_level`, `status`, `trial_end_date`, `current_period_end`, `cancel_at_period_end`, `past_due_since`):

- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

Every other event type is acknowledged and logged without side effects, so Stripe stops retrying. The omissions are deliberate:

- `checkout.session.completed`: in subscription mode Stripe always follows it with `customer.subscription.created` carrying the same state, so handling both would race on one row.
- `invoice.payment_failed`: Stripe moves the subscription to `past_due` and sends `customer.subscription.updated`. `past_due_since` is derived from that status, and it clears when the customer pays.
- `customer.subscription.trial_will_end`: it changes no state. Trial reminder emails come from the scheduled `trial-emails` job.
- `payment_intent.*`: no entitlement depends on them.

## Environment variables

Set on the Worker (`wrangler secret put ... --env production`, or `workers/.dev.vars` locally; see `workers/.dev.vars.example`):

- `STRIPE_WEBHOOK_SECRET` — required to verify webhook signatures. Without it the receiver answers 503 and writes nothing.
- `STRIPE_SECRET_KEY` — used by checkout, the portal and the reconciliation job. Use test-mode keys outside production.
- `STRIPE_*_PRICE_ID` — one per paid tier and interval; each must match the frontend's `REACT_APP_STRIPE_PRICE_*`.
- `RESEND_API_KEY`, `RESEND_FROM_EMAIL` — send notification emails.
- `WORKERS_SENTRY_DSN` — optional; send errors to Sentry.

## Key integration details

- Metadata source of truth: the subscription is attributed to an organization through Stripe metadata. An event that cannot be attributed is acknowledged and logged, because a redelivery would carry the same body.
- Idempotency: each event id is claimed in `processed_webhook_events` before processing and marked complete afterwards. A replay of a completed event returns 200 without side effects. A failed delivery releases its claim so Stripe's retry is processed.
- Reconciliation: the scheduled `stripe-reconciliation` job (daily) re-applies Stripe's view of every linked subscription through the same code path as a webhook delivery, and logs drift. A local row missing from Stripe is warned about, never deleted.
- Email: `trial-emails` enqueues trial reminders (10, 5 and 2 days) and a trial-ended notice onto `NOTIFICATION_EMAIL_QUEUE`; the consumer sends them with Resend.

## Monitoring & Alerts

- Sentry captures handler failures (context: event id, event type, organization, subscription).
- `webhook_metrics` counts outcomes per event type per UTC day. A failed delivery releases its claim, so the ledger alone does not show failures; the metrics do.
- Inspect a delivery or a stuck claim with `npm run diagnose:webhook` (read-only; see [`webhook-troubleshooting.md`](./webhook-troubleshooting.md)).

## Subscription Lifecycle

```
Checkout → subscription.created (trialing) → subscription.updated (active when the trial converts)
Upgrade  → subscription.updated (tier up)
Downgrade→ subscription.updated (tier down)
Payment failed → subscription.updated (status past_due; past_due_since set)
Cancel   → subscription.deleted (or cancel_at_period_end via subscription.updated)
```

## Local Testing & CLI Tips

```bash
# Forward Stripe test events to the local Worker (requires Stripe CLI).
# Use 127.0.0.1, not localhost: wrangler dev listens on IPv4 only.
stripe listen --forward-to 127.0.0.1:8787/api/webhooks/stripe

# Use the printed whsec_... as STRIPE_WEBHOOK_SECRET in workers/.dev.vars

# Replay an event
stripe events resend evt_123
```

See [`local-expect-qa.md`](./local-expect-qa.md) for creating test prices and mapping them to environment variables.

## Testing

- Handler and signature tests: `workers/src/stripe/*.test.ts`.
- Real-SQL tests for the claim ledger, persistence and billing handlers: `workers/src/stripe/*.pglite.node.test.ts` and `webhook-handler.node.test.ts` (`npm run test:db`).
- Reconciliation: `workers/src/scheduled/jobs/stripe-reconciliation.test.ts` and `.pglite.node.test.ts`.

## Operational notes

- Webhook route: `POST /api/webhooks/stripe`. The signature is verified over the raw request body.
- Duplicate events: returned 200 OK (idempotency skip).
- Retry behavior: 5xx for transient/server errors so Stripe retries; 200 for non-recoverable data issues so it stops.

## Acceptance criteria

- The three subscription events are applied through one code path, shared with reconciliation
- No duplicate processing (database claim ledger)
- Monitoring and Sentry alerts in place for failures and anomalies
