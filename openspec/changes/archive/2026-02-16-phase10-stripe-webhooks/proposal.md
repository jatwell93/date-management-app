# Proposal: Phase 10 - Stripe Webhook Handlers

## Analysis

**Current State**:

- `backend/src/routes/webhook.routes.ts` exists with proper structure (raw body handling, signature verification flow)
- `backend/src/services/webhook.service.ts` has scaffolding with 6 empty handler stubs (TODOs)
- `backend/src/services/subscription.service.ts` is complete with full subscription lifecycle management
- In-memory idempotency check using `Map<string, ProcessedWebhookEvent>` (non-persistent)
- Stripe SDK configured in environment (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`)
- No email service exists yet (needed for trial reminders and dunning)
- No `processed_webhook_events` database table (needed for persistent idempotency)

**Affected Files**:

- `backend/src/services/webhook.service.ts`: Implement 6 empty handlers (lines 163-265)
- `backend/prisma/schema.prisma`: Add `ProcessedWebhookEvent` model
- `backend/src/services/email.service.ts`: **CREATE NEW** - SendGrid integration
- `backend/src/services/webhook.service.ts`: Replace in-memory Map with database queries
- `backend/src/tests/integration/webhook.integration.test.ts`: **CREATE NEW**
- `backend/src/tests/unit/webhook.service.test.ts`: **CREATE NEW**

**Pattern**:

- Follow stripe-webhooks skill (signature verification first, parse second, handle idempotently)
- Follow webhook-handler-patterns skill (database idempotency, transactional updates, error handling)
- Use existing `subscription.service.ts` methods (`syncSubscriptionState`, `cancelSubscription`)
- Follow Phase 17.5 decisions from tasks.md

## Reuse Strategy

**Existing Code to Leverage**:

1. ✅ **webhook.routes.ts** (lines 1-65): Route structure complete, no changes needed
2. ✅ **webhook.service.ts** (lines 1-110): Signature verification + idempotency scaffolding exists
3. ✅ **subscription.service.ts**: Full subscription CRUD ready (`createSubscription`, `updateSubscription`, `syncSubscriptionState`, `cancelSubscription`)
4. ✅ **Stripe SDK**: Already initialized in `webhook.service.ts` constructor
5. ✅ **Prisma Client**: Available via `getDefaultDatabaseClient()`

**New Code Required**:

1. ❌ **Email Service**: SendGrid integration for trial reminders and dunning emails (per DECISION 17.5.4)
2. ❌ **Database Idempotency**: `ProcessedWebhookEvent` model + migration
3. ❌ **6 Webhook Handlers**: Implement TODOs in `webhook.service.ts`
4. ❌ **Integration Tests**: Test all 6 handlers with Stripe test events
5. ❌ **Monitoring**: Sentry alerting for webhook failures (per Phase 18.B.7)

**Decision Notes (from Phase 17.5)**:

- **DECISION 17.5.5**: Stripe customer `metadata.organizationId` is source of truth for routing webhooks
- **DECISION 17.5.4**: Use SendGrid for all email notifications
- **DECISION 17.5.8**: Apply soft lock (read-only mode) when downgrading over limit
- **DECISION 17.5.9**: 7-day grace period before auto-downgrade on payment failure

## Implementation Steps

### Step 1: Database Idempotency (Phase 18.B.1-18.B.2)

1. Create migration: Add `processed_webhook_events` table
   - Columns: `id` (TEXT PRIMARY KEY), `event_type` (TEXT), `processed_at` (TIMESTAMP)
   - Index: `(event_type, processed_at)` for cleanup queries
2. Update `webhook.service.ts`:
   - Replace `isNewEvent()` with Prisma query
   - Replace `markEventProcessed()` with Prisma insert
   - Handle unique constraint gracefully (idempotent replay)

### Step 2: Email Service Integration (DECISION 17.5.4)

1. Install SendGrid SDK: `npm install @sendgrid/mail`
2. Create `backend/src/services/email.service.ts`:
   - Method: `sendTrialReminderEmail(organizationId, daysRemaining)`
   - Method: `sendDunningEmail(organizationId, invoiceUrl)`
   - Method: `sendDowngradeWarningEmail(organizationId, currentUsage, newLimit)`
   - Use SendGrid templates for professional formatting
   - Never hardcode API key (use `envConfig.SENDGRID_API_KEY`)
3. Add `SENDGRID_API_KEY` to `backend/src/config/environment.ts`
4. Create SendGrid templates in dashboard

### Step 3: Implement 6 Webhook Handlers (Phase 18.B.3)

**Handler 1: `customer.subscription.created` (Phase 18.B.3.1)**

- Extract `organizationId` from Stripe customer metadata (DECISION 17.5.5)
- Skip if metadata missing (log ERROR to Sentry)
- Create `subscription_tiers` record with:
  - `organizationId` from metadata
  - `tierLevel` from price metadata
  - `stripeSubscriptionId` from event
  - `status` = `active` or `trialing`
  - `currentPeriodEnd` from subscription
  - `trialEndDate` if trial exists
- Update `organization_usage` limits based on tier
- Wrap in Prisma transaction (Phase 18.B.5)

**Handler 2: `customer.subscription.updated` (Phase 18.B.3.2)**

- Call `subscription.service.ts` method `syncSubscriptionState()`
- On tier downgrade: Apply soft lock if `currentUsage > newLimit` (DECISION 17.5.8)
  - Set `readOnlyMode` flag on organization
  - Queue SendGrid warning email (via email.service.ts)
- Update `current_period_end` if changed
- Wrap in transaction

**Handler 3: `customer.subscription.deleted` (Phase 18.B.3.3)**

- Set `status` = `canceled`
- Downgrade to Starter tier
- Apply soft lock if usage > Starter limits (DECISION 17.5.8)
- Log downgrade event to audit log
- Wrap in transaction

**Handler 4: `checkout.session.completed` (Phase 18.B.3.4)**

- Find `subscription_tiers` by `stripeSubscriptionId`
- Set `isTrial` = false (customer paid, no longer in trial)
- Link via Stripe customer metadata `organizationId` (DECISION 17.5.5)
- Wrap in transaction

**Handler 5: `invoice.payment_failed` (Phase 18.B.3.5)**

- Set `status` = `past_due`
- Queue SendGrid retry email via email.service.ts (DECISION 17.5.4)
- Log to dunning queue
- After 7-day grace period + failed retries: downgrade to Starter (DECISION 17.5.9)
  - Implemented as separate cron job, not in webhook
- Wrap in transaction

**Handler 6: `customer.subscription.trial_will_end` (Phase 18.B.3.6)**

- Query `subscription_tiers` by `stripeSubscriptionId`
- Calculate days until trial end
- Queue SendGrid reminder email via email.service.ts (DECISION 17.5.4)
- Log `trial_reminder_sent` event
- No database changes (informational only)

### Step 4: Webhook Metadata Validation (Phase 18.E.3)

1. In all handlers, before processing:
   - Verify Stripe customer metadata contains `organizationId` (DECISION 17.5.5)
   - Verify organization exists in database
   - Log ERROR to Sentry and skip if missing
   - Never trust `organizationId` from request body

### Step 5: Testing (Phase 18.F + Task 10.12)

1. Write unit tests for each handler with mocked Prisma + Stripe
2. Write integration tests with Stripe test events:
   - Use `stripe trigger` CLI command
   - Test all 6 event types
   - Test idempotency (replay same event, verify no duplicate processing)
   - Test transaction rollback on error
3. Test edge cases (Phase 18.H):
   - Missing metadata
   - Out-of-order events
   - Organization not found

### Step 6: Monitoring (Phase 18.B.7)

1. Add Sentry alerts:
   - `webhook_handler_error > 1/day`
   - `processed_webhook_events` growth rate (detect replay attacks)
2. Add metrics:
   - Webhook processing latency
   - Webhook failure rate by event type

### Step 7: Documentation

1. Update `docs/stripe-integration.md` with webhook handler details
2. Document dunning workflow (7-day grace period)
3. Document soft lock behavior on downgrade

## Success Criteria

✅ **All 6 handlers implemented** and tested
✅ **Idempotency working** via database (no duplicate processing on replay)
✅ **Email service integrated** (SendGrid templates created)
✅ **Integration tests passing** (all event types)
✅ **Sentry monitoring active** (webhook errors tracked)
✅ **Stripe test mode verified** (100% delivery for 24 hours, per Phase 20.12)
✅ **No cross-tenant leaks** (metadata validation enforced)

## Risks & Mitigations

| Risk                                     | Mitigation                                               |
| ---------------------------------------- | -------------------------------------------------------- |
| **SendGrid not configured**              | Add boot-time validation, fail fast if missing           |
| **Webhook signature verification fails** | Log full request details to Sentry for debugging         |
| **Out-of-order events**                  | Handlers should be idempotent and handle missing records |
| **Transaction deadlocks**                | Use Prisma transaction isolation, retry on deadlock      |
| **Email sending failures**               | Queue email jobs (don't block webhook processing)        |

## Estimated Effort

- **Database migration + idempotency**: 2 hours
- **Email service**: 3 hours (SendGrid setup + templates)
- **6 webhook handlers**: 8 hours (including error handling)
- **Testing**: 6 hours (unit + integration)
- **Monitoring + documentation**: 2 hours
- **Total**: ~21 hours (3 days)
