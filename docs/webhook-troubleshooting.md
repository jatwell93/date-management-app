# Webhook Troubleshooting

Quick reference for common Stripe webhook problems and how to resolve them.

## 1) Signature verification failed
- Symptom: 400 from `/api/webhooks/stripe` with "signature verification failed".
- Cause: Missing/incorrect `STRIPE_WEBHOOK_SECRET` or request body not raw.
- Fix:
  - Ensure `STRIPE_WEBHOOK_SECRET` in environment matches Stripe dashboard.
  - Confirm route uses `express.raw()` (already configured in `index.ts`).
  - Replay event via Stripe CLI once fixed: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`.

## 2) Missing organizationId in customer metadata
- Symptom: Handler throws `Missing organizationId in Stripe customer metadata`.
- Cause: Stripe `customer.metadata.organizationId` not set.
- Fix:
  - Add `organizationId` to the Stripe Customer metadata in your billing/checkout flow.
  - For tests, mock `customer.metadata.organizationId` with the organization id.

## 3) Duplicate/replayed events
- Symptom: Same event processed multiple times or duplicate DB rows.
- Cause: No idempotency check or race on marking processed.
- Fix:
  - `ProcessedWebhookEvent` model enforces idempotency (unique `id`).
  - Handler returns 200 for duplicates and records idempotency skips for monitoring.

## 4) Customer deleted
- Symptom: `Customer has been deleted` / NotFoundError.
- Cause: Stripe customer is deleted; metadata unavailable.
- Fix:
  - Skip processing or reconcile customer in Stripe/DB.
  - Use audit logs to review affected orgs.

## 5) Missing tier metadata (price.metadata.tier)
- Symptom: Handler defaults to `starter` tier or logs warning.
- Fix: Ensure price objects used in subscriptions include `metadata.tier` or rely on default behavior.

## 6) Email sending failed (SendGrid)
- Symptom: Emails not delivered; logs show `SENDGRID_API_KEY not set`.
- Fix:
  - Set `SENDGRID_API_KEY` in environment and verify sender domain.
  - Check SendGrid dashboard for suppressed recipients and template IDs.

## 7) DB unique constraint errors when marking processed
- Symptom: Prisma P2002 on `processedWebhookEvent.create()`.
- Cause: Concurrent attempts to mark same event processed.
- Fix:
  - This is expected; handler swallows P2002 and treats event as already processed.
  - Monitor idempotency skip rate to detect replay attacks.

## 8) Monitoring & Alerting
- Where to look:
  - Sentry: handler failures and validation warnings
  - Application monitoring: webhook latency, failure count, idempotency skip rate
  - DB: `processed_webhook_event` growth (possible replay attack)

## 9) How to replay/test events locally
- Use Stripe CLI:
  - `stripe trigger customer.subscription.created`
  - Or forward real webhooks: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`
- Ensure local `.env.test` has `STRIPE_WEBHOOK_SECRET` and `STRIPE_SECRET_KEY` for verification.

## 10) When to return 500 vs 200
- 500: transient/server errors — Stripe should retry.
- 200: validation errors (bad signature, missing metadata) and duplicates (idempotent).

---
If you want, I can add example curl/stripe-cli commands for each handler or draft a runbook for on-call engineers.