# Webhook Flow Visualization

## Local Development Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    YOUR DEVELOPMENT MACHINE                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌─────────────────────┐        ┌──────────────────────────┐   │
│  │   Your Backend      │        │  ngrok/localtunnel       │   │
│  │   (localhost:3001)  │◄─────►│  (tcp tunnel to Stripe)  │   │
│  └─────────────────────┘        └──────────────────────────┘   │
│          ▲                               ▼                       │
│          │                      ┌──────────────────────────┐   │
│          │                      │   INTERNET               │   │
│          │                      │ ┌────────────────────┐   │   │
│          │                      │ │  Stripe Servers    │   │   │
│          │                      │ │ (sends webhooks)   │   │   │
│          │                      │ └────────────────────┘   │   │
│          │                      │                          │   │
│          │                      │  + Signature            │   │
│          │                      │  + Event JSON           │   │
│          │                      │  + Timestamp            │   │
│          │                      └──────────────────────────┘   │
│          │                                                       │
│    ✅ WEBHOOK RECEIVED & VERIFIED                             │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Webhook Processing Sequence

### 1. Stripe Sends Webhook

```
POST https://abc123.ngrok.io/api/webhooks/stripe
Content-Type: application/json
Stripe-Signature: t=1234567890,v1=abcdef...

{
  "id": "evt_1234567890",
  "type": "customer.subscription.created",
  "data": {
    "object": {
      "id": "sub_1234567890",
      "customer": "cus_1234567890",
      "status": "active",
      ...
    }
  }
}
```

### 2. Your Backend Receives Request

```
Express Router: POST /api/webhooks/stripe
│
├─ Raw Body Preserved (for signature verification)
│
└─ Request Handler in webhook.routes.ts
```

### 3. Step 1: VERIFY Signature

```typescript
// Get signature from header
signature = req.headers['stripe-signature'];
// Example: "t=1234567890,v1=abcdef123..."

// Verify signature using raw body + webhook secret
event = Stripe.webhooks.constructEvent(
  rawBody,
  signature,
  envConfig.STRIPE_WEBHOOK_SECRET, // whsec_xxx from Stripe
);

// ✅ If valid → Continue
// ❌ If invalid → Return 400, don't process
```

### 4. Step 2: CHECK IDEMPOTENCY

```typescript
// Already processed this event?
if (webhookService.isNewEvent(event.id)) {
  // ✅ New event → Process it
} else {
  // ⚠️ Duplicate → Return 200 (success) without reprocessing
  // Prevents double-charging, double-creating records, etc.
}
```

### 5. Step 3: HANDLE IDEMPOTENTLY

```typescript
// Route event to correct handler based on type
switch (event.type) {
  case 'customer.subscription.created':
    await handleSubscriptionCreated(event.data.object);
    break;

  case 'customer.subscription.updated':
    await handleSubscriptionUpdated(event.data.object);
    break;

  // ... other event types
}

// Mark event as processed
webhookService.markEventProcessed(event.id, event.type);

// ✅ Return 200 OK
```

### 6. Return Response

```
200 OK
{
  "received": true
}
```

### 7. Stripe Records Delivery

```
Stripe Dashboard → Webhooks → Your Endpoint → Recent Events
Status: "Delivered" (green checkmark)
```

---

## Event Handler Flow (Example: customer.subscription.created)

```
Event received: customer.subscription.created
│
├─ Extract subscription data from event.data.object
│  ├─ subscription.id (stripe subscription ID)
│  ├─ subscription.customer (stripe customer ID)
│  ├─ subscription.status ("active", "trialing", "past_due", etc.)
│  ├─ subscription.current_period_end (timestamp)
│  ├─ subscription.trial_end (if applicable)
│  └─ price metadata (tier_level from Stripe pricing)
│
├─ Create/Update Database Record
│  └─ INSERT INTO subscription_tiers
│      (organization_id, stripe_subscription_id, tier_level, status, ...)
│
├─ Optional: Send Email
│  └─ Send "Welcome to [tier] plan" email
│
└─ ✅ Complete
```

