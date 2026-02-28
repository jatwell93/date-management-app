---
title: Trial System Guide
phase: 5
week: 7
status: draft
---

# Trial Flow Overview

```
Signup → org starter (trial=true, trialEnd=+14d) → email welcome_trial
 ↳ Daily job checks trialEnd
    ↳ 3d before end → email trial_ending_soon
    ↳ At end:
        if payment provided → Checkout completes → subscription.created (professional)
        else → org locked (readOnlyMode) until card added
```

## Signup Flow

1. User creates account via Clerk → `/api/onboarding/create-org`.
2. Backend creates `Organization` row with `isTrial=true`, `trialEndDate` (UTC).
3. Stripe Checkout session optional – card may be added later.
4. Trial banner displayed on each page (`TrialBanner` component).

## Conversion Tracking

Metric | Source
-------|--------
`trial_started` | On org creation
`trial_converted` | `checkout.session.completed` webhook sets `isTrial=false`
`trial_expired` | Daily cron marks expired trials

Metrics sent to `UsageAnalyticsService` → exposed in Grafana dashboard.

## Abuse Prevention

- Max 1 trial per email (enforced by Email→User→Organization FK + unique index on `User.email` + `Organization.isTrial`).
- Disposable email detection via Kickbox API.
- IP rate limiting (signup route) 20 requests/24h.
- ReCAPTCHA Enterprise score < 0.3 → signup rejected.

## Grace Periods

If payment method added within 48 h after expiry, conversion proceeds without data loss.

## Read-Only Mode

When trial expires without conversion:
- `readOnlyMode=true` on org
- Mutating routes throw `TrialExpiredError`
- UI shows upgrade modal

## Configuration Flags

Env Var | Default | Description
--------|---------|------------
`TRIAL_LENGTH_DAYS` | `14` | Duration of free trial
`TRIAL_GRACE_HOURS` | `48` | Post-expiry grace period
`TRIAL_EMAIL_TEMPLATE_ID` | — | SendGrid template ID

## Local Testing

```bash
# Force cron check to run now
node scripts/trial/run-trial-cron.js --now

# Shorten trial length for local dev
export TRIAL_LENGTH_DAYS=1 && npm run dev
```
