# Trial Expiration FAQ

## Overview

This FAQ answers common questions about the 14-day trial period, expiration process, and what happens when your trial ends.

## Table of Contents

1. [Trial Basics](#trial-basics)
2. [Expiration Timeline](#expiration-timeline)
3. [After Expiration](#after-expiration)
4. [Account Recovery](#account-recovery)
5. [Common Questions](#common-questions)

---

## Trial Basics

### What is included in the trial?

During your 14-day trial, you have **full access to all Professional tier features**:

- ✅ Up to 2,000 SKUs (products)
- ✅ Up to 3 users
- ✅ Up to 20,000 inventory items
- ✅ 10 GB storage
- ✅ Multi-user collaboration
- ✅ Priority email support
- ✅ All reports and analytics

### When does the trial start?

Your trial starts **immediately** when you create your organization. The trial end date is set to 14 days from creation at midnight UTC.

### How do I know when my trial expires?

You'll see a **trial banner** at the top of every page showing:

- Days remaining until expiration
- Trial end date
- Quick upgrade button

You can also check your trial status in **Settings → Billing**.

---

## Expiration Timeline

### Day 1: Trial Starts

- Organization created with Professional tier limits
- Trial banner appears
- Full access to all features

### Days 10, 5, and 2: Reminder Emails

You'll receive reminder emails at:

- **Day 10** (4 days remaining)
- **Day 5** (2 days remaining)
- **Day 2** (1 day remaining)

Each email includes:

- Days remaining
- Upgrade link
- What happens if you don't upgrade

### Day 14: Trial Expires (Midnight UTC)

At midnight UTC on day 14:

- Trial status changes to "expired"
- Auto-downgrade to **Starter tier** begins
- You can still log in and access all data

### Day 15: Auto-Downgrade Complete

By day 15, your account is on the Starter tier:

- 500 SKU limit (down from 2,000)
- 1 user limit (down from 3)
- 5,000 inventory item limit (down from 20,000)
- 1 GB storage limit (down from 10 GB)

**If your usage exceeds Starter limits**, a **creation lock** is applied.

---

## After Expiration

### What happens to my data?

**Nothing is deleted.** All your products, inventory, users, and data remain accessible.

### What can I still do?

You retain full **read access** to everything:

- ✅ View all products and inventory
- ✅ Generate reports
- ✅ Export data
- ✅ View historical data

### What is blocked?

If you're over the Starter tier limits, **creation is blocked**:

- ❌ Adding new products
- ❌ Adding new inventory items
- ❌ Adding new users
- ❌ Uploading files that would exceed 1 GB

### How do I remove the creation lock?

You have two options:

**Option 1: Upgrade (Fastest)**

1. Go to **Settings → Billing**
2. Choose Professional ($29/month) or higher tier
3. Complete payment
4. Lock removed immediately

**Option 2: Reduce Usage**

1. Delete products to get below 500 SKUs
2. Or remove users to get to 1 user
3. Lock is automatically removed when within limits

See the [Tier Downgrade Guide](./tier-downgrade-guide.md) for detailed instructions.

---

## Account Recovery

### Grace Period

After trial expiration, you have a **48-hour grace period** to add a payment method without losing any data or functionality.

During the grace period:

- You can still upgrade without any interruption
- All Professional tier features remain available
- No creation lock is applied (even if over Starter limits)

### Converting After Expiration

You can upgrade at any time, even after:

- Trial has expired
- Account was downgraded to Starter
- Creation lock is active

Once you upgrade:

- Your tier limits are immediately restored
- Creation lock is automatically removed
- All features are re-enabled

### Reactivating a Canceled Account

If you previously canceled your subscription:

1. Log in to your account
2. Go to **Settings → Billing**
3. Click **Reactivate Subscription**
4. Your previous tier and data are restored

---

## Common Questions

### Q: Will I lose data when my trial expires?

**A**: No. Your data is never deleted due to trial expiration. You retain full read access to all products, inventory, and historical data. Only new creations are blocked if you exceed the Starter tier limits.

### Q: Can I extend my trial?

**A**: Trials cannot be extended. However, if you need more time, you can upgrade to the Starter tier (free) which gives you 500 SKUs indefinitely. You can upgrade to a paid tier later when ready.

### Q: What if I'm over the Starter limits when my trial expires?

**A**: A creation lock is applied. You cannot add new products/inventory until you either:

- Upgrade to a higher tier
- Delete excess products to get within 500 SKUs

### Q: Do I get a refund if I upgrade mid-trial?

**A**: When you upgrade during your trial, you are charged for the upcoming billing period. The trial remainder is not prorated, but you get immediate access to continued service without interruption.

### Q: Can I downgrade after upgrading?

**A**: Yes, you can change your tier at any time. However, if you have more products than the new tier allows, a creation lock will be applied. See the [Tier Downgrade Guide](./tier-downgrade-guide.md) for details.

### Q: What payment methods are accepted?

**A**: We accept all major credit cards via Stripe: Visa, Mastercard, American Express, Discover, and JCB.

### Q: Is my payment information secure?

**A**: Yes. We use Stripe for all payment processing. Your card details are never stored on our servers - they are handled securely by Stripe, which is PCI DSS compliant.

### Q: Can I cancel during the trial?

**A**: There's nothing to cancel during the trial - you haven't been charged. Simply let the trial expire and your account will convert to the free Starter tier.

### Q: What happens if I add a payment method on day 13?

**A**: If you add a payment method before the trial expires, your trial continues until day 14, then automatically converts to a paid subscription without any interruption or creation lock.

### Q: Can I export my data before the trial expires?

**A**: Yes! You can export your products at any time:

- Use **Settings → Export Data** for a full backup
- Or use the API: `GET /api/products/export-excess`

### Q: Will reminder emails go to spam?

**A**: Reminder emails are sent from noreply@yourdomain.com. Please add this to your contacts to ensure delivery. Check your spam folder if you don't see reminders.

### Q: Can I have multiple trials?

**A**: No. Each email address can only have one trial. Our system prevents trial abuse by tracking email addresses and organization IDs.

### Q: What if I need help during my trial?

**A**: During your trial, you have access to priority email support. Contact us at support@yourdomain.com or use the in-app chat.

---

## Technical Details

### Trial Events Logged

The system tracks these trial-related events:

| Event                 | When Logged                     |
| --------------------- | ------------------------------- |
| `trial_started`       | Organization created            |
| `trial_reminder_sent` | Days 10, 5, 2 before expiration |
| `trial_converted`     | User upgrades to paid tier      |
| `trial_expired`       | Trial end date reached          |
| `payment_confirmed`   | First successful payment        |

View these in **Settings → Activity Log**.

### Trial Conversion Tracking

We track conversion rates to improve our service. This includes:

- Trial start date
- Conversion date (if applicable)
- Selected tier after conversion
- Features used during trial

No personal or business data is shared with third parties.

---

## Related Documentation

- [Tier Downgrade Guide](./tier-downgrade-guide.md) - Handling tier changes
- [Subscription Tiers](./subscription-tiers.md) - Full tier comparison
- [SaaS Operational Runbook](./SAAS_OPERATIONAL_RUNBOOK.md) - Admin procedures

---

_Last updated: March 2026_
