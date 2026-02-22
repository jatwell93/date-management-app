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
  - [x] Test Clerk auth UI locally (SignUp component renders)
- [x] Backend setup:
  - [x] Create `src/middleware/clerk-auth.middleware.ts` to verify JWTs
  - [x] Set `CLERK_SECRET_KEY` + `CLERK_PUBLISHABLE_KEY` + `CLERK_WEBHOOK_SECRET` in `.env.example`
  - [x] Test JWT verification with unit tests (9 test cases passing)
- [x] Clerk webhook configuration:
  - [x] Create webhook endpoint: `POST /webhooks/clerk` **NOTE** Configured at https://play.svix.com/in/e_XYN9vGi7uhZhk4ISNivRFm5dYZp/ for testing
  - [x] Get Clerk webhook signing secret - Added to doppler
  - [x] Configure webhook in Clerk dashboard to point to backend (via ngrok)
  - [x] Verify webhook signature verification working
- [x] End-to-end local test:
  - [x] Sign up new user via React SignUp component (email/password)
  - [x] Verify Clerk webhook received on backend
  - [x] Verify User + Organization records created in database
  - [x] Verify JWT contains username field

## Phase 1B: Schema Migration (Database)

- [x] Add `clerkUserId` (STRING, UNIQUE) column to `users` table
- [x] Add `email` (STRING, UNIQUE) column to `users` table
- [x] Add `username` (STRING, UNIQUE) column to `users` table (**for audit logging**)
- [x] Remove `pin` (VARCHAR) column from `users` table (already removed in schema)
- [x] Create `organization_invites` table (id, organizationId, email, role, token, status, expiresAt, acceptedAt, invitedByUserId, createdAt)
- [x] Add `clerkOrganizationId` (STRING, UNIQUE) column to `organizations` table
- [x] Add `stripeCustomerId` (STRING) column to `subscription_tiers` table (already in schema)
- [x] Add `trialEndDate` (DATETIME, NULLABLE) column to `subscription_tiers` table
- [x] Add `trialStartedAt` (DATETIME, NULLABLE) column to `subscription_tiers` table
- [x] Add `trialConvertedAt` (DATETIME, NULLABLE) column to `subscription_tiers` table
- [x] Create `trial_events` table (id, organizationId, eventType, occurredAt, metadata JSON, sentRemindersAt JSON, indexes on organizationId/eventType/occurredAt)
- [x] Create `clerk_webhook_events` table for idempotency tracking
- [x] Update Prisma schema to reflect all changes
- [x] Run migration: `npx prisma migrate dev --name add_clerk_auth_trial_system` (schema already reflects all changes)
- [x] Verify migration in staging (completed)

## Phase 1C: Auth Middleware & Routes (Clerk Integration)

- [x] Create `src/middleware/clerkAuth.ts`: Extract userId + org from Clerk JWT in all protected routes
- [x] Update `src/routes/auth.ts`:
  - [x] Remove PIN login endpoint (`POST /auth/login`)
  - [x] Remove PIN-based controller logic
  - [x] Add `POST /auth/refresh` for JWT refresh (if needed) - Clerk handles JWT refresh automatically, not required
  - [x] Add `POST /auth/logout` endpoint
- [x] Create `src/routes/webhook.ts`:
  - [x] `POST /webhooks/clerk`: Receive user.created, user.updated, org.created events
  - [x] Verify Clerk webhook signature
  - [x] Handle user.created: Create User + Organization + SubscriptionTier (trial)
  - [x] Handle org.created: Create Organization record (if not already created)
  - [x] Handle organizationMembership.created: Link user to org with role
  - [x] Handle organizationMembership.deleted: Unlink user from org
  - [x] Fix webhook idempotency: use svix-id header as event ID
- [x] Create Stripe customer during org creation (new SubscriptionService method)
- [x] Test webhook locally with ngrok + Clerk dashboard

## Phase 1E: Organisation UI (Clerk Components)

- [x] Enable Clerk Organizations in Clerk dashboard
- [x] Add `hasOrganization` to auth context via `useOrganization()` hook
- [x] Build `/onboarding` page with Clerk `<CreateOrganization>` component
  - [x] Redirects to `/scan` after org created
  - [x] Route guard: signed-in users with existing org redirect to `/scan`
  - [x] Route guard: unauthenticated users redirect to `/login`
- [x] Build `/settings` page with Clerk `<OrganizationProfile>` component
  - [x] Manager-only: Team Members redirected to `/scan`
  - [x] Unauthenticated users redirected to `/login`
- [x] Add Settings nav link for Managers (desktop + mobile)

## Phase 1F: E2E Test Suite (Playwright)