---

## Environment Variables Used

```bash
STRIPE_SECRET_KEY=sk_test_xxxxx
│ └─ Used to: Create Stripe client instance
│    Where:   webhook.service.ts constructor
│    When:    At backend startup

STRIPE_WEBHOOK_SECRET=whsec_xxxxx
│ └─ Used to: Verify webhook signature (critical for security!)
│    Where:   webhook.service.ts verifySignature()
│    When:    Every webhook request
```

---

## Testing Locally

### Manual Test Via Stripe Dashboard

```
Stripe Dashboard
↓
Webhooks → Your Endpoint
↓
Click "Send test event"
↓
Choose event type: "customer.subscription.created"
↓
Click "Send event"
↓
Stripe sends POST to your webhook endpoint (via ngrok/localtunnel)
↓
Your backend processes and logs:
  [WEBHOOK] Processing webhook event: customer.subscription.created
  [WEBHOOK] Webhook event processed successfully
↓
Check Stripe Dashboard → Recent Events
  Status: "Delivered" ✅
```

### Real Production Test

```
Customer signs up on your website
↓
Create payment intent in Stripe
↓
Customer completes payment
↓
Stripe automatically sends webhooks:
  - payment_intent.succeeded
  - checkout.session.completed
  - customer.subscription.created
↓
Your backend receives and processes each webhook
↓
Database updated automatically
```

---

## Security: Signature Verification

Why it matters:

- Prevents malicious actors from sending fake webhooks
- Guarantees webhook comes from Stripe (authentic)
- Guarantees webhook hasn't been tampered with in transit

How it works:

```
1. Stripe uses STRIPE_WEBHOOK_SECRET to sign the webhook
2. Signature sent in Stripe-Signature header
3. Your backend uses same secret to verify signature
4. If signatures match → webhook is authentic ✅
5. If signatures don't match → reject webhook (4xx) ❌

It's like a HMAC (Hash-Based Message Authentication Code)
```

---

## Webhook Retry Logic (Handled by Stripe)

If your endpoint returns non-2xx:

```
Attempt 1: Immediately
Attempt 2: 5 seconds later (if 1st failed)
Attempt 3: 5 minutes later
Attempt 4: 30 minutes later
Attempt 5: 2 hours later
Attempt 6: 5 hours later
Attempt 7: 10 hours later
Attempt 8: 24 hours later

Maximum: 8 attempts over 24 hours
```

Your endpoint should:

- Return 2xx for success (don't retry)
- Return 4xx for validation errors (don't retry)
- Return 5xx for temporary errors (will retry)

---

## Next Phase: Implementation

Once webhook receiving works, implement the TODO handlers:

- [ ] Task 9.x: Implement `handleSubscriptionCreated()`
  - Create subscription_tiers record
  - Set tier_level from price metadata
  - Set start date, end date, status

- [ ] Task 10.x: Implement `handleSubscriptionUpdated()`
  - Update tier_level if price changed
  - Handle prorating for upgrades

- [ ] Task 11.x: Implement Trial System
  - Detect `trial_end` in subscription
  - Schedule reminder emails
  - Auto-downgrade on expiration

- [ ] Task 12.x: Implement `handleInvoicePaymentFailed()`
  - Set status = 'past_due'
  - Trigger dunning email
  - Prevent access to premium features

---

## Files Reference

| File                                      | Purpose                                          |
| ----------------------------------------- | ------------------------------------------------ |
| `backend/src/services/webhook.service.ts` | Webhook verification, idempotency, event routing |
| `backend/src/routes/webhook.routes.ts`    | Express route handler                            |
| `backend/src/config/environment.ts`       | Loads STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET   |
| `docs/LOCAL_WEBHOOK_SETUP.md`             | Complete setup guide (ngrok/localtunnel)         |
| `.env.example`                            | Environment variable template                    |
| `WEBHOOK_FLOW.md`                         | This file                                        |
