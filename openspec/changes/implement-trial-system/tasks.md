# Implementation Tasks: Trial System (Phase 4A - Clerk Auth + Trial MVP)

## Phase 1A: Clerk Setup & Configuration

- [x] Confirm Clerk.com account created and app initialized
- [x] Verify Clerk application configured in console:
  - [x] Email/password authentication enabled
  - [x] Username field enabled (required for audit logs)
  - [x] Google OAuth provider configured
  - [x] Microsoft OAuth provider configured
- [x] Get Clerk API keys from dashboard:
  - [x] `REACT_APP_CLERK_PUBLISHABLE_KEY` (frontend .env)
  - [x] `CLERK_SECRET_KEY` (backend .env)
  - [x] `CLERK_WEBHOOK_SIGNING_SECRET` (for webhook verification) **NOTE** Configured at https://play.svix.com/in/e_XYN9vGi7uhZhk4ISNivRFm5dYZp/ for testing
- [x] Install Clerk packages:
  - [x] Frontend: `npm install @clerk/clerk-react@latest` (in frontend/)
  - [x] Backend: `npm install @clerk/backend` (in backend/)
- [x] Frontend setup:
  - [x] Wrap app with `<ClerkProvider>` at top level (index.tsx)
  - [x] Set `REACT_APP_CLERK_PUBLISHABLE_KEY` in `.env.example`
  - [ ] Test Clerk auth UI locally (SignUp component renders)
- [x] Backend setup:
  - [x] Create `src/middleware/clerk-auth.middleware.ts` to verify JWTs
  - [x] Set `CLERK_SECRET_KEY` + `CLERK_PUBLISHABLE_KEY` + `CLERK_WEBHOOK_SECRET` in `.env.example`
  - [x] Test JWT verification with unit tests (9 test cases passing)
- [ ] Clerk webhook configuration:
  - [ ] Create webhook endpoint: `POST /webhooks/clerk`
  - [ ] Get Clerk webhook signing secret
  - [ ] Configure webhook in Clerk dashboard to point to backend
  - [ ] Verify webhook signature verification working
- [ ] End-to-end local test:
  - [ ] Sign up new user via React SignUp component (email/password)
  - [ ] Verify Clerk webhook received on backend
  - [ ] Verify User + Organization records created in database
  - [ ] Verify JWT contains username field

## Phase 1B: Schema Migration (Database)

- [ ] Add `clerkUserId` (STRING, UNIQUE) column to `users` table
- [ ] Add `email` (STRING, UNIQUE) column to `users` table
- [ ] Add `username` (STRING, UNIQUE) column to `users` table (**for audit logging**)
- [ ] Remove `pin` (VARCHAR) column from `users` table
- [ ] Create `organization_invites` table (id, organizationId, email, role, token, status, expiresAt, acceptedAt, invitedByUserId, createdAt)
- [ ] Add `stripeCustomerId` (STRING) column to `subscription_tiers` table
- [ ] Add `trialEndDate` (DATETIME, NULLABLE) column to `subscription_tiers` table
- [ ] Add `trialStartedAt` (DATETIME, NULLABLE) column to `subscription_tiers` table
- [ ] Add `trialConvertedAt` (DATETIME, NULLABLE) column to `subscription_tiers` table
- [ ] Create `trial_events` table (id, organizationId, eventType, occurredAt, metadata JSON, sentRemindersAt JSON, indexes on organizationId/eventType/occurredAt)
- [ ] Update Prisma schema to reflect all changes
- [ ] Run migration: `npx prisma migrate dev --name add_clerk_auth_trial_system`
- [ ] Verify migration in staging (no data loss for existing orgs with placeholders)

## Phase 1C: Auth Middleware & Routes (Clerk Integration)

- [ ] Create `src/middleware/clerkAuth.ts`: Extract userId + org from Clerk JWT in all protected routes
- [ ] Update `src/routes/auth.ts`:
  - [ ] Remove PIN login endpoint (`POST /auth/login`)
  - [ ] Remove PIN-based controller logic
  - [ ] Add `POST /auth/refresh` for JWT refresh (if needed)
  - [ ] Add `POST /auth/logout` endpoint
- [ ] Create `src/routes/webhook.ts`:
  - [ ] `POST /webhooks/clerk`: Receive user.created, user.updated, org.created events
  - [ ] Verify Clerk webhook signature
  - [ ] Handle user.created: Create User + Organization + SubscriptionTier (trial)
  - [ ] Handle org.created: Create Organization record (if not already created)
