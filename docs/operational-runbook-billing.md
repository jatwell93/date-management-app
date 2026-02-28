---
title: Operational Runbook — Billing & Subscriptions
phase: 5
week: 7
status: draft
---

# Purpose

Provide actionable **SOPs** for on-call engineers handling billing incidents: Stripe webhooks, trial expirations, over-limit downgrades, payment failures.

## PagerDuty Rotation

- Escalation policy *Billing-Critical*: L1 engineering → L2 engineering → CTO.
- Runbook URL pinned in PagerDuty service description.

## Common Alerts & Remedies

| Alert Name | Trigger | Immediate Action | Follow-up |
|------------|---------|------------------|-----------|
| `webhook_failure_rate` > 5 % | Sentry breadcrumb `webhook-error` count / 5 m window | 1. Acknowledge <5 m. 2. Check `SENTRY_EVENT_ID` for stack trace. 3. Inspect `/var/log/app/webhook-error.log`. | Deploy hotfix if code bug; otherwise retry events via Stripe Dashboard → **Developers > Webhooks > Retry**. |
| `payment_failure_rate` > 2 % | Stripe `invoice.payment_failed` in >2 % orgs last 1 h | 1. Verify Stripe status page. 2. If global Stripe outage, set statuspage incident. | After Stripe recovery, rerun dunning job: `npm run jobs:dunning-now`. |
| `trial_conversion_rate` < 10 % | Grafana metric | Check email deliverability (SendGrid stats) & banner visibility. | Coordinate with Growth team. |
| Downgrade Warning Email Bounce | SendGrid event `bounce` w/ template `downgrade_warning` | 1. Create Zendesk ticket to manually contact customer. | Remove invalid address; flag for CRM update. |

## Webhook Troubleshooting Checklist

1. Locate `eventId` in Sentry → tags show `stripe_event_id` + `organizationId`.
2. SSH to pod or view CloudRun logs → search `eventId`.
3. If idempotency violation: ensure `ProcessedWebhookEvent` row exists; else insert & reprocess.
4. Manually replay via:
   ```bash
   stripe events resend evt_123 --forward-to $WEBHOOK_URL
   ```

## Trial Expiry Procedure

1. Daily cron `jobs/trial-expiry.ts` marks expired trials.
2. If job fails:
   ```bash
   npm run jobs:trial-expiry-now
   ```
3. Verify read-only mode set: `SELECT readOnlyMode FROM "Organization" WHERE id=$ORG;`.
4. Customer converts: webhook clears `readOnlyMode` automatically.

## Over-Limit Downgrade Flow

- Job `jobs/usage-check.ts` runs hourly.
- If org remains over limit 7 d after downgrade, sets `readOnlyMode` + queues `downgrade_lock` email.
- Unlock manually:
  ```sql
  UPDATE "Organization" SET readOnlyMode=false WHERE id=$ORG;
  ```
  then ask customer to upgrade tier.

## Emergency Disable Billing

If Stripe outage threatens core operations:
1. Set env `BILLING_DISABLED=true` via config rollout.
2. Feature flag prevents webhook errors from blocking requests.
3. Post-incident: unset flag, replay missed events.

---

_Last updated: Feb 2026_
