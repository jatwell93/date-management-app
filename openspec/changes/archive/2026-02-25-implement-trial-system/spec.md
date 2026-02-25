# Specification: Trial System with Clerk Auth

**Version:** 2.0  
**Status:** Active (Clerk Integration Complete)  
**Last Updated:** Phase 4A

---

## Overview

The Trial System allows new organizations to use the app for 14 days (professional tier) before converting to a paid subscription. Authentication is provided by Clerk (managed service), with disposable email validation and transaction-based atomicity for conversions.

---

## Modules

### 1. Clerk Authentication

#### Feature 1.1: Email/Password Signup with Clerk

**Scenario 1.1.1: User Signs Up Successfully**

```gherkin
Given user navigates to signup page
When user enters email "john@example.com", password "SecurePass123", and org name "ABC Pharmacy"
And user clicks "Sign Up"
Then Clerk verifies email ownership
And backend webhook receives user.created event
And Organization record created with name "ABC Pharmacy"
And User record created linked to Clerk (clerkUserId = "user_abc123")
And SubscriptionTier created with status=TRIALING, tierLevel=professional, trialEndDate = now + 14 days
And user redirected to app dashboard
And TrialEvent logged: { eventType: 'trial_started', metadata: { tierLevel: 'professional', daysTrialed: 0 } }
```

**Scenario 1.1.2: Disposable Email Rejected**

```gherkin
Given user attempts signup with email "test@mailinator.com"
When webhook handler validates email
Then validation fails
And user redirected with error: "Disposable email addresses are not allowed"
And Organization NOT created
And User NOT created
```

**Scenario 1.1.3: Duplicate Email Rejected**

```gherkin
Given Organization A exists with user "john@example.com"
When user attempts signup with email "john@example.com"
Then Clerk prevents duplicate (unique constraint)
And user redirected: "This email is already in use"
```

#### Feature 1.2: OAuth Signup (Google/Outlook)

**Scenario 1.2.1: User Signs Up via Google OAuth**

```gherkin
Given user clicks "Sign up with Google"
When user completes Google consent flow with email "john@gmail.com"
Then Clerk verifies identity
And user.created webhook fired
And Organization + User + Trial created (same as Email signup)
And user logged into app
```

**Note**: Phone field not required in Phase 4A (Clerk provides email verification).

---

### 2. Trial Management

#### Feature 2.1: Trial Status Display

**Scenario 2.1.1: User in Active Trial**

```gherkin
Given user is in trial (status = TRIALING, trialEndDate = future)
When user requests GET /api/subscription/trial-status
Then response includes:
  {
    "isInTrial": true,
    "trialStartDate": "2026-02-17T00:00:00Z",
    "trialEndDate": "2026-03-03T00:00:00Z",
    "daysRemaining": 14,
    "tierLevel": "professional",
    "tierLimits": {
      "maxSkus": 2000,
      "maxUsers": 3
    }
  }
```

**Scenario 2.1.2: User with Expired Trial (Downgraded to Starter)**

```gherkin
Given user's trial expired (trialEndDate = past)
And status = ACTIVE, tierLevel = starter (downgraded)
When user requests GET /api/subscription/trial-status
Then response includes:
  {
    "isInTrial": false,
    "tierLevel": "starter",
    "tierLimits": {
      "maxSkus": 500,
      "maxUsers": 1
    }
  }
```

**Scenario 2.1.3: User with Active Paid Subscription**

```gherkin
Given user converted trial to paid subscription
And status = ACTIVE, stripeSubscriptionId = "sub_123abc"
When user requests GET /api/subscription/trial-status
Then response includes:
  {
    "isInTrial": false,
    "tierLevel": "professional",
    "tierLimits": { "maxSkus": 2000, "maxUsers": 3 }
  }
```

#### Feature 2.2: Trial Reminders (Scheduled)

**Scenario 2.2.1: Reminder Sent at Day-10 Mark**

```gherkin
Given trial ends in exactly 10 days
And scheduled job runs at 00:00 UTC
And no reminder previously sent for day-10 threshold
When job calls findTrialsNeedingReminders()
Then organization's admin email returned in results
And sendTrialReminder() called with daysRemaining=10
And reminder email sent via SendGrid
And TrialEvent logged: { eventType: 'trial_reminder_sent', metadata: { daysRemaining: 10 } }
And sentRemindersAt tracking updated: { "10": true }
```

**Scenario 2.2.2: Duplicate Reminders Prevented**

```gherkin
Given day-10 reminder previously sent (sentRemindersAt.10 = true)
When job runs again on day-10
Then reminder NOT sent again (idempotency check)
And job logs: "Reminder already sent for this threshold"
```