- [ ] Create Stripe customer during org creation (new SubscriptionService method)
- [ ] Test webhook locally with Clerk CLI: `clerk run`

## Phase 1D: Multi-User Invites (MVP)

- [ ] Define invite statuses: `PENDING`, `ACCEPTED`, `EXPIRED`, `REVOKED`
- [ ] Create `POST /api/organizations/invites` (admin-only)
  - [ ] Validate email, role, and org membership
  - [ ] Enforce max users for current tier (trial: 3 users)
  - [ ] Create invite with token + expiresAt (e.g., 7 days)
  - [ ] Send invite email via SendGrid with accept link
- [ ] Create `POST /api/organizations/invites/accept`
  - [ ] Validate invite token + expiry
  - [ ] Require Clerk signup (email/password or OAuth)
  - [ ] Create user in DB with same organizationId + role
  - [ ] Mark invite accepted, set acceptedAt
- [ ] Create `GET /api/organizations/invites` (admin-only)
  - [ ] List pending invites for org
- [ ] Create `DELETE /api/organizations/invites/:inviteId` (admin-only)
  - [ ] Revoke invite (status -> REVOKED)
- [ ] Add tests for invite flow (create, accept, expiry, max users)

## Phase 2: Trial Abuse Prevention (Disposable Email Check)

- [ ] Install `disposable-email` package: `npm install disposable-email`
- [ ] Create `src/services/trialAbuseGuard.ts`: TrialAbuseGuard class with `validateTrialSignup()`
- [ ] Add disposable email validation to signup webhook handler
- [ ] Test abuse guard: Attempt signup with `test@mailinator.com` (should be rejected)
- [ ] Test abuse guard: Attempt signup with `test@gmail.com` (should pass)

## Phase 3: Trial Subscription Creation

- [ ] Extend `src/services/subscriptionService.ts`:
  - [ ] Add `createTrialSubscription(organizationId, trialDays)` method
  - [ ] Default trial: 14 days, tier: "professional"
  - [ ] Set `trialEndDate` to now + 14 days at 00:00 UTC
  - [ ] Set `status` to `TRIALING`
  - [ ] Return created subscription
- [ ] Add `createStripeCustomer(organizationId, email)` method
  - [ ] Create customer in Stripe
  - [ ] Store `stripeCustomerId` in DB
  - [ ] Return customer ID
- [ ] Update webhook handler: Call `createTrialSubscription()` when org created
- [ ] Test: Sign up via Clerk, verify trial_subscription table populated with correct dates

## Phase 4: Trial Status Endpoints (Read-Only)

- [ ] Create `src/controllers/trialController.ts`
- [ ] Add `getTrialStatus(req, res)` controller:
  - [ ] Get current user from Clerk JWT
  - [ ] Query subscription_tiers for user's org
  - [ ] If TRIALING: Return trial details (start, end, daysRemaining, tier limits)
  - [ ] If not TRIALING: Return current tier info (no trial)
  - [ ] Add tests: Trial user, non-trial user, expired trial edge case
- [ ] Create `GET /api/subscription/trial-status` route
- [ ] Add Clerk auth middleware to route
- [ ] Test endpoint: Verify response structure matches spec

## Phase 5: Trial Reminder System (Scheduled Job)

- [ ] Extend `src/services/subscriptionService.ts`:
  - [ ] Add `findTrialsNeedingReminders()` method
  - [ ] Query trials where trialEndDate in next 24h AND daysRemaining in [10, 5, 2]
  - [ ] Filter out trials where reminder already sent (check `sentRemindersAt` in trial_events)
  - [ ] Return list with organizationId, daysRemaining, email, orgName
- [ ] Extend `src/services/emailService.ts`:
  - [ ] Add `sendTrialReminder(to, orgName, daysRemaining, upgradeUrl)` method
  - [ ] Use SendGrid template (create template first)
  - [ ] Pass daysRemaining, org name, upgrade URL to template
