---
title: Operational Runbook — Billing & Subscriptions
phase: 5
week: 7
status: draft
---

# Purpose

Provide actionable **SOPs** for on-call engineers handling billing incidents: Stripe webhooks, trial expirations, over-limit behavior, payment failures.

All of this runs in the Cloudflare Worker (`workers/`). The earlier Express jobs (`jobs/trial-expiry.ts`, `usage-check.ts`, the dunning job) and the `readOnlyMode` flag are retired; see [`stripe-integration.md`](./stripe-integration.md) and [`past-due-recovery.md`](./past-due-recovery.md) for how the Worker behaves today.

## PagerDuty Rotation

- Escalation policy _Billing-Critical_: L1 engineering → L2 engineering → CTO.
- Runbook URL pinned in PagerDuty service description.

## Common Alerts & Remedies

| Alert Name                     | Trigger                                                 | Immediate Action                                                                                                                                           | Follow-up                                                                                                   |
| ------------------------------ | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `webhook_failure_rate` > 5 %   | `webhook_metrics` failures per event type, or Sentry    | 1. Acknowledge <5 m. 2. Find the event in Sentry. 3. Run `npm run diagnose:webhook` and `npm run tail:prod --prefix workers`.                              | Deploy hotfix if code bug; otherwise retry events via Stripe Dashboard → **Developers > Webhooks > Retry**. |
| `payment_failure_rate` > 2 %   | Subscriptions entering `past_due` in the last hour      | 1. Verify Stripe status page. 2. If global Stripe outage, set a status page incident.                                                                      | After Stripe recovery, the daily `stripe-reconciliation` job repairs drift; replay missed events if needed. |
| `trial_conversion_rate` < 10 % | `saas-metrics-snapshot` job output / metrics            | Check email deliverability (Resend dashboard) and banner visibility.                                                                                       | Coordinate with Growth team.                                                                                |
| Email delivery failures        | Messages in the `notification-emails` dead-letter queue | 1. Check the Resend dashboard for bounces and suppressions. 2. Check `RESEND_API_KEY` and `RESEND_FROM_EMAIL`. 3. Contact the customer manually if needed. | Remove invalid address; flag for CRM update.                                                                |

## Webhook Troubleshooting Checklist

1. Locate the Stripe event id in Sentry (tags carry the event id and organization).
2. Inspect the delivery and its claim with `npm run diagnose:webhook` (read-only), or tail logs: `npm run tail:prod --prefix workers`.
3. A claim in `processed_webhook_events` with `completed_at IS NULL` older than 60 seconds belongs to a delivery that died; the next Stripe retry takes it over. Do not insert or edit ledger rows by hand.
4. Manually replay via:
   ```bash
   stripe events resend evt_123 --forward-to $WEBHOOK_URL
   ```

## Trial Expiry Procedure

1. Trial state is derived from `trial_end_date` at request time (`workers/src/subscription-status.ts`). No job marks trials expired.
2. The daily `trial-emails` job enqueues reminders (10, 5 and 2 days) and a trial-ended notice. If emails stop, check the job and the queue:
   - Job history: `SELECT * FROM scheduled_job_runs WHERE job_name = 'trial-emails';`
   - To stop all scheduled jobs: set the Worker secret `SCHEDULED_JOBS_DISABLED=true`.
3. Refusing creation for a lapsed trial happens only when `SUBSCRIPTION_GATE_ENFORCE=true`; it defaults to off (measure only).
4. Customer converts: Stripe sends `customer.subscription.updated` and the Worker updates the subscription row.

## Over-Limit Behavior

- Per-tier limits are checked by counting rows in the statement that inserts (`workers/src/utils/usage-limits.ts`). Over-cap writes are refused only when `USAGE_LIMITS_ENFORCE=true`; it defaults to off (measure only).
- There is no `readOnlyMode` flag and no hourly usage job. To lift a refusal for a customer, fix the cause: raise their tier in Stripe, or reduce usage.

## Emergency Disable Billing

If a Stripe outage threatens core operations:

1. Leave `SUBSCRIPTION_GATE_ENFORCE` and `USAGE_LIMITS_ENFORCE` off (or unset them) so a billing problem cannot block customers.
2. Stripe webhooks are independent of normal requests; a failing webhook does not block API traffic.
3. To stop scheduled billing work, set `SCHEDULED_JOBS_DISABLED=true`.
4. Post-incident: restore the settings, then replay missed events from the Stripe Dashboard. The daily `stripe-reconciliation` job also repairs drift.

---

_Last updated: Oct 2026_
