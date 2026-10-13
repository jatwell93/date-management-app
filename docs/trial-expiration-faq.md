# Trial Expiration FAQ

This FAQ answers common questions about the 30-day trial, what happens when it ends, and how to
keep your account working afterwards. The in-app trial FAQ (`frontend/src/components/TrialFAQ.tsx`)
says the same things in shorter form. For how the trial is built, see
[trial-system.md](./trial-system.md).

## Trial basics

### What is included in the trial?

For 30 days you have the **Professional plan**, with no card required:

- Up to 50,000 products (SKUs)
- Up to 10 users
- Up to 50,000 inventory items
- 10 GB of storage
- All reports and features of the Professional plan

### When does the trial start?

When your organization is created, at your first sign-in. The 30 days run from that moment, so
set up and import early to get the full benefit.

### How do I know when my trial ends?

A trial banner in the app shows the days left and has an upgrade button. The end date is the same
date and time your organization was created, 30 days later.

## What happens as the trial ends

### Reminder emails

You receive an email **10, 5 and 2 days before** the trial ends, and one email after it has ended.
Each says when the trial ends and what happens next.

### When the trial ends

Your organization moves to the **Free plan** straight away. There is no grace period.

- Your data is kept. Nothing is deleted.
- You can still sign in and view and update everything.
- The Free plan limits apply: 500 products, 1 user, 500 inventory items, 1 GB of storage.
- If you are over those limits, adding new items may be blocked until you upgrade or reduce
  usage.

## Upgrading

### Can I upgrade after the trial has ended?

Yes, at any time. Use the upgrade button in the app. Once your payment completes, the Professional
plan is restored and any block on adding items is lifted.

### What if I upgrade during the trial?

The paid subscription starts and you are charged straight away. The remaining trial days are not
carried over.

### What payment methods are accepted?

Credit and debit cards, processed by Stripe. Your card details are handled by Stripe and are not
stored on our servers.

### Can I cancel during the trial?

There is nothing to cancel during the trial. You have not been charged. Let it end and your
organization moves to the Free plan.

## Other questions

### Can I extend my trial?

Not from inside the app. If you need more time, contact support.

### Can I export my data?

There is no in-app export yet. If you are over a plan's limits, the API endpoint
`GET /api/products/export-excess` returns the products over the limit, not your whole catalogue.
For a full copy of your data, contact support.

### Will the reminder emails go to spam?

They can. Check your spam folder if you do not see them, and add the sender to your contacts.

## Related documentation

- [Trial System Guide](./trial-system.md): how the trial is implemented
- [Tier Downgrade Guide](./tier-downgrade-guide.md): handling tier changes
- [Subscription Tiers](./subscription-tiers.md): tier comparison