- [ ] Create `src/jobs/trialExpirationJob.ts`:
  - [ ] Schedule with node-cron: `0 0 * * *` (daily 00:00 UTC)
  - [ ] Step 1: Call `downgradeExpiredTrials()` (implemented Phase 6)
  - [ ] Step 2: Call `findTrialsNeedingReminders()` and iterate
  - [ ] Step 3: For each reminder, call `sendTrialReminder()`
  - [ ] Step 4: Log event via `logTrialEvent('trial_reminder_sent', {daysRemaining})`
  - [ ] Error handling: Try/catch per reminder, log to Sentry, don't crash job
- [ ] Register job in `src/index.ts` (app startup)
- [ ] Test job locally:
  - [ ] Manually call job function, verify console logs
  - [ ] Check SendGrid logs for sent emails
  - [ ] Verify trial_events table updated

## Phase 6: Trial Downgrade (Expired → Starter, Wrapped in Transaction)

- [ ] Extend `src/services/subscriptionService.ts`:
  - [ ] Add `downgradeExpiredTrials()` method
  - [ ] Use `prisma.$transaction()` for atomicity
  - [ ] Query all TRIALING subscriptions with `trialEndDate < now()`
  - [ ] For each: Update status → ACTIVE, tierLevel → starter, stripeSubscriptionId → NULL
  - [ ] Log event via `logTrialEvent('trial_expired', {daysTrialed})`
  - [ ] Return count of downgraded trials
- [ ] Extend `src/services/emailService.ts`:
  - [ ] Add `sendTrialDowngradeWarning(to, orgName, upgradeUrl)` method
  - [ ] Use SendGrid template
  - [ ] Include starter tier limits (500 SKUs, 1 user)
- [ ] Update `src/jobs/trialExpirationJob.ts`:
  - [ ] After downgrading trials, send downgrade warning emails
  - [ ] Query recently downgraded trials, get admin email, send warning
- [ ] Add tests:
  - [ ] Test downgrade with 1 trial (atomicity)
  - [ ] Test downgrade with 5 trials (bulk)
  - [ ] Test race condition: Simultaneous conversions prevented by transaction
  - [ ] Test email sent after downgrade

## Phase 7: Trial Conversion (Trial → Paid, Wrapped in Transaction)

- [ ] Extend `src/services/subscriptionService.ts`:
  - [ ] Add `convertTrialToPaid(organizationId, stripePaymentMethodId, billingCycle)` method
  - [ ] Use `prisma.$transaction()` for atomicity
  - [ ] Verify subscription status is TRIALING (guard against already-converted)
  - [ ] Call Stripe to create subscription:
    - [ ] Use `stripeCustomerId` (already created at org creation)
    - [ ] Use monthly/annual price from pricing table
    - [ ] Set `payment_method` + `default_payment_method`
    - [ ] Use `payment_behavior: 'error_if_incomplete'` (fail fast)
  - [ ] On success: Update status → ACTIVE, store `stripeSubscriptionId`, set `trialConvertedAt`
  - [ ] On Stripe error: Throw error (payment failed, insufficient funds, etc.)
  - [ ] Log event via `logTrialEvent('trial_converted', {daysTrialed, stripeSubscriptionId})`