**Scenario 2.2.3: Multiple Reminders in Trial Period**

```gherkin
Given trial 14 days, reminders scheduled for days 10, 5, 2
When job runs daily
Then Day 1-9: No reminders sent
And Day 10: Reminder sent (10 days remaining)
And Day 11-14: No reminders sent
And Day 15: No reminder (already expired, downgraded)
And Day 5: Reminder sent (5 days remaining)
And Day 2: Reminder sent (2 days remaining)
```

#### Feature 2.3: Trial Expiration & Auto-Downgrade

**Scenario 2.3.1: Trial Expires, Auto-Downgrade to Starter**

```gherkin
Given trial with trialEndDate = 2026-02-17T00:00:00Z (now = past)
And status = TRIALING
When scheduled job runs at 00:00 UTC on expiration date
And downgradeExpiredTrials() called
Then subscription updated atomically:
  - status: TRIALING → ACTIVE
  - tierLevel: professional → starter
  - stripeSubscriptionId: NULL (no payment method charged yet)
And TrialEvent logged: { eventType: 'trial_expired', metadata: { daysTrialed: 14, downgradedToTier: 'starter' } }
And downgrade warning email sent to org admin
And email includes: "Your trial has ended. You're now on the Starter plan (500 SKUs, 1 user)."
```

**Scenario 2.3.2: Atomicity Under High Load (Multiple Downgrade Attempts)**

```gherkin
Given 100 trials expiring on same date
And job runs at 00:00 UTC
When downgradeExpiredTrials() processes all 100 in $transaction()
Then all 100 downgraded consistently:
  - No partial updates (all-or-nothing)
  - No duplicate events
  - All emails sent
And TrialEvent table has 100 entries with eventType='trial_expired'
```

**Scenario 2.3.3: Email Failure Doesn't Stop Job**

```gherkin
Given 5 trials expiring
And trial #3 has invalid admin email (bounce)
When job runs downgradeExpirations()
Then trials 1,2,4,5 downgraded + emails sent (success)
And trial #3 downgraded (success) but email send fails
And error logged to Sentry: "Failed to send downgrade email for org_xyz"
And job continues (doesn't crash)
And all 5 TrialEvent entries created
```

---

### 3. Trial to Paid Conversion

#### Feature 3.1: Conversion Endpoint

**Scenario 3.1.1: User Converts Trial to Paid (Happy Path)**

```gherkin
Given user in active trial (professional tier, 10 days remaining)
And user has valid payment method (pm_test123)
When user posts to POST /api/subscription/convert-trial:
  {
    "stripePaymentMethodId": "pm_test123",
    "billingCycle": "monthly"
  }
Then background transaction begins:
  1. Verify subscription status = TRIALING
  2. Verify stripeCustomerId exists (created at org setup - Issue #2)
  3. Call stripe.subscriptions.create():
     - customer: stripeCustomerId
     - price: price_professional_monthly
     - payment_method: pm_test123
     - payment_behavior: 'error_if_incomplete'
  4. If Stripe succeeds:
     - Update status: TRIALING → ACTIVE
     - Store stripeSubscriptionId = "sub_123abc"
     - Set trialConvertedAt = now
     - Commit transaction
  5. Log TrialEvent: { eventType: 'trial_converted', metadata: { daysTrialed: 10, stripeSubscriptionId: 'sub_123abc' } }
And response returns 200:
  {
    "status": "active",
    "tierLevel": "professional",
    "stripeSubscriptionId": "sub_123abc",
    "nextBillingDate": "2026-03-03T00:00:00Z",
    "amount": 99,
    "currency": "USD"
  }
```

**Scenario 3.1.2: Payment Declined (Stripe Error)**

```gherkin
Given user attempts conversion with declined card (pm_fail123)
When conversion endpoint called
And stripe.subscriptions.create() fails:
  {
    "error": {
      "type": "card_error",
      "message": "Your card was declined"
    }
  }
Then transaction rolled back:
  - status remains TRIALING
  - stripeSubscriptionId NOT updated
  - trialConvertedAt NOT set
And response returns 402:
  {
    "error": "Payment failed: Your card was declined. Please use a different card."
  }
And TrialEvent NOT logged (transaction rolled back)
And user can retry with different payment method
```

**Scenario 3.1.3: Not in Trial (Already Converted)**

```gherkin
Given user already converted trial (status = ACTIVE, stripeSubscriptionId = "sub_existing")
When user attempts conversion again with new card
Then endpoint verifies: status != TRIALING
And returns 400:
  {
    "error": "Not in a trial period"
  }
And no charge attempted
And Stripe NOT called
```