- [x] Install `@playwright/test` at project root
- [x] Create `playwright.config.ts` with global setup + auth state projects
- [x] Create `e2e/global-setup.ts`: signs in once, saves `storageState` for reuse
- [x] Write `e2e/auth/sign-up.spec.ts`: sign-up + OTP via Mailinator
- [x] Write `e2e/auth/sign-in.spec.ts`: sign-in, invalid credentials
- [x] Write `e2e/onboarding/org-creation.spec.ts`: onboarding flow, org redirect
- [x] Write `e2e/settings/org-settings.spec.ts`: settings access, nav visibility
- [x] Write `e2e/routing/route-guards.spec.ts`: all 12 protected routes + Manager guards
- [x] Write `e2e/webhooks/webhook-pipeline.spec.ts`: webhook endpoint security
- [x] Add `test:e2e`, `test:e2e:ui`, `test:e2e:headed` scripts to root `package.json`

## Phase 1D: Multi-User Invites (MVP)

- [x] Define invite statuses: `PENDING`, `ACCEPTED`, `EXPIRED`, `REVOKED`
- [x] Create `POST /api/organizations/invites` (admin-only)
  - [x] Validate email, role, and org membership
  - [x] Enforce max users for current tier (trial: 3 users)
  - [x] Create invite with token + expiresAt (e.g., 7 days)
  - [x] Send invite email via SendGrid with accept link
- [x] Create `POST /api/organizations/invites/accept`
  - [x] Validate invite token + expiry
  - [x] Require Clerk signup (email/password or OAuth)
  - [x] Create user in DB with same organizationId + role
  - [x] Mark invite accepted, set acceptedAt
- [x] Create `GET /api/organizations/invites` (admin-only)
  - [x] List pending invites for org
- [x] Create `DELETE /api/organizations/invites/:inviteId` (admin-only)
  - [x] Revoke invite (status -> REVOKED)
- [x] Add tests for invite flow (create, accept, expiry, max users)

## Phase 2: Trial Abuse Prevention (Disposable Email Check)

- [x] ~~Install `disposable-email` package~~ - **NOT NEEDED** - Clerk provides this natively
- [x] ~~Create `src/services/trialAbuseGuard.ts`~~ - **NOT NEEDED** - Clerk handles this in Dashboard
- [x] Enable disposable email blocking in Clerk Dashboard:
  - [x] Go to Clerk Dashboard → Security → Restrictions
  - [x] Toggle on "Block disposable email addresses"
  - [x] This blocks 160,000+ known disposable email providers automatically

## Phase 3: Trial Subscription Creation

- [x] Extend `src/services/subscriptionService.ts`:
  - [x] Add `createTrialSubscription(organizationId, trialDays)` method (already implemented)
  - [x] Default trial: 14 days, tier: "professional"
  - [x] Set `trialEndDate` to now + 14 days at 00:00 UTC
  - [x] Set `status` to `TRIALING`
  - [x] Return created subscription
- [x] Add `createStripeCustomer(organizationId, email)` method (integrated in createTrialSubscription)
  - [x] Create customer in Stripe
  - [x] Store `stripeCustomerId` in DB
  - [x] Return customer ID
- [x] Update webhook handler: Call `createTrialSubscription()` when org created (in clerk-webhook.service.ts)
- [x] Test: Sign up via Clerk, verify trial_subscription table populated with correct dates (verified via E2E)

## Phase 4: Trial Status Endpoints (Read-Only)

- [x] Create `src/routes/subscription.routes.ts` (controller + route combined)
- [x] Add `GET /api/subscription/trial-status` endpoint:
  - [x] Get current user from Clerk JWT
  - [x] Query subscription_tiers for user's org
  - [x] If TRIALING: Return trial details (start, end, daysRemaining, tier limits)
  - [x] If not TRIALING: Return current tier info (no trial)
  - [x] Returns tier limits based on tierLevel (starter/professional/premium/concierge)
- [x] Add Clerk auth middleware to route
- [x] Test endpoint: Verify response structure matches spec

## Phase 5: Trial Reminder System (Scheduled Job)

- [x] Extend `src/services/subscriptionService.ts`:
  - [x] Add `findTrialsNeedingReminders()` method
  - [x] Query trials where trialEndDate in next 24h AND daysRemaining in [10, 5, 2]
  - [x] Filter out trials where reminder already sent (check `sentRemindersAt` in trial_events)
  - [x] Return list with organizationId, daysRemaining, email, orgName
- [x] Extend `src/services/emailService.ts`:
  - [x] Add `sendTrialReminder(to, orgName, daysRemaining, upgradeUrl)` method
  - [x] Use SendGrid template (create template first)
  - [x] Pass daysRemaining, org name, upgrade URL to template
- [x] Create `src/jobs/trialExpirationJob.ts`:
  - [x] Schedule with node-cron: `0 0 * * *` (daily 00:00 UTC)
  - [x] Step 1: Call `downgradeExpiredTrials()` (Phase 6)
  - [x] Step 2: Call `findTrialsNeedingReminders()` and iterate
  - [x] Step 3: For each reminder, call `sendTrialReminder()`
  - [x] Step 4: Log event via `logTrialEvent('trial_reminder_sent', {daysRemaining})`
  - [x] Error handling: Try/catch per reminder, log to Sentry, don't crash job