- [ ] Create `src/controllers/trialController.ts`:
  - [ ] Add `convertTrialToPaid(req, res)` controller
  - [ ] Extract userId + organizationId from Clerk JWT
  - [ ] Verify user is org admin (authorization check - fixes Issue #11)
  - [ ] Extract stripePaymentMethodId + billingCycle from request body
  - [ ] Call `subscriptionService.convertTrialToPaid()`
  - [ ] Return updated subscription details
  - [ ] Error handling:
    - [ ] BadRequestError: Not in trial (return 400)
    - [ ] Stripe error: Return 402 (payment required) with message
    - [ ] Auth error: Return 403 (not authorized)
- [ ] Create `POST /api/subscription/convert-trial` route
- [ ] Add Clerk auth + org-user authorization middleware
- [ ] Add tests:
  - [ ] Successful conversion (trial → active, Stripe charge works)
  - [ ] Payment declined (Stripe error handling)
  - [ ] Already converted (status check prevents double-charge)
  - [ ] Simultaneous conversions (race condition test - both fail atomically)
  - [ ] Unauthorized user (non-admin can't convert org's trial)

## Phase 8: Trial Status Display (Frontend)

- [ ] Create `src/components/TrialBanner.tsx`:
  - [ ] Fetch `/api/subscription/trial-status`
  - [ ] If `isInTrial: true`:
    - [ ] Show banner: "You have X days left in your professional trial"
    - [ ] Show blue upgrade button
    - [ ] Link to upgrade flow
  - [ ] If `isInTrial: false` and tier is "starter":
    - [ ] Show banner: "You're on the Starter plan (no longer in trial)"
    - [ ] Link to upgrade
  - [ ] If `isInTrial: false` and tier is paid:
    - [ ] Show banner: "Active subscription: X per month"
    - [ ] Link to billing settings
- [ ] Create `src/components/TrialUpgradeFlow.tsx`:
  - [ ] Show trial details: Days remaining, current SKU usage vs tier limit
  - [ ] Button: "Upgrade to Professional"
  - [ ] On click: Redirect to Stripe checkout (populated with customer + trial days adjustment)
  - [ ] Checkout confirmation redirect back to app
- [ ] Add `<TrialBanner />` to main layout
- [ ] Test frontend:
  - [ ] Trial user sees trial banner + upgrade button
  - [ ] Non-trial user sees appropriate banner
  - [ ] Upgrade button workflow completes

## Phase 9: Stripe Webhook Integration (Confirm Payment Intent)

- [ ] Create `src/routes/webhooks/stripe.ts`:
  - [ ] `POST /webhooks/stripe` endpoint
  - [ ] Verify Stripe webhook signature (use `stripe.webhooks.constructEvent()`)
  - [ ] Handle `payment_intent.succeeded` event:
    - [ ] Query SubscriptionTier matching Stripe subscription in event
    - [ ] Verify status is still TRIALING (guard against re-processing)
    - [ ] Update status → ACTIVE
    - [ ] Log event: `logTrialEvent('payment_confirmed', {intent_id})`
    - [ ] Return 200 JSON
  - [ ] Handle `payment_intent.payment_failed` event:
    - [ ] Send alert email to admin
    - [ ] Log failure: `logTrialEvent('payment_failed', {intent_id, error})`
  - [ ] Handle other events gracefully (return 200 even if unhandled)
  - [ ] Error handling: Log to Sentry, return 500 if database write fails (Stripe will retry)
- [ ] Add webhook endpoint to Stripe dashboard
- [ ] Test:
  - [ ] Use Stripe CLI: `stripe listen --forward-to localhost:3000/webhooks/stripe`
  - [ ] Trigger test payment: `stripe trigger payment_intent.succeeded`
  - [ ] Verify local DB updated

## Phase 10: Error Handling & Edge Cases

- [ ] Add validation in `convertTrialToPaid()`:
  - [ ] Check subscription exists
  - [ ] Check status is TRIALING
  - [ ] Check Stripe customer exists
  - [ ] Return appropriate error messages
- [ ] Add validation in `downgradeExpiredTrials()`:
  - [ ] Handle missing organization records
  - [ ] Handle Stripe API errors (log but don't crash job)
- [ ] Add rate limiting:
  - [ ] POST /convert-trial: 5 requests per hour per user (prevent rapid re-submits)
  - [ ] Trial status: No limit (read-only)
- [ ] Add Sentry error logging:
  - [ ] All exceptions in job logged with context (orgId, event type)
  - [ ] Stripe errors logged with request ID for debugging
  - [ ] Email failures logged (from/to/template for triage)

## Phase 11: Testing & Validation

- [ ] Unit tests:
  - [ ] `TrialAbuseGuard.validateTrialSignup()`: Test disposable emails, duplicate emails
  - [ ] `SubscriptionService.createTrialSubscription()`: Verify dates correct (00:00 UTC)
  - [ ] `SubscriptionService.convertTrialToPaid()`: Test atomicity with transaction mock
  - [ ] `SubscriptionService.downgradeExpiredTrials()`: Test bulk downgrade, atomicity
  
- [ ] Integration tests:
  - [ ] Full signup flow: Clerk webhook → Organization + User + Trial created
  - [ ] Conversion flow: Trial → Paid, Stripe + DB consistent
  - [ ] Downgrade flow: Expired trial → Starter, email sent
  - [ ] Authorization: Non-admin user cannot convert trial
  
- [ ] Edge case tests:
  - [ ] Simultaneous conversions (both fail, no double-charge)
  - [ ] Webhook replayed (idempotency: second run doesn't create duplicate org)
  - [ ] Payment failed (Stripe error, trial remains active)
  - [ ] Email sending fails (job continues, other reminders sent)
  - [ ] Reminder already sent (email service tracks via `sentRemindersAt`, no duplicate)

- [ ] End-to-end test (manual):
  - [ ] Sign up via Clerk UI
  - [ ] Verify trial active (14 days)
  - [ ] Convert trial (fake payment method in Stripe test mode)
  - [ ] Verify subscription active
  - [ ] Manually trigger job: Verify reminders sent correctly
  - [ ] Manually expire trial: Verify downgraded, email sent

## Phase 12: Documentation & Cleanup

- [ ] Update `SECURITY.md`:
  - [ ] Document Clerk integration (PCI compliance, OAuth)
  - [ ] Document transaction patterns (atomicity guarantees)
  - [ ] Document authorization checks (org-user validation)
  - [ ] Document sensitive data logging (no card numbers, PII in logs)

- [ ] Update `docs/api-conventions.md`:
  - [ ] Add TrialBanner endpoint docs
  - [ ] Add ConvertTrial endpoint docs
  - [ ] Add error codes (400, 402, 403)

- [ ] Update `.env.example`:
  - [ ] Add Clerk API keys (NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY)
  - [ ] Add SendGrid trial template IDs
  - [ ] Remove old PIN auth env vars (if any)

- [ ] Remove PIN-based auth code:
  - [ ] Delete PIN validation logic
  - [ ] Remove PIN from seed scripts
  - [ ] Update README (PIN login no longer supported)

- [ ] Verify all tests passing:
  - [ ] `npm run test:backend:diff` (all new tests added)
  - [ ] `npm run lint` (no TypeScript errors)
  - [ ] `ubs $(git diff --name-only)` (no UBS warnings)

- [ ] Create migration guide for Phase 7 (existing PIN users → Clerk)
  - [ ] Notify existing test users of new flow
  - [ ] Provide Clerk reset link
  - [ ] Keep PIN auth temporarily (deprecate in Phase 5)

## Summary by Phase

| Phase | Component | Key Deliverable |
|-------|-----------|-----------------|
| 1A | Auth Setup | Clerk SDK configured, webhook tested |
| 1B | Schema | Migration applied, no data loss |
| 1C | Routes | Clerk JWT extraction, webhook handler working |
| 2 | Abuse Prev. | Disposable email check, signup validated |
| 3 | Trial Creation | Trial subscription in DB, dates correct |
| 4 | Status Endpoint | Frontend can fetch trial details |
| 5 | Reminders | Daily job runs, emails sent (idempotent) |
| 6 | Downgrade | Expired trials auto-downgraded atomically |
| 7 | Conversion | Trial → Paid, Stripe + DB consistent |
| 8 | Frontend | UI shows trial status, upgrade button |
| 9 | Webhooks | Stripe payment confirmed, DB updated |
| 10 | Error Handling | All failures logged, job resilient |
| 11 | Testing | All phases tested, edge cases covered |
| 12 | Cleanup | Docs updated, PIN auth removed, ready for handoff |

---

## Issues Fixed (Cross-Reference)

- ✅ **Issue #1 (Auth Mismatch)**: Phases 1A-1C use Clerk (email/password + OAuth)
- ✅ **Issue #2 (No Stripe Customer)**: Phase 3 creates customer at org creation
- ✅ **Issue #3 (Method Mismatch)**: Phase 5 implements `findTrialsNeedingReminders()`
- ✅ **Issue #4 (Downgrade Missing Email)**: Phase 6 sends `sendTrialDowngradeWarning()`
- ✅ **Issue #5 (Race Condition)**: Phases 6-7 use `$transaction()` atomicity
- ✅ **Issue #6 (Phone Field)**: Clerk provides email, Phase 2 doesn't need phone
- ✅ **Issue #7 (Timezone)**: Phase 3 stores dates at 00:00 UTC consistently
- ✅ **Issue #8 (Email Idempotency)**: Phase 5 tracks `sentRemindersAt`, Phase 11 tests it
- ✅ **Issue #9 (Error Handling)**: Phase 10 adds validation, Phase 5 job has try/catch
- ✅ **Issue #10 (Payment Intent)**: Phase 9 Stripe webhook handler
- ✅ **Issue #11 (Org-User Auth)**: Phase 7 converts checks authorization
- ✅ **Issue #12 (Idempotency Tests)**: Phase 11 includes race condition + duplicate tests
