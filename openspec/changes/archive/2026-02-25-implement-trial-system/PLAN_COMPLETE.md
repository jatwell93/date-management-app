# ✅ PLAN PHASE COMPLETE: Trial System with Clerk Auth

## Session Summary

Started: **Fresh review of trial system architecture** (identified 12 critical issues)  
Resolved: **All 12 issues fixed** via Clerk authentication + transaction-based design patterns  
Status: **PLAN phase artifacts updated**, ready for BUILD phase approval  
Validation: **✅ OpenSpec validation passed** (`implement-trial-system` valid)

---

## Issues Fixed

| # | Issue | Root Cause | Solution | Fixed By |
|---|-------|-----------|----------|----------|
| 1 | Auth model mismatch (PIN vs email/password) | System designed for PIN-only | Switch to Clerk (email/password + OAuth) | Clerk integration |
| 2 | Missing Stripe customer creation | Undefined when to create customer | Create customer at **org creation time** (Phase 1B), reuse for trial + conversion | addStripeCustomer() in Phase 3 |
| 3 | Wrong service method names | Design said `createTrialSubscription()` but code didn't exist | Implement `createTrialSubscription()`, `findTrialsNeedingReminders()`, `downgradeExpiredTrials()` | SubscriptionService (Phases 3, 5, 6) |
| 4 | Downgrade job missing email | Job not sending downgrade warning emails | Add `sendTrialDowngradeWarning()` to email service, call from job | EmailService + Job (Phase 6) |
| 5 | Race condition on simultaneous conversions | No atomic updates to prevent double-charge | Wrap both endpoints in `prisma.$transaction()` | Transactions (Phases 6, 7) |
| 6 | Phone field referenced but doesn't exist | Design required phone, User model didn't have it | Clerk provides email (verified), phone optional Phase 4A | Remove phone requirement |
| 7 | Timezone ambiguity for trial cutoff | "Day 14" could be interpreted as UTC/local/end-of-day | **Explicit**: trials end at 00:00 UTC, stored consistently | Design documentation |
| 8 | Email idempotency not tracked | Could send duplicate reminders if job retries | Add `sentRemindersAt` JSON field to TrialEvent tracking which days reminded | TrialEvent model (Phase 5) |
| 9 | Error handling gaps | Job could crash on email failure, missing Stripe error handling | Try/catch per reminder, log to Sentry, don't crash job | Job error handling (Phase 10) |
| 10 | Stripe payment intent not handled | Webhook integration missing | Add `POST /webhooks/stripe` for payment_intent confirmation | Phase 9 |
| 11 | Org-user authorization check missing | Non-admin users could convert org's trial | Add authorization check: verify user role='admin' in organization | ConvertTrial controller (Phase 7) |
| 12 | Idempotency tests not specified | Concurrent conversions + duplicate webhooks untested | Add integration tests: race conditions, webhook replays | Phase 11 (Testing) |

---

## Clerk Integration (Core Architectural Change)

### Why Clerk?
- **Managed Auth**: PCI compliance built-in (no card data locally)
- **Email Verification**: Automatic, prevents disposable + duplicate emails
- **OAuth**: Google/Outlook login with 1 click
- **Cost**: Free during Phase 4, scales to $25-100/month
- **Speed**: 5-minute setup vs Auth.js (1-2 weeks), Better Auth (5-10 min)
- **Timeline**: Perfect for Phase 4A this week

### What's Removed
- ❌ PIN-based auth entirely
- ❌ Phone field (not needed with Clerk email)
- ❌ Custom email verification logic

### What's Added
- ✅ Clerk SDK (frontend + backend)
- ✅ Webhook handler for user.created event
- ✅ JWT verification middleware
- ✅ OAuth providers (Google, Outlook)
- ✅ Additional disposable email check (Clerk + library)

---

## Updated Artifacts (All 4 Components)

### ✅ proposal.md (480 lines)
**New sections:**
- Clerk architecture decision documented
- Cost breakdown ($0 Phase 4, $25-100/month at scale)
- Decision deferred on ABN lookup (wait for abuse data)
- All 12 issues addressed in "What Changes" section
- Clerk integration checklist (Appendix)

### ✅ design.md (400 lines)
**Complete technical design:**
- Database schema: User (clerkUserId, email, no PIN), SubscriptionTier (stripeCustomerId added), TrialEvent (new)
- Service methods: `createTrialSubscription()`, `convertTrialToPaid()` (atomic with `$transaction()`), `downgradeExpiredTrials()` (atomic)
- Email templates: trial reminder, downgrade warning
- Scheduled job: Daily 00:00 UTC, with error handling + idempotency
- API design: GET /api/subscription/trial-status, POST /api/subscription/convert-trial, webhooks
- All 12 issue fixes mapped to design components

