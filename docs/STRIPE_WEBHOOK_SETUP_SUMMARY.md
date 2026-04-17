# Stripe Webhook Setup - Implementation Complete ✅

This document summarizes what's been set up for local webhook testing.

## What Was Created

### 1. **Webhook Handler Service**

- File: `backend/src/services/webhook.service.ts`
- Implements Stripe signature verification
- Handles idempotent event processing
- Event handlers (currently TODOs):
  - ✅ `customer.subscription.created`
  - ✅ `customer.subscription.updated`
  - ✅ `customer.subscription.deleted`
  - ✅ `checkout.session.completed`
  - ✅ `invoice.payment_failed`
  - ✅ `customer.subscription.trial_will_end`

### 2. **Webhook Routes**

- File: `backend/src/routes/webhook.routes.ts`
- Endpoint: `POST /api/webhooks/stripe`
- Verify → Parse → Handle (idempotent sequence)
- Raw body parsing for Stripe signature verification

### 3. **Backend Integration**

- Webhook routes mounted in `backend/src/index.ts`
- Uses `express.raw()` middleware BEFORE `express.json()`
- Separate from authenticated routes

### 4. **Environment Configuration**

- Updated `backend/src/config/environment.ts` with Stripe keys
- Added `.env.example` with all environment variables
- Added `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` variables

### 5. **Stripe Package**

- Added `stripe@^13.10.0` to `backend/package.json`
- Run `npm install` in backend directory to get it

### 6. **Documentation**

- Created `docs/LOCAL_WEBHOOK_SETUP.md` with complete setup guide
- Includes ngrok and localtunnel options
- Troubleshooting section

## Quick Start (5 Minutes)

### Step 1: Install Stripe Package

```bash
cd backend
npm install
```

### Step 2: Set Up Tunnel

```bash
# Option A: ngrok (recommended)
brew install ngrok
ngrok http 3001

# Option B: localtunnel
npm install -g localtunnel
lt --port 3001 --subdomain pharmacy-app
```

You'll get a URL like:

- ngrok: `https://abc123.ngrok.io`
- localtunnel: `https://pharmacy-app.loca.lt`

### Step 3: Configure Stripe Webhook

1. Go to [Stripe Dashboard](https://dashboard.stripe.com/test/webhooks)
2. Click **Add endpoint**
3. Enter: `https://abc123.ngrok.io/api/webhooks/stripe` (use your tunnel URL)
4. Select events to listen for:
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `checkout.session.completed`
   - `invoice.payment_failed`
   - `customer.subscription.trial_will_end`
5. Click **Add endpoint**
6. Copy the **Signing secret** (starts with `whsec_`)

### Step 4: Configure Environment

```bash
# In backend/.env.development (or backend/.env):
STRIPE_SECRET_KEY=sk_test_xxxxx        # From https://dashboard.stripe.com/apikeys
STRIPE_WEBHOOK_SECRET=whsec_xxxxx      # From step 3 above
```

### Step 5: Start Backend

```bash
npm run dev
# Server should be running on http://localhost:3001
```

### Step 6: Test Webhook

1. Go to Stripe Dashboard → Webhooks → Your endpoint
2. Click **Send test event**
3. Select `customer.subscription.created`
4. Click **Send event**
5. Your backend should log: `[WEBHOOK] Processing webhook event: customer.subscription.created`

## Files Changed

- ✅ `backend/src/services/webhook.service.ts` - Created
- ✅ `backend/src/routes/webhook.routes.ts` - Created
- ✅ `backend/src/index.ts` - Updated (added webhook routes)
- ✅ `backend/src/config/environment.ts` - Updated (added Stripe config)
- ✅ `backend/package.json` - Updated (added stripe package)
- ✅ `.env.example` - Created
- ✅ `docs/LOCAL_WEBHOOK_SETUP.md` - Created

## Testing Checklist

- [ ] Run `npm install` in backend
- [ ] Start tunnel (ngrok or localtunnel)
- [ ] Add webhook endpoint in Stripe Dashboard
- [ ] Get webhook signing secret from Stripe
- [ ] Add `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` to `.env.development`
- [ ] Start backend with `npm run dev`
- [ ] Send test event from Stripe Dashboard
- [ ] Verify webhook logged in backend console

## Next Steps

1. **Implement event handlers** (currently TODOs in webhook.service.ts):
   - Create `subscription_tiers` records on subscription created
   - Update subscription tier when price changes
   - Downgrade to Starter on cancellation
   - Handle trial completion

2. **Add database persistence** for processed events:
   - Create `processed_webhook_events` table
   - Replace in-memory Map with database queries
   - Implement retry queue for failed webhooks

3. **Task 9.x**: Implement Stripe Subscription Service
   - Create subscription in Stripe
   - Query subscription status
   - Handle prorating for upgrades

4. **Task 10.x**: Complete webhook handlers
   - Replace TODO comments with actual implementation
   - Create/update subscription_tiers records
   - Send email notifications

## Troubleshooting

### "STRIP_SECRET_KEY not found" or "STRIPE_WEBHOOK_SECRET not found"

- Check `.env.development` file exists in `backend/` directory
- Verify values are not empty (should start with `sk_test_` and `whsec_`)
- Restart backend after updating `.env` file

### Webhook not being received

- Check tunnel is still running (`ngrok http 3001` or `lt --port 3001`)
- Verify URL is correct in Stripe Dashboard (should match tunnel URL)
- Check Stripe Dashboard → Webhooks → View recent attempts

### Signature verification failed

- Ensure `STRIPE_WEBHOOK_SECRET` matches Stripe Dashboard (whitespace matters!)
- Should start with `whsec_` (not `sk_test_`)

### Port 3001 already in use

- Change `PORT` in `.env.development`
- Or kill the process using port 3001: `lsof -i :3001`

## References

- [Complete Setup Guide](./LOCAL_WEBHOOK_SETUP.md)
- [Stripe Webhooks Docs](https://stripe.com/docs/webhooks)
- [Stripe Testing](https://stripe.com/docs/testing)
- [webhook-handler-patterns skill](https://github.com/hookdeck/webhook-skills/tree/main/skills/webhook-handler-patterns)