**Scenario 3.1.4: Unauthorized User (Non-Admin)**

```gherkin
Given organization has 3 users: admin, member, viewer
When member attempts to convert trial:
  POST /api/subscription/convert-trial { ... }
Then authorization check fails:
  - Extract organizationId from JWT
  - Verify user role = 'admin' in organization
And returns 403:
  {
    "error": "Only organization administrators can convert the trial"
  }
And Stripe NOT called
```

**Scenario 3.1.5: Race Condition - Simultaneous Conversions**

```gherkin
Given trial subscription with balance = unlocked
When 2 authorized admins call conversion endpoint simultaneously:
  - Admin A: POST with pm_card_A at t=0.0s
  - Admin B: POST with pm_card_B at t=0.001s
Then transaction isolation ensures:
  1. Request A acquires lock on subscription row
  2. Request A reads status = TRIALING ✓
  3. Request A calls Stripe: subscription created
  4. Request A commits: status → ACTIVE, stripeSubscriptionId stored
  5. Request B acquires lock (after A commits)
  6. Request B reads status = ACTIVE ✗ (no longer TRIALING)
  7. Request B rollbacks: BadRequestError("Not in trial")
And Stripe has only 1 subscription (no double-charge)
And TrialEvent has exactly 1 'trial_converted' entry
And response:
  - A: 200 (success)
  - B: 400 (not in trial)
```

#### Feature 3.2: Stripe Webhook Confirmation

**Scenario 3.2.1: Payment Intent Succeeded Webhook**

```gherkin
Given conversion request submitted, Stripe subscription created
When Stripe sends webhook event: payment_intent.succeeded
  {
    "type": "payment_intent.succeeded",
    "data": {
      "object": {
        "id": "pi_123abc",
        "customer": "cus_123abc",
        "status": "succeeded"
      }
    }
  }
Then backend webhook handler:
  1. Verifies webhook signature
  2. Finds SubscriptionTier with stripeCustomerId = "cus_123abc"
  3. Verifies status = ACTIVE (conversion completed)
  4. Logs TrialEvent: { eventType: 'payment_confirmed', metadata: { paymentIntentId: 'pi_123abc' } }
And returns 200 { "received": true }
```

**Scenario 3.2.2: Payment Intent Failed Webhook**

```gherkin
Given conversion request, Stripe payment fails
When webhook event: payment_intent.payment_failed
Then handler:
  1. Finds subscription by customer ID
  2. Verifies status still TRIALING (not yet converted)
  3. Sends alert email to org admin: "Payment failed, please retry"
  4. Logs TrialEvent: { eventType: 'payment_failed', metadata: { paymentIntentId: 'pi_123abc', error: '...' } }
And returns 200 (Stripe doesn't retry on 2xx)
```

---

## 4. Data Model

### SubscriptionTier Extended

```prisma
model SubscriptionTier {
  id                   String
  organizationId       String          @unique
  tierLevel            TierLevel       // starter | professional | premium | concierge
  stripeSubscriptionId String?         // NULL during trial
  stripeCustomerId     String          // Created at org setup (never NULL)
  status               SubscriptionStatus
  
  // Trial fields (NEW)
  trialEndDate         DateTime?       // NULL if not in trial
  trialStartedAt       DateTime?       // When trial began
  trialConvertedAt     DateTime?       // When converted to paid
  
  createdAt            DateTime
  updatedAt            DateTime
}

enum SubscriptionStatus {
  ACTIVE = "active"
  CANCELED = "canceled"
  PAST_DUE = "past_due"
  TRIALING = "trialing"
}
```

### TrialEvent (NEW)

```prisma
model TrialEvent {
  id             String
  organizationId String
  eventType      String    // trial_started | trial_converted | trial_expired | trial_reminder_sent | payment_confirmed | payment_failed
  occurredAt     DateTime
  metadata       Json?
  sentRemindersAt Json?    // { "10": true, "5": true, "2": true }
}
```

### User Updated

```prisma
model User {
  id             Int
  clerkUserId    String    @unique
  email          String    @unique
  username       String    @unique  // For audit trail display
  organizationId String
  role           String
  // PIN field REMOVED ❌
}
```

---

## 5. API Specification

### GET /api/subscription/trial-status

```
Authorization: Bearer <Clerk JWT>
Method: GET
Response: 200 OK
Content-Type: application/json

{
  "isInTrial": true,
  "trialStartDate": "2026-02-17T00:00:00Z",
  "trialEndDate": "2026-03-03T00:00:00Z",
  "daysRemaining": 14,
  "tierLevel": "professional",
  "tierLimits": {
    "maxSkus": 2000,
    "maxUsers": 3
  }
}

# OR (if not in trial)

{
  "isInTrial": false,
  "tierLevel": "starter",
  "tierLimits": {
    "maxSkus": 500,
    "maxUsers": 1
  }
}
```

