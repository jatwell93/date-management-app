---
title: Trial System Guide
status: current
---

# Trial System

How a new organization's free trial works in the Cloudflare Worker (`workers/`). This describes
what the code does, with file references. User-facing wording lives in
[trial-expiration-faq.md](./trial-expiration-faq.md).

```
First sign-in → POST /api/organization/bootstrap
  → subscription_tiers row: professional, trialing, trial_end_date = now + 30 days
  → trial banner in the app (days left, upgrade button → /upgrade)
  → scheduled job `trial-emails`: reminders at 10, 5 and 2 days before the end date
  → trial_end_date passes: the organization is treated as Free (data kept)
  → pays at any time: Stripe Checkout → active subscription
```

## Start

- Created by `ensureTrialSubscription` (`workers/src/clerk/clerk-persistence.ts`) during
  organization bootstrap. It is idempotent: `ON CONFLICT DO NOTHING`, one row per organization.
- Tier `professional`, status `trialing`, no card required. The trial is a local state: there is
  no Stripe-side trial.
- Length is `PROFESSIONAL_TRIAL_DAYS` in `shared/types/subscription.ts` (30). The bootstrap SQL,
  the plan-comparison copy and the trial-conversion metric all read it. There is no environment
  variable.
- The 30 days start at bootstrap, not at first use. An organization that signs in and sets up
  slowly spends part of the trial before staff start scanning.

## Expiry

There is no cron that flips a trial to expired. Access is derived at request time from the stored
row by `deriveSubscriptionAccess` (`workers/src/subscription-status.ts`):

- `trialing` with `trial_end_date` in the past is lapsed (`trial-expired`) and the effective tier
  becomes `free`: 500 products, 1 user, 500 inventory items (`shared/types/subscription.ts`).
- There is no grace period after a trial. A 48-hour grace and a "read-only mode" appeared in the
  Express-era design and were never built in the Worker. The grace that does exist is for failed
  payments on a paid subscription (`past_due`).
- A trial with no `trial_end_date` cannot be judged expired and stays active.
- Data is never deleted by expiry.

## Enforcement is switched separately

Lapsing changes the effective tier. Refusing writes is controlled by flags in
`workers/wrangler.toml`, both currently `"false"` (measure-only):

| Flag                        | Effect when `"true"`                                                        |
| --------------------------- | --------------------------------------------------------------------------- |
| `SUBSCRIPTION_GATE_ENFORCE` | Creation is refused with 403 for an expired trial or a stored creation lock |
| `USAGE_LIMITS_ENFORCE`      | Creation over a tier's SKU, user or inventory cap is refused with 402       |

While both are off, an expired trial keeps working: the events `subscription_gate_blocked` and
`usage_limit_reached` are logged with `console.warn` so the effect of turning them on can be
measured first.

## Paying

- Checkout is a Stripe Checkout Session in subscription mode, cards only, started from `/upgrade`
  or `/subscription`.
- Subscribing mid-trial starts the paid subscription and charges immediately. Remaining trial days
  are not carried over.
- A first payment that has not completed does not replace the trial row, so a failed attempt on
  day 6 does not cut the trial short (`upsertSubscriptionFromStripe` in
  `workers/src/stripe/stripe-persistence.ts`).

## Emails

- The `trial-emails` job (`workers/src/scheduled/jobs/trial-emails.ts`) enqueues one email per
  organization per threshold: 10, 5 and 2 days before `trial_end_date`, and one "trial has ended"
  email inside a 3-day window after it (`TRIAL_REMINDER_THRESHOLDS`,
  `TRIAL_ENDED_LOOKBACK_DAYS`).
- The job does nothing unless **both** `RESEND_API_KEY` and `RESEND_FROM_EMAIL` are set, and the
  `NOTIFICATION_EMAIL_QUEUE` binding must exist. A deployment missing either sends no trial
  emails and logs a skip. Check this before starting a real trial.
- There is no welcome email.

## Operating a trial

There is no operator tool for trials. To extend one, update the row directly, against the right
database:

```sql
UPDATE subscription_tiers
SET trial_end_date = trial_end_date + INTERVAL '14 days', updated_at = NOW()
WHERE organization_id = '<organization id>' AND status = 'trialing';
```

The reminder job keys on `trial_end_date`, so reminders follow the new date.

## Metrics

`saas-metrics-snapshot` computes the trial conversion rate from
`trial_started_at + PROFESSIONAL_TRIAL_DAYS`. A trial that started under an earlier length is
dated by the current one, so changing the constant shifts the cohort of trials in flight at the
time.

## Not implemented

These appeared in earlier drafts of this guide and do not exist in the Worker: a `TRIAL_LENGTH_DAYS`
or `TRIAL_GRACE_HOURS` setting, read-only mode (`TrialExpiredError`), Kickbox or ReCAPTCHA
checks on signup, and `node scripts/trial/run-trial-cron.js`.