- [x] Register job in `src/index.ts` (app startup)
- [x] Test job locally:
  - [x] Manually call job function, verify console logs
  - [x] Check SendGrid logs for sent emails
  - [x] Verify trial_events table updated

## Phase 6: Trial Downgrade (Expired → Starter, Wrapped in Transaction)

- [x] Extend `src/services/subscriptionService.ts`:
  - [x] Add `downgradeExpiredTrials()` method
  - [x] Use `prisma.$transaction()` for atomicity
  - [x] Query all TRIALING subscriptions with `trialEndDate < now()`
  - [x] For each: Update status → ACTIVE, tierLevel → starter, stripeSubscriptionId → NULL
  - [x] Log event via `logTrialEvent('trial_expired', {downgradedTo: 'starter'})`
  - [x] Return count of downgraded trials
- [x] Extend `src/services/emailService.ts`:
  - [x] Add `sendTrialDowngradeWarning(to, orgName, upgradeUrl)` method
  - [x] Use SendGrid template
  - [x] Include starter tier limits (500 SKUs, 1 user)
- [x] Update `src/jobs/trialExpirationJob.ts`:
  - [x] After downgrading trials, send downgrade warning emails
  - [x] Query recently downgraded trials, get admin email, send warning
- [x] Add tests:
  - [x] Test downgrade with 1 trial (atomicity)
  - [x] Test downgrade with 5 trials (bulk)
  - [x] Test race condition: Simultaneous conversions prevented by transaction
  - [x] Test email sent after downgrade

## Phase 7: Trial Conversion (Trial → Paid, Wrapped in Transaction)

- [x] Extend `src/services/subscriptionService.ts`:
  - [x] Add `convertTrialToPaid(organizationId, stripePaymentMethodId, billingCycle)` method
  - [x] Use `prisma.$transaction()` for atomicity
  - [x] Verify subscription status is TRIALING (guard against already-converted)
  - [x] Call Stripe to create subscription:
    - [x] Use `stripeCustomerId` (already created at org creation)
    - [x] Use monthly/annual price from pricing table
    - [x] Set `payment_method` + `default_payment_method`
    - [x] Use `payment_behavior: 'error_if_incomplete'` (fail fast)
  - [x] On success: Update status → ACTIVE, store `stripeSubscriptionId`, set `trialConvertedAt`
  - [x] On Stripe error: Throw error (payment failed, insufficient funds, etc.)
  - [x] Log event via `logTrialEvent('trial_converted', {stripeSubscriptionId, billingCycle})`
- [x] Create `src/controllers/trialController.ts`:
  - [x] Add `convertTrialToPaid(req, res)` controller
  - [x] Extract userId + organizationId from Clerk JWT
  - [x] Verify user is org admin (authorization check - fixes Issue #11)
  - [x] Extract stripePaymentMethodId + billingCycle from request body
  - [x] Call `subscriptionService.convertTrialToPaid()`
  - [x] Return updated subscription details
  - [x] Error handling:
    - [x] BadRequestError: Not in trial (return 400)
    - [x] Stripe error: Return 402 (payment required) with message
    - [x] Auth error: Return 403 (not authorized)
- [x] Create `POST /api/subscription/convert-trial` route
- [x] Add Clerk auth + org-user authorization middleware
- [x] Add tests:
  - [x] Successful conversion (trial → active, Stripe charge works)
  - [x] Payment declined (Stripe error handling)
  - [x] Already converted (status check prevents double-charge)
  - [x] Simultaneous conversions (race condition test - both fail atomically)
  - [x] Unauthorized user (non-admin can't convert org's trial)

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

---

## NOTE FOR V2: Full Role Migration

**Current Approach (Phase 1D MVP):** Role mapping strategy
- Invites store roles as `admin` / `member`
- Users created with mapped roles: `Manager` / `Team Member` 
- Minimal code churn, defers refactor to later phase
- Allows Clerk signup + multi-user invites to ship quickly

**V2 Migration (Future Phase):** Full role system alignment
- Standardize everywhere to either `admin` / `member` OR `Manager` / `Team Member`
- Remove role mapping translation layer from `OrganizationInviteService.mapInviteRole()`
- Update authorization checks (`requireManager()` middleware) to use consistent role values
- Update audit logs and role-based features to use single role system
- This refactor is cleaner long-term but adds 2-3 hours of work
- **Recommended for v2** once Clerk auth + invites are validated in production and stable

**Files to Update in V2 Role Migration:**
- `src/middleware/auth.middleware.ts` (requireManager logic)
- `src/services/organization-invite.service.ts` (remove mapInviteRole method)
- `src/models/user.model.ts` (role union type)
- All unit tests referencing roles
- Audit logging if applicable
