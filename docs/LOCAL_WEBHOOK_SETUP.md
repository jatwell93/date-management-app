# Local Webhook Development Setup Guide

This guide walks you through setting up Stripe webhook testing locally using ngrok or localtunnel.

## Why Webhooks Need Tunneling

Stripe webhooks are POST requests sent from Stripe's servers to your application. Stripe cannot reach `localhost` directly, so we need a tunneling service to forward requests to your local backend.

## Option 1: ngrok (Recommended)

### 1.1 Install ngrok

**macOS:**

```bash
brew install ngrok
```

**Windows (via Chocolatey):**

```bash
choco install ngrok
```

**Or download directly from:** https://ngrok.com/download

### 1.2 Start Your Backend

```bash
cd backend
npm run dev
# Server should be running on http://localhost:3001
```

### 1.3 Start ngrok Tunnel

In a new terminal:

```bash
ngrok http 3001
```

You'll see output like:

```
Forwarding    https://abc123.ngrok.io -> http://localhost:3001
```

Copy the HTTPS URL (`https://abc123.ngrok.io`)

### 1.4 Configure Stripe Webhook

1. Go to [Stripe Dashboard](https://dashboard.stripe.com) → Developers → Webhooks
2. Click **Add endpoint**
3. Enter: `https://abc123.ngrok.io/api/webhooks/stripe`
4. Select events:
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `checkout.session.completed`
   - `invoice.payment_failed`
   - `customer.subscription.trial_will_end`
5. Click **Add endpoint**
6. Copy the **Signing secret** (starts with `whsec_`)

### 1.5 Update Environment Variables

Create `.env.development` in the `backend/` directory:

```bash
# Copy from .env.example
cp .env.example backend/.env.development

# Edit the file and add:
STRIPE_SECRET_KEY=sk_test_xxxxx  # From https://dashboard.stripe.com/apikeys
STRIPE_WEBHOOK_SECRET=whsec_xxxxx  # From webhook endpoint (above)
```

### 1.6 Restart Backend

```bash
cd backend
npm run dev
```

The backend will load your new `.env.development` and have access to the Stripe keys.

### 1.7 Test the Webhook

In the Stripe Dashboard, find your webhook endpoint and click **Send test event**:

- Select event type: `customer.subscription.created`
- Click **Send event**

You should see the webhook logged in your backend console:

```
Processing webhook event: customer.subscription.created
```

### 1.8 Keep ngrok Running

Every time you restart your backend or need a fresh ngrok session:

```bash
ngrok http 3001  # Get new forwarding URL
# Update ngrok URL in Stripe Dashboard Webhooks settings
```

⚠️ **Note:** ngrok creates a new URL each time unless you sign up for a paid account with fixed URLs.

---

## Option 2: localtunnel (Lighter-weight Alternative)

### 2.1 Install localtunnel

```bash
npm install -g localtunnel
```

### 2.2 Start Backend

```bash
cd backend
npm run dev
```

### 2.3 Start Tunnel

In a new terminal:

```bash
lt --port 3001 --subdomain pharmacy-app
```

You'll get: `https://pharmacy-app.loca.lt`

### 2.4 Configure Stripe (same as above)

Use `https://pharmacy-app.loca.lt/api/webhooks/stripe` as your webhook endpoint.

### 2.5 Update .env (same as above)

Add `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` to `.env.development`.

---

## Webhook Handler Implementation

The webhook handler follows these principles:

### Handler Sequence

1. **Verify Signature First** — Reject invalid requests with 4xx
2. **Parse Payload Second** — After verification, construct the event
3. **Handle Idempotently** — Check event ID, then process; return 2xx for duplicates

### Current Event Handlers

| Event                                  | Status | Handler                               |
| -------------------------------------- | ------ | ------------------------------------- |
| `customer.subscription.created`        | TODO   | Create subscription_tiers record      |
| `customer.subscription.updated`        | TODO   | Update tier_level, current_period_end |
| `customer.subscription.deleted`        | TODO   | Downgrade to Starter tier             |
| `checkout.session.completed`           | TODO   | Mark trial_completed                  |
| `invoice.payment_failed`               | TODO   | Set status=past_due, trigger dunning  |
| `customer.subscription.trial_will_end` | TODO   | Send reminder email                   |

See [`backend/src/services/webhook.service.ts`](../backend/src/services/webhook.service.ts) for implementation details.

---

## Troubleshooting

### Webhook not being received?

1. **Check ngrok is running:** `ngrok http 3001`
2. **Verify Stripe Dashboard:** Webhooks → Your endpoint → View recent attempts
3. **Check backend logs:** Look for `Processing webhook event: ...`
4. **Signature verification failed?**
   - Ensure `STRIPE_WEBHOOK_SECRET` matches Stripe Dashboard
   - Verify it starts with `whsec_` (not the public key)

### Getting 4xx errors?

- 400: Invalid signature or missing header
- 401: Missing or wrong webhook secret
- Check `backend/src/routes/webhook.routes.ts` for error handling

### Getting 5xx errors?

- 500: Error processing webhook (handler threw exception)
- Check backend logs for detailed error message
- TODO: Implement error queue for failed webhooks

### ngrok URL keeps changing?

- Free ngrok creates new URL each restart
- Upgrade to paid ngrok for permanent URLs
- Or use localtunnel (also free, shorter-lived)

---

## Production Deployment

Once you have a production domain:

1. Update Stripe Webhooks → Edit endpoint → Change URL to: `https://yourdomain.com/api/webhooks/stripe`
2. No need for ngrok/localtunnel anymore
3. Keep `STRIPE_WEBHOOK_SECRET` in production `.env` file

---

## Next Steps

- **Task 8.11:** Add `STRIPE_WEBHOOK_SECRET` to `.env` file ✅ (done above)
- **Task 9.1-9.9:** Implement Stripe Subscription Service
- **Task 10.1-10.12:** Complete webhook handlers (currently TODOs in webhook.service.ts)
- **Task 11.1-11.9:** Implement Trial System
- **Task 12.1-12.8:** Build Subscription Management UI

---

## References

- [Stripe Webhooks Docs](https://stripe.com/docs/webhooks)
- [ngrok Documentation](https://ngrok.com/docs)
- [localtunnel GitHub](https://github.com/localtunnel/localtunnel)
- [webhook-handler-patterns skill](../../AGENTS.md#webhook-handler-patterns)
- [stripe-webhooks skill](../../AGENTS.md#stripe-webhooks)
