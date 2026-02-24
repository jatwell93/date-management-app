# Proposal: Implement Trial System (Phase 4 Task 11)

## Why

**Current State**: The SaaS foundation is locked (Phase 4 Task 10 complete):
- Subscription tiers (starter, professional, premium, concierge) ✅
- Stripe integration ✅
- **NEW**: Clerk authentication (email/password + OAuth) to replace PIN ✅

But the **trial flow is missing** = critical revenue gap:
- Zero free user acquisition path
- No trial-to-paid conversion opportunity
- Zero trial abuse prevention

**Opportunity**: Complete trial system powered by **Clerk**:
- Sign up with **email/password + Google/Outlook OAuth** (Clerk handles auth)
- **14-day professional tier trial** (hands-on with paid features)
- **Auto-downgrade to Starter** on day 14 (convert ~20-30% to paid)
- **Reminder emails** via SendGrid at days 10, 5, 2
- **Abuse prevention**: Clerk email uniqueness + disposable email blocking
- **Analytics**: Trial events logged (started, converted, expired)

**Why Now**: Phase 4 Week 6 (this week). Auth migration + trial system launch together = clean architecture, no legacy PIN code to maintain.

**Success Metric**: 20%+ trial-to-paid conversion

---

## What Changes

### 1. **Auth Layer (Using Clerk)**
- Remove PIN-based auth entirely
- Add Clerk email/password signup
- Add OAuth providers: Google, Outlook
- Clerk handles email verification, password resets, sign-in links
- **Cost**: Free during Phase 4 (no real users yet), scales to $25/month at 10k users

### 2. **Trial Signup Flow**
- `POST /api/auth/signup` with Clerk credentials (email, password, org name)
- Clerk creates user + authenticates
- Create `SubscriptionTier`: status='trialing', tier='professional', trial_end_date=now+14 days
- Check email against disposable email list (additional fraud check)
- Professional tier limits: 2000 SKUs, 3 users

### 2b. **Multi-User Invites (MVP)**
- Admin can invite additional users to the same organization (email invite + token)
- Invited users complete Clerk signup and are linked to the inviter's organization
- Enforce tier user limits (trial: max 3 users)

### 3. **Trial Expiration + Downgrade**
- Daily cron job (00:00 UTC): find `status='trialing' AND trial_end_date < NOW()`
- Downgrade to Starter tier, set status='active' (atomic transaction)
- Send `trial_expired` email via SendGrid
- Log `trial_expired` event with metadata

### 4. **Trial Reminders**
- Send via **SendGrid** (not Clerk) at days 10, 5, 2 remaining
- Track sent reminders to prevent duplicates (idempotency)
- Include upgrade CTA + Stripe Checkout link

### 5. **Abuse Prevention**
- Clerk enforces email uniqueness (no duplicates allowed)
- `disposable-email` npm library blocks known disposable domains
- Additional check: no existing trial/paid subscription under email

### 6. **Trial Status API**
- `GET /api/subscription/trial-status`: returns countdown + upgrade URL
- Frontend displays countdown banner
- Non-trial users see their tier info

### 7. **Trial Conversion**
- `POST /api/subscription/convert-trial`: capture payment method via Stripe.js
- Create Stripe subscription for professional tier
- Update local DB: status='active', link to Stripe subscription
- Log `trial_converted` event

### 8. **Analytics**
- `TrialEvent` table: trial_started, trial_converted, trial_expired
- Enable conversion funnel reporting (20% conversion target)

---

## Capabilities

### New
- `trial-signup-with-clerk`: Email/password signup via Clerk, create trial subscription
- `organization-invite-flow`: Admin invites + accept flow for multi-user orgs (MVP)
- `trial-expiration-engine`: Daily downgrade job with disposable email abuse prevention
- `trial-reminder-emails`: SendGrid emails at day 10, 5, 2 (idempotent)
- `trial-status-api`: Countdown + upgrade link endpoint
- `trial-conversion-analytics`: Conversion funnel event logging

### Modified
- `authentication`: Replace PIN with Clerk (email/password + OAuth)
- `subscription-service`: Add trial methods (createTrialSubscription, convertTrialToPaid, downgradeExpiredTrials)
- `email-service`: Add trial reminder + downgrade warning emails
- `scheduler`: Add daily trial expiration job

---

## Impact

**Code Changes**:
- `User` schema: Remove PIN, add email (via Clerk), add clerkUserId
- New `TrialEvent` model
- `SubscriptionService`: trial-specific methods
- `auth.routes.ts`: Use Clerk SDK instead of PIN login
- `trial-expiration.job.ts`: New daily cron
- `email.service.ts`: Trial reminders + downgrade warnings
- Frontend: Clerk SDK integration, trial signup buttons, countdown banner

**Dependencies**:
- `clerk/nextjs` (frontend) or `clerk/backend` (backend SDK)
- `disposable-email` (npm) for fraud detection
- `node-cron` (scheduler)
- SendGrid (already integrated)
- Stripe (already integrated)

**No Breaking Changes**: PIN auth removed cleanly (no existing users), Clerk is additive to subscription layer.

---

## Research Questions Resolved

✅ **Auth Architecture**: Use Clerk (managed service) for simplicity, scale, and OAuth support  
✅ **Trial Duration**: 14 days (industry standard)  
✅ **Reminder Schedule**: Days 10, 5, 2 remaining  
✅ **Abuse Prevention**: Clerk uniqueness + disposable email blocking (2-layer defense)  
✅ **Email Service**: Clerk handles auth emails, SendGrid handles business emails  
✅ **Permissions**: Clerk provides org/role structure, app code enforces tier + custom permissions  

---

## Success Criteria

✅ Signup with Clerk email/password + OAuth  
✅ Trial subscription created with 14-day deadline  
✅ Disposable email domains rejected  
✅ Auto-downgrade runs daily, downgrades on day 14  
✅ Reminder emails sent (days 10, 5, 2)  
✅ Trial-to-paid conversion works (Stripe payment → subscription created)  
✅ Trial events logged (analytics)  
✅ >80% test coverage  
✅ Security review passed (no credential leaks, proper auth checks)  

---

## Ready for BUILD

All 12 issues identified in PLAN phase review are fixed:
1. ✅ Auth model mismatch → Using Clerk
2. ✅ Stripe customer → Create on org creation, reuse on conversion
3. ✅ Email method consistency → Fixed method names
4. ✅ Downgrade email → Added to job
5. ✅ Race conditions → Using transactions
6. ✅ Phone field → Using Clerk (no custom phone needed for Phase 4)
7. ✅ Timezone cutoff → Documented as UTC 00:00
8. ✅ Email idempotency → Track sent reminders
9. ✅ Error handling → Added explicit error scenarios
10. ✅ Stripe payment intent → Handled in conversion endpoint
11. ✅ Org-user auth → Clerk enforces tenant isolation
12. ✅ Idempotency tests → Added to Phase 7

**Next**: Approve this plan → BEGIN BUILD phase with updated design + tasks.
