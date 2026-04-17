# SaaS Operational Runbook

## Overview

This runbook documents the operational procedures for managing the SaaS subscription system, including dunning processes, tier management, and handling of payment failures.

## Table of Contents

1. [Dunning Process](#dunning-process)
2. [Subscription Lifecycle](#subscription-lifecycle)
3. [Tier Limits and Feature Gating](#tier-limits-and-feature-gating)
4. [Creation Lock Management](#creation-lock-management)
5. [Monitoring and Alerting](#monitoring-and-alerting)
6. [Troubleshooting Common Issues](#troubleshooting-common-issues)
7. [Emergency Procedures](#emergency-procedures)

## Dunning Process

### Overview

The dunning process automatically handles past-due subscriptions after a 7-day grace period.

### Process Flow

1. **Payment Failed (Day 0)**
   - Stripe sends `invoice.payment_failed` webhook
   - System sets subscription status to `past_due`
   - Records `pastDueSince` timestamp
   - Sends dunning email to customer
   - Logs audit event

2. **Grace Period (Days 1-7)**
   - Subscription remains active but marked as `past_due`
   - Customer can still access the service
   - Retry attempts may occur (Stripe handles this)

3. **Auto-Downgrade (Day 8+)**
   - Dunning job runs daily at 01:00 UTC
   - Finds subscriptions with `past_due` status and `pastDueSince` > 7 days
   - Auto-downgrades to Starter tier
   - Applies creation lock if usage exceeds Starter limits
   - Sends Sentry fatal alert
   - Logs audit event

### Key Components

- **Webhook Handler**: `handleInvoicePaymentFailed()` in `webhook.service.ts`
- **Dunning Job**: `dunning.job.ts`
- **Service Method**: `downgradeExpiredPastDue()` in `subscription.service.ts`

## Subscription Lifecycle

### States

1. `trialing` - Free trial period
2. `active` - Paid subscription in good standing
3. `past_due` - Payment failed, within grace period
4. `canceled` - Subscription canceled
5. `incomplete` - Initial payment failed
6. `incomplete_expired` - Initial payment not completed within 23 hours

### State Transitions

```
trialing → active (on successful payment)
trialing → starter (on trial expiration)
active → past_due (on payment failure)
past_due → active (on successful retry)
past_due → starter (after 7-day grace period)
any → canceled (on customer cancellation)
```

## Tier Limits and Feature Gating

### Tier Limits

| Tier         | max_skus  | max_users | max_inventory_items | storage_bytes |
| ------------ | --------- | --------- | ------------------- | ------------- |
| starter      | 500       | 1         | 5,000               | 1GB           |
| professional | 2,000     | 3         | 20,000              | 10GB          |
| premium      | unlimited | 10        | unlimited           | 100GB         |
| concierge    | unlimited | 10        | unlimited           | unlimited     |

### Feature Gates

- **POST /products** → `checkUsageLimit('max_skus')`
- **POST /inventory-items** → `checkUsageLimit('max_inventory_items')`
- **POST /users** → `checkUsageLimit('max_users')`
- \*_POST /uploads/_`→`checkUsageLimit('storage_bytes')`
- **GET /api/reports/analytics** → `requireFeature('advanced_analytics')`

## Creation Lock Management

### When Applied

1. **Tier Downgrade**: When current usage exceeds new tier limits
2. **Subscription Cancellation**: When usage exceeds Starter limits
3. **Dunning Auto-Downgrade**: When usage exceeds Starter limits

### Behavior

- Blocks creation of new products, inventory items, and users
- Does NOT affect reading or updating existing data
- Must be manually resolved by reducing usage or upgrading

### Resolution Steps

1. Check current usage: `SELECT * FROM organization_usages WHERE organization_id = ?`
2. Compare with tier limits
3. Options:
   - Delete excess items/products
   - Customer upgrades to higher tier
   - Support manually removes lock (emergency only)

## Monitoring and Alerting

### Sentry Alerts

1. **Fatal Level**: Dunning auto-downgrades
   - Trigger: Every organization auto-downgraded
   - Tags: `component:dunning`, `event:auto_downgrade`

2. **Error Level**: Job failures
   - Trigger: Dunning job fails
   - Tags: `component:dunning`, `event:job_failure`

3. **Warning Level**: Creation lock applied
   - Trigger: Lock applied due to usage exceeding limits
   - Tags: `component:feature_gate`, `event:lock_applied`

### Dashboard Metrics

1. Number of `past_due` subscriptions
2. Age of `past_due` subscriptions (by `pastDueSince`)
3. Organizations with creation locks
4. Tier distribution
5. Usage vs limits ratios

## Troubleshooting Common Issues

### Subscription Not Updating

**Symptoms**: Tier not reflecting in Stripe, limits not applied

**Steps**:

1. Check webhook logs: `grep "subscription.updated" /var/log/app.log`
2. Verify Stripe metadata includes `organizationId`
3. Check database: `SELECT * FROM subscription_tiers WHERE organization_id = ?`
4. Manually sync: `POST /api/admin/sync-subscription/{organizationId}`

### Creation Lock Stuck

**Symptoms**: Cannot create new items despite being within limits

**Steps**:

1. Check usage: `SELECT * FROM organization_usages WHERE organization_id = ?`
2. Check tier limits in `TIER_LIMITS`
3. Verify lock status: `SELECT isCreationLocked FROM organizations WHERE id = ?`
4. If incorrect, manually update: `UPDATE organizations SET isCreationLocked = false WHERE id = ?`

### Dunning Job Not Running

**Symptoms**: Past-due subscriptions not being downgraded

**Steps**:

1. Check scheduler logs: `grep "Dunning job" /var/log/app.log`
2. Verify job is registered: Check `scheduler.service.ts` initialization
3. Run manually: `node dist/jobs/dunning.job.js`
4. Check Sentry for job failure alerts

### Webhook Not Processing

**Symptoms**: Stripe events not updating database

**Steps**:

1. Check webhook URL in Stripe dashboard
2. Verify webhook secret: `STRIPE_WEBHOOK_SECRET` env var
3. Check webhook logs: `grep "Webhook received" /var/log/app.log`
4. Test with Stripe CLI: `stripe listen --forward-to localhost:3001/api/webhooks`

## Emergency Procedures

### Mass Grace Period Extension

If needed (e.g., payment processor outage):

```sql
-- Extend grace period by updating pastDueSince for affected orgs
UPDATE subscription_tiers
SET pastDueSince = datetime('now', '-3 days')
WHERE status = 'past_due'
AND pastDueSince < datetime('now', '-7 days');
```

### Bulk Unlock Organizations

For emergency situations:

```sql
-- Remove all creation locks
UPDATE organizations SET isCreationLocked = false;

-- Log the action
INSERT INTO audit_logs (organization_id, action, change_description)
SELECT id, 'emergency_unlock', 'Creation lock removed by emergency procedure'
FROM organizations;
```

### Manual Tier Adjustment

For specific customer issues:

```sql
-- Update subscription tier
UPDATE subscription_tiers
SET tierLevel = 'professional', status = 'active'
WHERE organization_id = 'CUSTOMER_ORG_ID';

-- Update usage limits
UPDATE organization_usages
SET maxSkus = 2000, maxUsers = 3, maxInventoryItems = 20000
WHERE organizationId = 'CUSTOMER_ORG_ID';
```

## Important Notes

1. **Never directly modify Stripe subscription IDs** - always use the Stripe API
2. **Always log manual interventions** in audit_logs table
3. **Test changes in staging first** - use test Stripe keys
4. **Back up database before bulk operations**
5. **Communicate with customers** before manual tier changes

## Contact Information

- **Engineering Lead**: [Contact info]
- **Product Team**: [Contact info]
- **Customer Support**: [Contact info]

## Related Documents

- [Stripe Configuration Guide](../backend/docs/stripe-setup.md)
- [Database Schema](../backend/prisma/schema.prisma)
- [API Documentation](../backend/docs/api/)
- [Feature Gate Implementation](../backend/src/middleware/feature-gate.middleware.ts)