### POST /api/subscription/convert-trial

```
Authorization: Bearer <Clerk JWT>
Method: POST
Content-Type: application/json

Request Body:
{
  "stripePaymentMethodId": "pm_123abc",
  "billingCycle": "monthly"  # or "annual"
}

Response: 200 OK
{
  "status": "active",
  "tierLevel": "professional",
  "stripeSubscriptionId": "sub_123abc",
  "nextBillingDate": "2026-03-17T00:00:00Z",
  "amount": 99,
  "currency": "USD"
}

Response: 402 Payment Required
{
  "error": "Payment failed: Your card was declined"
}

Response: 400 Bad Request
{
  "error": "Not in a trial period"
}

Response: 403 Forbidden
{
  "error": "Only organization administrators can convert the trial"
}
```

### POST /webhooks/clerk

```
Method: POST
Content-Type: application/json
Headers: svix-id, svix-timestamp, svix-signature (verify)

# On user.created event:
{
  "type": "user.created",
  "data": {
    "id": "user_abc123",
    "email_addresses": [{ "email_address": "john@example.com" }],
    "unsafe_metadata": {
      "organizationName": "ABC Pharmacy",
      "trialPlan": "professional"
    }
  }
}

Handler Actions:
1. Validate email (not disposable)
2. Create Organization
3. Create User (linked to clerkUserId)
4. Create SubscriptionTier (trial)
5. Create Stripe Customer
6. Respond: 200 { "processed": true }
```

### POST /webhooks/stripe

```
Method: POST
Content-Type: application/json
Headers: stripe-signature (verify)

# On payment_intent.succeeded:
{
  "type": "payment_intent.succeeded",
  "data": { "object": { ... } }
}

Handler Actions:
1. Verify signature
2. Find SubscriptionTier by customer ID
3. Log TrialEvent
4. Respond: 200 { "received": true }
```

---

## 6. Error Handling

| Error | Scenario | Response | Action |
|-------|----------|----------|--------|
| Email not found | User attempts login before signup completes | 401 Unauthorized | Redirect to signup |
| Disposable email | User signs up with mailinator | 400 Bad Request | Show error, suggest real email |
| Already in trial | User tries to create 2nd org | 400 Bad Request | Show error, link to existing org |
| Payment declined | Card declined during conversion | 402 Payment Required | Show Stripe error, retry with different card |
| Not in trial | User tries to convert already-paid subscription | 400 Bad Request | Show error, link to billing settings |
| Unauthorized | Non-admin tries to convert trial | 403 Forbidden | Show error, suggest contact admin |
| Rate limited | User submits conversion 10x in 1 minute | 429 Too Many Requests | Show error, encourage single submission |
| Email service down | Reminder job fails to send email | 500 (logged, retried by job scheduler) | Alert ops via Sentry |
| Stripe API down | Conversion fails to reach Stripe | 503 Service Unavailable | Show error, encourage user to retry later |

---

## 7. Security & Compliance

- ✅ Clerk handles PCI compliance (no card data stored locally)
- ✅ Email uniqueness enforced by Clerk
- ✅ Authorization verified (org-user role check on sensitive endpoints)
- ✅ Webhook signatures verified (Clerk + Stripe)
- ✅ Transactions prevent race conditions
- ✅ Sensitive data not logged (Sentry config filters)
- ✅ Environment variables used for secrets (Clerk keys, Stripe API keys)
- ✅ Rate limiting on sensitive endpoints (conversion)

---

## 8. Success Metrics

By end of Phase 4A:

| Metric | Target | Notes |
|--------|--------|-------|
| Trial signup flow | <2s end-to-end | Clerk fast SSR |
| Conversion rate | >50% | Professional tier appeal |
| Reminder delivery | 99% | SendGrid reliability |
| Downgrade atomicity | 100% (no failures) | Transaction isolation verified |
| Payment success | 95%+ | Industry standard |
| Email idempotency | 100% (no duplicates) | sentRemindersAt tracking |

---

## Appendix: Clerk Integration Checklist

- [ ] Clerk account created
- [ ] OAuth providers configured (Google, Outlook)
- [ ] Webhook endpoint configured
- [ ] API keys in .env files
- [ ] Clerk SDK installed (frontend + backend)
- [ ] User signup flow tested
- [ ] JWT verification working
- [ ] Webhook signature verification working
- [ ] User metadata passed (org name, trial plan)
- [ ] PIN auth removed completely
- [ ] Clerk dashboard monitoring configured
