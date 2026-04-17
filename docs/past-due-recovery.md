# Past Due Recovery Guide

## Overview

When a payment fails, your subscription enters a `past_due` status. This guide explains the 7-day dunning process, what access you retain, and how to resolve the payment issue to avoid automatic downgrade.

## Table of Contents

1. [Understanding Past Due](#understanding-past-due)
2. [The 7-Day Timeline](#the-7-day-timeline)
3. [Payment Recovery Options](#payment-recovery-options)
4. [After Auto-Downgrade](#after-auto-downgrade)
5. [Prevention Strategies](#prevention-strategies)
6. [FAQ](#faq)

---

## Understanding Past Due

### What Triggers Past Due Status?

Your subscription becomes `past_due` when:

- Automatic renewal payment fails
- Card on file is declined
- Card has expired
- Insufficient funds
- Bank rejects the charge

### What You'll Receive

When payment fails:

1. **Immediate**: Email notification with payment update link
2. **Dashboard**: Warning banner appears
3. **Within 24 hours**: Dunning email with invoice link
4. **Days 1-7**: Continued access while in grace period

### What Access Do I Keep?

During the 7-day grace period:

- ✅ Full access to all features
- ✅ Can create new products/inventory
- ✅ All users remain active
- ✅ No creation lock applied

---

## The 7-Day Timeline

### Day 0: Payment Fails

```
Timeline
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Day 0   Payment attempt fails
        ↳ Status: past_due
        ↳ Email sent immediately
        ↳ Access: Full (grace period begins)
```

**System Actions**:

- `invoice.payment_failed` webhook received
- Subscription status set to `past_due`
- `pastDueSince` timestamp recorded (first failure only)
- Dunning email queued via SendGrid

**Your Actions**:

- Check email for payment failure notification
- Update payment method if card expired
- Ensure sufficient funds available

### Days 1-7: Grace Period

```
Days 1-7  Stripe auto-retries payment
          ↳ Retries: Days 1, 3, 5 (configurable in Stripe)
          ↳ Access: Full (no restrictions)
          ↳ Status: past_due (active but unpaid)
```

**During this period**:

- Your account functions normally
- Users can continue working
- All features remain available
- Stripe automatically retries the payment

**Check Status**:

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://api.yourdomain.com/api/subscription/status
```

Response:

```json
{
  "status": "past_due",
  "pastDueSince": "2026-03-01T10:30:00Z",
  "daysUntilDowngrade": 5,
  "tier": "professional"
}
```

### Day 8: Auto-Downgrade (If Unresolved)

```
Day 8+    Auto-downgrade to Starter
          ↳ Status: active (downgraded)
          ↳ Tier: Starter
          ↳ Creation lock if over limits
```

**System Actions**:

- Dunning job runs daily at 01:00 UTC
- Finds subscriptions with `past_due` > 7 days
- Downgrades to Starter tier
- Applies creation lock if usage exceeds Starter limits
- Sends Sentry fatal alert
- Logs audit event

**Impact**:

- Tier limits reduced to Starter (500 SKUs, 1 user)
- If over limits: creation lock applied
- All data retained
- Can upgrade anytime to restore access

---

## Payment Recovery Options

### Option 1: Update Payment Method (Recommended)

1. Go to **Settings → Billing**
2. Click **Update Payment Method**
3. Enter new card details
4. Stripe automatically retries the failed payment
5. Subscription returns to `active` status

**Time to resolve**: Immediate (payment retries within minutes)

### Option 2: Pay Open Invoice

1. Check email for invoice link
2. Or go to **Settings → Billing → Invoices**
3. Click **Pay Now** on the failed invoice
4. Complete payment via Stripe hosted page

**Time to resolve**: Immediate

### Option 3: Contact Support

If you believe the charge was incorrect:

1. Email support@yourdomain.com
2. Include your organization ID
3. Describe the payment issue
4. Support can extend grace period if needed

**Time to resolve**: 24-48 hours

### Option 4: Bank/Card Issues

If your bank is blocking the charge:

1. Contact your bank to authorize charges from "[Your Company Name]"
2. Update payment method with new card if needed
3. Request manual retry from support

---

## After Auto-Downgrade

### Immediate Effects

If payment wasn't resolved by day 8:

- Account downgraded to Starter tier
- Limits: 500 SKUs, 1 user, 5,000 inventory items
- If over any limit: creation lock applied

### Recovery Steps

**Step 1: Check Current Status**

```sql
-- As admin or via API
SELECT status, tier_level, past_due_since
FROM subscription_tiers
WHERE organization_id = 'YOUR_ORG_ID';
```

**Step 2: Update Payment Method**
Even if downgraded, update your payment method to prevent future issues.

**Step 3: Upgrade to Restore Access**

1. Go to **Settings → Billing**
2. Select your previous tier (or new tier)
3. Complete payment
4. Limits restored immediately
5. Creation lock removed (if applied)

**Step 4: Resolve Creation Lock (If Applicable)**

If you were downgraded and are over Starter limits:

| Scenario               | Action                                                |
| ---------------------- | ----------------------------------------------------- |
| Have 501-2000 products | Upgrade to Professional to restore access             |
| Have 2000+ products    | Upgrade to Premium or delete excess products          |
| Have 2+ users          | Remove extra users OR upgrade to allow multiple users |

See [Tier Downgrade Guide](./tier-downgrade-guide.md) for detailed resolution steps.

---

## Prevention Strategies

### Keep Payment Method Current

1. **Enable notifications**: Ensure billing emails aren't marked as spam
2. **Monitor expiration**: Update card before expiration date
3. **Use business card**: Avoid personal cards that may be replaced

### Monitor Subscription Status

**Set up alerts**:

```bash
# Check subscription health weekly
curl -H "Authorization: Bearer TOKEN" \
  https://api.yourdomain.com/api/subscription/status | jq .
```

**Dashboard metrics** to watch:

- Subscription status (should be "active")
- Current period end date
- Payment method expiration

### Enable Automatic Recovery

Stripe automatically retries failed payments:

- Retry 1: 1 day after failure
- Retry 2: 3 days after failure
- Retry 3: 5 days after failure

No action needed if funds become available.

### Grace Period Extension (Emergency)

If you need more time (e.g., waiting for funds to clear):

**Contact support** to request extension.

**Admin can extend** (emergency only):

```sql
-- Extend grace period by 3 days
UPDATE subscription_tiers
SET past_due_since = datetime('now', '-3 days')
WHERE organization_id = 'YOUR_ORG_ID';

-- Log the extension
INSERT INTO audit_logs (organization_id, action, change_description)
VALUES ('YOUR_ORG_ID', 'grace_period_extended',
        'Grace period manually extended by support');
```

---

## FAQ

### Q: Will I lose data if my subscription goes past due?

**A**: No. Your data is never deleted due to payment issues. You retain full read access to all products, inventory, and historical data throughout the grace period and after downgrade.

### Q: Can I use the system while past due?

**A**: Yes! During the 7-day grace period, you have full access to all features. No restrictions are applied until auto-downgrade on day 8 (and only then if over Starter limits).

### Q: What if I pay on day 7?

**A**: If payment succeeds before the dunning job runs on day 8, your subscription returns to `active` status immediately and no downgrade occurs.

### Q: Can I prevent auto-downgrade?

**A**: Yes, by resolving the payment issue within 7 days:

- Update payment method
- Pay open invoice
- Contact support for extension

### Q: What if I'm on annual billing?

**A**: The same 7-day grace period applies regardless of billing cycle (monthly or annual).

### Q: Do I get a refund for the failed period?

**A**: If you resolve payment within 7 days, no service interruption occurs. If downgraded and then upgrade, you pay for the new period going forward - no refunds for the past_due period.

### Q: Can I downgrade voluntarily instead of going past due?

**A**: Yes! If you want to reduce costs, downgrade via Settings → Billing before the payment fails. This avoids the past_due status and gives you control over timing.

### Q: What happens to my users during past due?

**A**: All users remain active during the grace period. If auto-downgraded to Starter (1 user limit), additional users are deactivated but can be reactivated upon upgrade.

### Q: Will my customers/patients know my subscription is past due?

**A**: No. The past_due status is internal. Your users see normal functionality during the grace period. After downgrade, they simply see the reduced tier limits.

### Q: Can I export data while past due?

**A**: Yes. You can export your data at any point - during grace period, after downgrade, or anytime. Your data is always accessible.

### Q: What if my bank is blocking the charge?

**A**: Contact your bank to authorize charges from us. You can also:

- Try a different card
- Use a bank transfer (contact support)
- Request an invoice for manual payment

### Q: Is there a late fee?

**A**: No. We don't charge late fees or penalties for past due subscriptions.

### Q: Can I reactivate after cancellation?

**A**: Yes. You can reactivate at any time via Settings → Billing. Your data is preserved.

---

## Technical Reference

### Database Schema

**subscription_tiers table**:

```sql
SELECT
  status,              -- 'active', 'past_due', 'canceled', 'trialing'
  past_due_since,      -- timestamp of first failure
  tier_level,          -- 'starter', 'professional', 'premium', 'concierge'
  current_period_end,  -- next billing date
  stripe_subscription_id
FROM subscription_tiers
WHERE organization_id = 'YOUR_ORG_ID';
```

**organizations table**:

```sql
SELECT
  is_creation_locked   -- true if over limits after downgrade
FROM organizations
WHERE id = 'YOUR_ORG_ID';
```

### API Endpoints

**Check subscription status**:

```bash
GET /api/subscription/status
Authorization: Bearer TOKEN
```

**Update payment method** (via Stripe Checkout):

```bash
POST /api/billing/update-payment-method
Authorization: Bearer TOKEN
```

**Get invoices**:

```bash
GET /api/billing/invoices
Authorization: Bearer TOKEN
```

### Webhook Events

The following Stripe webhooks relate to past due:

| Event                           | Handler                      | Action                           |
| ------------------------------- | ---------------------------- | -------------------------------- |
| `invoice.payment_failed`        | `handleInvoicePaymentFailed` | Sets past_due, sends email       |
| `invoice.payment_succeeded`     | (Automatic)                  | Clears past_due, restores active |
| `customer.subscription.updated` | `handleSubscriptionUpdated`  | Syncs status changes             |

### Dunning Job

**Schedule**: Daily at 01:00 UTC

**Location**: `backend/src/jobs/dunning.job.ts`

**Logic**:

```typescript
// Find subscriptions past due > 7 days
const expiredPastDue = await prisma.subscriptionTier.findMany({
  where: {
    status: 'past_due',
    pastDueSince: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
  },
});

// Auto-downgrade each
for (const sub of expiredPastDue) {
  await subscriptionService.downgradeExpiredPastDue(sub.organizationId);
}
```

---

## Related Documentation

- [Tier Downgrade Guide](./tier-downgrade-guide.md) - After downgrade handling
- [Trial Expiration FAQ](./trial-expiration-faq.md) - Trial-related questions
- [SaaS Operational Runbook](./SAAS_OPERATIONAL_RUNBOOK.md) - Admin procedures
- [Stripe Integration](./stripe-integration.md) - Payment setup

---

_Last updated: March 2026_