### ✅ tasks.md (350 lines, 12 phases)
**Phase-by-phase implementation checklist:**
- **1A:** Clerk setup & config
- **1B:** Schema migration (add clerkUserId, email, remove PIN, add trial fields)
- **1C:** Auth middleware & webhook handler
- **2:** Disposable email validation
- **3:** Trial subscription creation
- **4:** Trial status endpoint
- **5:** Reminder system + SendGrid
- **6:** Auto-downgrade (atomic)
- **7:** Trial conversion (atomic, with authorization)
- **8:** Frontend trial banner
- **9:** Stripe webhook integration
- **10:** Error handling & edge cases
- **11:** Testing (unit, integration, end-to-end, edge cases)
- **12:** Documentation & cleanup

All tasks include ✅ checkboxes, error handling, and testing requirements.

### ✅ spec.md (350 lines, BDD format)
**Complete behavioral specification:**
- Feature 1: Clerk signup (email/password, OAuth, disposable email rejection, duplicate email)
- Feature 2: Trial management (status display, reminders at days 10/5/2, idempotency, expiration + auto-downgrade, atomicity under load)
- Feature 3: Conversion (success path, payment declined, already converted, unauthorized user, race condition)
- Feature 4: Webhooks (payment intent, webhook signature verification)
- Database schema diagram (User, SubscriptionTier, TrialEvent)
- API spec (endpoints, request/response, error codes)
- Security checklist (PCI compliance, email uniqueness, authorization, webhook verification, transaction isolation, Sentry logging)

---

## Issues Fixed: Before → After

### Before (Original Plan)
```
❌ PIN-based auth system
❌ No authorization checks on trial endpoints
❌ Missing Stripe customer creation flow
❌ Undefined email reminder methods
❌ Unsafe concurrent conversion (no transactions)
❌ Email fields not in database
❌ Timezone ambiguity
❌ No idempotency tracking for emails
❌ Minimal error handling
❌ No payment intent handling
❌ Race condition on simultaneous conversions
❌ No idempotency tests
```

### After (Clerk + Transactions)
```
✅ Clerk auth (email/password + OAuth, verified)
✅ Authorization: User role='admin' verified in ConvertTrial
✅ Stripe customer created at org setup, reused for trial + conversion
✅ Email methods: findTrialsNeedingReminders(), sendTrialReminder(), sendTrialDowngradeWarning()
✅ Atomic: $transaction() wraps update + Stripe charge + logging
✅ Email/clerkUserId added to User model
✅ Timezone: Explicit 00:00 UTC, documented
✅ Idempotency: sentRemindersAt tracks sent reminders
✅ Error handling: Try/catch, Sentry alerts, job resilience
✅ Payment intent: Webhook handler (POST /webhooks/stripe)
✅ Race condition: Transaction isolation prevents double-charge
✅ Idempotency tests: Phase 11 includes race + webhook replay tests
```

---

## Approval Gate: Ready for BUILD Phase

**Prerequisites Met:**
- ✅ **proposal.md**: Decision rationale + Clerk choice explained
- ✅ **design.md**: Technical architecture complete, all 12 issues addressed
- ✅ **tasks.md**: 12-phase checklist with error handling + testing
- ✅ **spec.md**: BDD scenarios for happy path + edge cases (race conditions, payment failures)
- ✅ **OpenSpec validation**: `implement-trial-system` passes strict validation
- ✅ **Cost analysis**: Clerk free → $25-100/month (acceptable for user acquisition)
- ✅ **Timeline**: 2 weeks Phase 4A (auth migration + trial MVP) is achievable
- ✅ **Decision locked**: Clerk auth, Keeper SendGrid (both services), no ABN Phase 4

**Next Action**: User approval to proceed to BUILD phase.

---

## What's Ready to Build

1. **Clerk Integration** (2-3 days): SDK setup, webhook, JWT verification
2. **Database Migration** (1 day): User(clerkUserId, email), SubscriptionTier(stripeCustomerId, trial fields), TrialEvent table
3. **Trial Signup** (2 days): Clerk webhook → Org + User + Trial created, disposable email check
4. **Trial Management** (3 days): Status endpoint, reminder job, auto-downgrade
5. **Trial Conversion** (3 days): POST convert endpoint, atomic Stripe integration, authorization
6. **Frontend** (2 days): Trial banner, upgrade button, countdown
7. **Testing** (3 days): Unit + integration + end-to-end + race conditions

**Total Phase 4A**: 2 weeks (this week + next)

---

## Key Artifacts Ready for Review

All artifacts in: `c:\Users\josha\date-management-app\openspec\changes\implement-trial-system\`

- [proposal.md](proposal.md) → Strategy + Clerk decision
- [design.md](design.md) → Technical architecture
- [tasks.md](tasks.md) → Implementation checklist (12 phases)
- [spec.md](spec.md) → BDD scenarios + API spec
