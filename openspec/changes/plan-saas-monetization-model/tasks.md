# Implementation Tasks: SaaS Monetization Model & Multi-Tenant Foundation

## 🎯 Progress Summary

**Completed Phases:**
- ✅ Phase 1: Schema Preparation (9/9 tasks) - Multi-tenant database schema created and migrated
- ✅ Phase 3: TypeScript Interfaces (8/8 tasks) - All models and types defined
- ✅ Phase 4: Authentication Layer (10/10 tasks) - JWT auth with organization context complete
- ✅ Phase 5: Feature Gating Middleware (8/8 tasks) - Tier-based feature access & usage limits

**Skipped:**
- ⏭️ Phase 2: Data Migration (9 tasks) - Not needed for fresh SaaS launch

**Remaining:**
- 📋 Phase 6-17: Routes refactor, services refactor, Stripe integration, trial system, UI, testing, deployment (126 tasks)

**Current Status:** 35/161 tasks complete (22% done) | Feature gating enables route-layer tenant filtering

> **Legend**: `**USER:**` = Manual action required (account setup, dashboard config, announcements)  
> Everything else = Developer implementation tasks

## 1. Schema Preparation (Phase 1 - Week 1-2)

- [x] 1.1 Create migration: Add `organizations` table with id, name, slug, created_at, updated_at
- [x] 1.2 Create migration: Add `subscription_tiers` table with organization_id, tier_level, stripe_subscription_id, trial_end_date, status, billing_cycle
- [x] 1.3 Create migration: Add `tier_feature_flags` table with tier_level, feature_key, enabled, limit_value
- [x] 1.4 Create migration: Add `organization_usage` table with organization_id, active_users, max_users, total_skus, max_skus, storage_used_bytes
- [x] 1.5 Create migration: Add `organization_id UUID` column to Product, InventoryItem, StoreArea, User, Upload, AuditLog, ItemTransaction, ExpiredItemTransaction (NULLABLE initially)
- [x] 1.6 Seed tier_feature_flags table with limits for Starter (500 SKUs, 1 user), Professional (2,000 SKUs, 3 users), Premium (unlimited SKUs, 10 users), Concierge (unlimited SKUs, 10 users)
- [x] 1.7 Create indexes: (organization_id, created_at) on Upload, ItemTransaction; (organization_id, sku) on Product; (organization_id, barcode) on Product
- [x] 1.8 Add unique constraints: UNIQUE(organization_id, sku), UNIQUE(organization_id, barcode) on Product
- [x] 1.9 Run migration on test database and verify schema changes apply cleanly

## 2. Data Migration (Phase 1 - Week 2)

> **⏭️ SKIPPED**: Fresh SaaS launch with no existing customers. Data backfill not required.
> 
> When customers sign up, they create their organization and data from day 1.
> If future customer migrations are needed, implement as part of onboarding workflow (CSV import).

---

## 3. TypeScript Interfaces (Phase 2 - Week 3)

- [x] 3.1 Create interface `Organization` in `backend/src/models/organization.model.ts`
- [x] 3.2 Create interface `SubscriptionTier` in `backend/src/models/subscription-tier.model.ts`
- [x] 3.3 Create interface `TierFeatureFlag` in `backend/src/models/tier-feature-flag.model.ts`
- [x] 3.4 Create interface `OrganizationUsage` in `backend/src/models/organization-usage.model.ts`
- [x] 3.5 Update `TokenPayload` interface in `backend/src/middleware/auth.middleware.ts` to include organizationId and tierLevel
- [x] 3.6 Update `AuthRequest` interface to include `organizationId: string` and `tierLevel: TierLevel`
- [x] 3.7 Add `organizationId: string` field to Product, InventoryItem, User, Upload models
- [x] 3.8 Create type `TierLevel = 'starter' | 'professional' | 'premium' | 'concierge'` in `backend/src/types/subscription.ts`

## 4. Authentication Layer (Phase 2 - Week 3)

- [x] 4.1 Update `generateToken()` in auth.middleware.ts to accept organizationId and tierLevel parameters
- [x] 4.2 Update `generateToken()` to include organizationId and tierLevel in JWT payload
- [x] 4.3 Update `authenticateToken()` middleware to extract organizationId and tierLevel from JWT
- [x] 4.4 Add validation in middleware: Check organization exists and is not canceled before allowing request
- [x] 4.5 Update login service to query user.organizationId after PIN validation
- [x] 4.6 Update login service to query organization.subscription.tier_level for JWT
- [x] 4.7 Add error handling: Reject login if organization.subscription.status='canceled'
- [x] 4.8 Update login response to include organizationId in addition to token
- [x] 4.9 Write unit tests for JWT generation with organization context
- [x] 4.10 Write integration tests for login flow with multi-tenant validation

## 5. Feature Gating Middleware (Phase 2 - Week 3)

- [x] 5.1 Create `requireFeature(featureKey: string)` middleware in `backend/src/middleware/feature-gate.middleware.ts`
- [x] 5.2 Implement feature lookup: Query tier_feature_flags by tierLevel and featureKey
- [x] 5.3 Return 403 Forbidden if feature not enabled for tier with upgrade CTA
- [x] 5.4 Create `checkUsageLimit(limitKey: string)` middleware for SKU/user limits
- [x] 5.5 Implement usage limit check: Query organization_usage and compare against max_skus/max_users
- [x] 5.6 Return 403 Forbidden with upgrade message if limit reached
- [x] 5.7 Write unit tests for feature gating with Starter/Professional/Premium tiers
- [x] 5.8 Write tests for usage limit enforcement (e.g., 500 SKU limit on Starter)

## 6. Route Layer Refactor (Phase 3 - Week 4)

- [x] 6.1 Update `/products` GET route: Filter by `WHERE organization_id = req.organizationId`
- [x] 6.2 Update `/products` POST route: Add organizationId from req.organizationId before insert
- [x] 6.3 Update `/products/:id` PUT/DELETE routes: Validate product.organization_id matches req.organizationId
- [x] 6.4 Update `/inventory-items` GET route: Filter by req.organizationId
- [x] 6.5 Update `/inventory-items` POST route: Add organizationId, check SKU limit with checkUsageLimit middleware
- [x] 6.6 Update `/inventory-items/:id` PUT/DELETE routes: Validate item.organization_id matches req.organizationId
- [x] 6.7 Update `/users` GET route: Filter by req.organizationId
- [x] 6.8 Update `/users` POST route: Add organizationId, check user limit with checkUsageLimit middleware
- [x] 6.9 Update `/users` PUT/DELETE routes: Validate user.organization_id matches req.organizationId
- [x] 6.10 Update `/uploads` GET route: Filter by req.organizationId
- [x] 6.11 Update `/uploads` POST route: Add organizationId, check storage limit
- [x] 6.12 Add feature gate to `/api/analytics` route: requireFeature('advanced_analytics')
- [x] 6.13 Write integration tests for all routes with tenant filtering

## 7. Service Layer Refactor (Phase 3 - Week 4)

- [x] 7.1 Update productService.getAllProducts() to accept organizationId parameter
- [x] 7.2 Update productService.createProduct() to accept organizationId and increment organization_usage.total_skus
- [x] 7.3 Update productService.deleteProduct() to decrement organization_usage.total_skus
- [x] 7.4 Update inventoryService methods to filter by organizationId
- [x] 7.5 Update userService methods to filter by organizationId
- [x] 7.6 Update uploadService.recordUpload() to accept organizationId and update organization_usage.storage_used_bytes
- [x] 7.7 Update uploadService.deleteUpload() to decrement organization_usage.storage_used_bytes
- [x] 7.8 Create organizationService with getOrganization(), updateOrganization() methods
- [ ] 7.9 Write unit tests for services with organizationId parameter
- [ ] 7.10 Write tests for usage counter atomicity (increment/decrement in transactions)

## 8. Stripe Configuration (Phase 4 - Week 5)

- [x] 8.1 **USER:** Create Stripe account and obtain API keys (test mode + production mode) at https://dashboard.stripe.com
- [x] 8.2 **USER:** Create Stripe product "Pharmacy Expiry Management SaaS" in Stripe dashboard
- [x] 8.3 **USER:** Create price: starter_monthly ($99/month) with metadata tier=starter
- [x] 8.4 **USER:** Create price: starter_annual ($990/year) with metadata tier=starter
- [x] 8.5 **USER:** Create price: professional_monthly ($249/month) with metadata tier=professional
- [x] 8.6 **USER:** Create price: professional_annual ($2,490/year) with metadata tier=professional
- [x] 8.7 **USER:** Create price: premium_monthly ($499/month) with metadata tier=premium
- [x] 8.8 **USER:** Create price: premium_annual ($4,990/year) with metadata tier=premium
- [x] 8.9 **USER:** Create price: concierge_addon ($600/month) with metadata addon=concierge
- [x] 8.10 **USER:** Configure Stripe webhook endpoint in dashboard (Settings → Webhooks → Add endpoint → URL: https://yourdomain.com/api/webhooks/stripe)
- [x] 8.11 **USER:** Add webhook endpoint secret to `.env` file as `STRIPE_WEBHOOK_SECRET` (copy from Stripe dashboard)
- [x] 8.12 Document Stripe configuration in `docs/stripe-setup.md`

## 9. Stripe Subscription Service (Phase 4 - Week 5)

- [ ] 9.1 Install `@stripe/stripe-js` and `stripe` Node.js SDK dependencies
- [ ] 9.2 Create `backend/src/services/subscription.service.ts` with Stripe integration
- [ ] 9.3 Implement createSubscription(organizationId, priceId, billingCycle): Create Stripe customer + subscription
- [ ] 9.4 Implement updateSubscription(organizationId, newPriceId): Update Stripe subscription with prorating
- [ ] 9.5 Implement cancelSubscription(organizationId): Cancel Stripe subscription at period end
- [ ] 9.6 Implement reactivateSubscription(organizationId): Resume canceled subscription
- [ ] 9.7 Create syncSubscriptionState(stripeSubscription): Update local subscription_tiers from Stripe data
- [ ] 9.8 Write unit tests for subscription service with Stripe API mocks
- [ ] 9.9 Write integration tests with Stripe test mode API

## 10. Stripe Webhook Handlers (Phase 4 - Week 5)

**NOTE:** Use skills/stripe-webhooks
- [ ] 10.1 Create webhook route: POST /api/webhooks/stripe with raw body parsing
- [ ] 10.2 Implement signature verification using stripe.webhooks.constructEvent()
- [ ] 10.3 Create handler for `customer.subscription.created`: Create subscription_tiers record
- [ ] 10.4 Create handler for `customer.subscription.updated`: Update tier_level, current_period_end
- [ ] 10.5 Create handler for `customer.subscription.deleted`: Set status=canceled, downgrade to Starter
- [ ] 10.6 Create handler for `customer.subscription.trial_will_end`: Send conversion reminder email
- [ ] 10.7 Create handler for `checkout.session.completed`: Mark is_trial=false
- [ ] 10.8 Create handler for `invoice.payment_failed`: Set status=past_due, trigger dunning
- [ ] 10.9 Implement idempotency check: Query processed_webhook_events table by event.id
- [ ] 10.10 Implement dead letter queue: Send to queue after 72h retry failures
- [ ] 10.11 Add webhook failure rate monitoring: Alert if >5% failures in 1-hour window
- [ ] 10.12 Write integration tests for all webhook handlers with test events

## 11. Trial System (Phase 4 - Week 6)

- [ ] 11.1 Create trial signup flow: POST /api/signup with trial_tier=professional
- [ ] 11.2 Set trial_end_date = now + 14 days in subscription_tiers record
- [ ] 11.3 Create cron job: Check trial_end_date daily and downgrade expired trials
- [ ] 11.4 Implement trial reminder emails: Send at trial_end_date - 3 days
- [ ] 11.5 Create trial conversion tracking: Log trial_started, trial_converted, trial_expired events
- [ ] 11.6 Add trial abuse prevention: Check email/phone uniqueness before allowing trial
- [ ] 11.7 Create trial dashboard: Display trial status, days remaining, upgrade CTA
- [ ] 11.8 Write tests for trial expiration logic with time mocking
- [ ] 11.9 Write tests for trial abuse prevention (duplicate email/phone)

## 12. Subscription Management UI (Phase 4 - Week 6)

- [ ] 12.1 Create frontend component: SubscriptionDashboard showing current tier, usage, limits
- [ ] 12.2 Create component: UpgradeModal with tier comparison table
- [ ] 12.3 Integrate Stripe Checkout: Redirect to Stripe for payment, return to success page
- [ ] 12.4 Create component: ManageSubscriptionButton linking to Stripe customer portal
- [ ] 12.5 Create component: UsageWarning displaying when approaching limits (80% threshold)
- [ ] 12.6 Add feature gates to UI: Hide Premium features for Starter/Professional tiers
- [ ] 12.7 Create subscription settings page: View/update billing details, cancel subscription
- [ ] 12.8 Write frontend tests for subscription components with tier-based rendering

## 13. Multi-Tenant Testing (Phase 5 - Week 7)

- [ ] 13.1 Write test: Create two organizations with separate products, verify no cross-tenant data access
- [ ] 13.2 Write test: User from Org A cannot read/update/delete products from Org B
- [ ] 13.3 Write test: Login with organizationId correctly filters by tenant
- [ ] 13.4 Write test: Feature gates correctly block Starter tier from Premium features
- [ ] 13.5 Write test: SKU limit enforcement prevents Starter tier from exceeding 500 SKUs
- [ ] 13.6 Write test: User limit enforcement prevents Starter tier from creating 2nd user
- [ ] 13.7 Write test: Storage quota correctly increments/decrements per organization
- [ ] 13.8 Write test: Trial expiration automatically downgrades to Starter tier
- [ ] 13.9 Write test: Subscription upgrade immediately applies new limits
- [ ] 13.10 Write test: Subscription downgrade scheduled at period end warns if over-limit
- [ ] 13.11 Run penetration tests: Attempt cross-tenant access via API parameter tampering
- [ ] 13.12 Run load tests: 100 concurrent organizations creating products simultaneously

## 14. Migration Finalization (Phase 5 - Week 7)

- [ ] 14.1 Run audit script: Verify all records have organizationId assigned
- [ ] 14.2 Create migration: ALTER TABLE Product ALTER COLUMN organization_id SET NOT NULL
- [ ] 14.3 Create migration: ALTER TABLE InventoryItem ALTER COLUMN organization_id SET NOT NULL
- [ ] 14.4 Create migration: Repeat for User, Upload, AuditLog, ItemTransaction, ExpiredItemTransaction
- [ ] 14.5 Add foreign key constraints: ON DELETE CASCADE for all organizationId references
- [ ] 14.6 Remove feature flag: Set MULTI_TENANT_ENABLED=true permanently in production
- [ ] 14.7 Remove legacy single-tenant code paths
- [ ] 14.8 Update environment variable templates with required Stripe keys
- [ ] 14.9 Run full test suite and verify 100% pass rate

## 15. Documentation (Phase 5 - Week 7)

- [ ] 15.1 Update README.md: Document multi-tenant architecture, organization model
- [ ] 15.2 Create `docs/multi-tenant-guide.md`: Organization creation, user management, data isolation
- [ ] 15.3 Create `docs/subscription-tiers.md`: Feature comparison, pricing, upgrade process
- [ ] 15.4 Create `docs/stripe-integration.md`: Webhook handling, subscription lifecycle, testing
- [ ] 15.5 Update `openspec/project.md`: Add multi-tenant conventions, tenant-scoped queries
- [ ] 15.6 Create migration guide for existing single-tenant deployments
- [ ] 15.7 Document trial system: Signup flow, conversion tracking, abuse prevention
- [ ] 15.8 Create operational runbook: Handling webhook failures, trial expirations, subscription issues

## 16. Monitoring & Observability (Phase 5 - Week 8)

- [ ] 16.1 Add metrics: trial_conversion_rate, avg_revenue_per_user, churn_rate
- [ ] 16.2 Add alerts: webhook_failure_rate >5%, trial_conversion_rate <10%, payment_failure_rate >2%
- [ ] 16.3 Create dashboard: Subscription tier distribution, usage by tier, revenue projections
- [ ] 16.4 Add logging: Cross-tenant access attempts (security), feature gate rejections (conversion)
- [ ] 16.5 Configure Sentry alerting for webhook processing errors
- [ ] 16.6 Create daily report: New trials, conversions, churns, revenue changes

## 17. Production Deployment (Phase 6 - Week 8)

- [ ] 17.1 Deploy schema migrations to production Neon PostgreSQL
- [ ] 17.2 **USER:** Run backfill scripts on production data (coordinate maintenance window with dev team to execute scripts)
- [ ] 17.3 Deploy backend code with multi-tenant routes + Stripe integration
- [ ] 17.4 Deploy frontend code with subscription management UI
- [ ] 17.5 **USER:** Configure production Stripe webhook endpoint in Stripe dashboard (update URL from test to production domain)
- [ ] 17.6 Enable trial system and monitor conversion rate
- [ ] 17.7 Monitor logs for cross-tenant access attempts (should be zero)
- [ ] 17.8 Verify webhook delivery success rate >99%
- [ ] 17.9 Run smoke tests: Create org, add products, upgrade tier, cancel subscription
- [ ] 17.10 **USER:** Announce multi-tenant SaaS launch to existing users (email + changelog post)

---

## 17.5 Critical Interdependencies & Clarifications (BLOCKING - Review Before Starting)

> **These items must be resolved BEFORE implementation begins. They affect multiple phases and task clarity.**

### Tier Feature Flags Seeding Verification (BLOCKING Phase 18.F)

- [ ] **17.5.1 CREATE**: After Phase 1.6 migrates tier_feature_flags, verify all tiers have correct features:
  - Script: `backend/scripts/verify-tier-flags.ts` that checks tier_feature_flags table
  - Verify all 4 tiers (starter, professional, premium, concierge) have: `max_skus`, `max_users`
  - Verify values match TIER_LIMITS: Starter (500, 1), Professional (2,000, 3), Premium (null, 10), Concierge (null, 10)
  - Log ERROR + exit if any tier missing features
  - Run on app startup in Phase 18.F.2
  - **Blocker for**: Phase 9+ (Stripe service needs correct tier limits)

### Inventory Items vs Products Clarification (BLOCKING Phase 18.D.2)

- [ ] **17.5.2 CLARIFY**: Confirm SKU limit semantics:
  - Does `organization_usage.total_skus` count Products or InventoryItems?
  - **Most likely**: SKU = Product record (e.g., "Aspirin 500mg"), InventoryItem = instance with expiry. Only Products count toward limit.
  - Update Phase 18.D.2: Apply `checkUsageLimit('max_skus')` to POST /products ONLY, NOT POST /inventory-items
  - **Blocker for**: Phase 6.5, 6.8, task 18.D.2

### Existing User Onboarding (BLOCKING Phase 18.C.1)

- [ ] **17.5.3 DESIGN**: Single-tenant users → multi-tenant migration:
  - **MVP Decision**: One User per Organization (matches "single concurrent user per location")
  - Existing user creates org on first login OR via POST /api/onboard endpoint
  - Onboard: Accept `{ organization_name, confirmation_pin }`, create org + Professional trial
  - Document in Phase 15.6 (migration guide)
  - **Blocker for**: Phase 18.C (signup), Phase 15.6

### Email Service Integration (BLOCKING Phase 18.C.4, 18.G.1-2)

- [ ] **17.5.4 VERIFY**: Email service exists and is configured:
  - Check if `EmailService` already exists in `backend/src/services/`
  - If missing: Create with methods for trial reminder, past_due notification, downgrade warning
  - Verify email provider API key (SendGrid/Resend/etc.) in `.env`
  - **Blocker for**: Phase 18.C.4, 18.G.1, 18.G.2

### Stripe Customer Metadata (BLOCKING Phase 9 & 18.B)

- [ ] **17.5.5 STANDARD**: When creating Stripe customers in Phase 9, **ALWAYS set metadata**:
  - `stripe.customers.create({ metadata: { organizationId: "org-uuid" } })`
  - Webhook handlers use this to route events → correct org
  - **Blocker for**: Phase 9.3, Phase 18.B.3.1-6

### Multi-User Org Model (BLOCKING Phase 18.C.1)

- [ ] **17.5.6 MVP SCOPE**: Is multi-user in scope for MVP?
  - **Decision**: NO - Single user per org for MVP. Tiers have user limits as placeholders.
  - POST /users should reject 2nd user creation (return 403 "user limit reached")
  - Multi-user/RBAC is Phase 2 work
  - **Blocker for**: Phase 18.C.1, Phase 6.7-6.9

### Storage Calculation (BLOCKING Phase 18.D.3)

- [ ] **17.5.7 AUDIT**: How are storage bytes calculated (Uploads, R2, etc.)?
  - Check existing storage-quota.service.ts implementation
  - Ensure per-organization byte counting works
  - Phase 18.D.3 implementation depends on this
  - **Blocker for**: Phase 18.D.3

### Downgrade Policy (BLOCKING Phase 18.B.3.2 & 18.G.2)

- [ ] **17.5.8 POLICY**: What happens when downgrading to lower SKU limit?
  - Example: 3,000 products on Premium (unlimited) → downgrade to Professional (2,000 limit)
  - **Decision**: Block downgrade (prevent, send warning email 3 days before)
  - Phase 18.G.2 sends warning email
  - Phase 18.B.3.2 (updateSubscription handler) should validate before allowing downgrade
  - **Blocker for**: Phase 18.B.3.2, Phase 18.G.2

### Dunning Flow (BLOCKING Phase 18.G.1)

- [ ] **17.5.9 SPEC**: Exact dunning process:
  - Day 0: `invoice.payment_failed` → status=past_due, queue email
  - Days 1-5: Stripe auto-retries (configure in Stripe dashboard)
  - Day 7: If still past_due, downgrade to Starter tier + cancel subscription
  - Implement as daily cron job that finds past_due > 7 days, auto-downgrades
  - **Blocker for**: Phase 18.B.3.5, Phase 18.G.1

### Phase 11 vs 18.C (CLARIFICATION)

- [ ] **17.5.10 CONSOLIDATE**: Phase 11 (Trial System) and Phase 18.C overlap.
  - Phase 18.C is the detailed implementation
  - Mark Phase 11 as "Research/Planning", Phase 18.C as "Implementation"
  - OR move Phase 11 tasks into Phase 18.C exactly

---

## 18. Prevention Tasks - Gap Closure (CRITICAL - Must Complete Before Phase 17)

> **Context**: Gap analysis identified 20 critical implementation gaps between design spec and current code. 
> These prevention tasks address root causes BEFORE deployment to avoid:
> - **Data leaks** from incomplete organizationId filtering
> - **Financial issues** from webhook processing failures  
> - **Zero revenue** from missing trial system
> - **Feature bypass** from unenforced limits
> - **Support overload** from edge case handling

### Phase 18.A: Data Isolation & Security (CRITICAL)

- [ ] 18.A.1 **AUDIT**: Perform query-level review of all 50+ database queries across all routes/services. Verify every query has `WHERE organizationId = ?` filter. Document any exceptions in [search_patterns.md](docs/multi-tenant-guide.md#query-patterns)
- [ ] 18.A.2 **ENFORCE**: Make `organizationId` required parameter in all service methods. Add JSDoc @param organizationId (required). Refactor any service method accepting raw query without org parameter
- [ ] 18.A.3 **TEST**: Add integration test: Create org A and org B, add products, verify org A cannot see org B products via API. Test cross-tenant access attempts via parameter tampering
- [ ] 18.A.4 **MIGRATE**: Create migration: Run pre-flight audit script to find any orphaned records with NULL organizationId. Assign to default org or delete. Document findings
- [ ] 18.A.5 **CONSTRAIN**: Create migration: ALTER TABLE Product/InventoryItem/User/Upload SET organizationId NOT NULL. Add CHECK constraint: `organizationId IS NOT NULL`
- [ ] 18.A.6 **COMPLIANCE**: Add Sentry rule to alert on 403 "cross-tenant access denied" >1/hour (indicates probe attempts)

### Phase 18.B: Webhook & State Sync (CRITICAL - Revenue Protection)

- [ ] 18.B.1 **CREATE TABLE**: Create migration: `processed_webhook_events(id TEXT PRIMARY KEY, event_type TEXT, processed_at TIMESTAMP, INDEX(event_type, processed_at))`
- [ ] 18.B.2 **IDEMPOTENCY**: Update webhook.service.ts: Replace in-memory Map with database lookup. Implement `isNewEvent()` with SQL query + `markEventProcessed()` with INSERT. Handle unique constraint gracefully
- [ ] 18.B.3 **IMPLEMENT HANDLERS**: Complete all 6 empty webhook handlers in webhook.service.ts:
  - [ ] 18.B.3.1 `handleSubscriptionCreated`: Create subscription_tiers record, set status=active, update organization_usage limits
  - [ ] 18.B.3.2 `handleSubscriptionUpdated`: Update tier_level, billing_cycle, current_period_end. Handle tier downgrades (reduce limits immediately)
  - [ ] 18.B.3.3 `handleSubscriptionDeleted`: Set status=canceled, downgrade organization to Starter tier, log downgrade event
  - [ ] 18.B.3.4 `handleCheckoutSessionCompleted`: Find subscription_tiers by Stripe subscription ID, set is_trial=false (mark paid)
  - [ ] 18.B.3.5 `handleInvoicePaymentFailed`: Set status=past_due, log to dunning queue. Queue retry email (NOT disabled auto-retry in Stripe)
  - [ ] 18.B.3.6 `handleTrialWillEnd`: Queue reminder email via email service. Test with Stripe test events
- [ ] 18.B.4 **CRON JOB**: Create scheduled task (cron or Bull queue): Every 1 hour, fetch all active subscriptions from Stripe API, sync to local subscription_tiers table. Log any divergences as warning
- [ ] 18.B.5 **TRANSACTION**: Wrap all webhook handlers in Prisma transactions. Use `$transaction()` to atomically update subscription_tiers + organization_usage + audit log
- [ ] 18.B.6 **VALIDATION**: Add pre-update validation in webhook handlers: Before updating subscription_tiers, verify organization exists. Log and skip if missing (prevents orphaned records)
- [ ] 18.B.7 **MONITORING**: Add Sentry alerts: webhook_handler_error >1/day, processed_webhook_events growth rate (detect replay attacks)

### Phase 18.C: Trial System (CRITICAL - Revenue Model)

- [ ] 18.C.1 **SIGNUP ENDPOINT**: Create POST /api/signup endpoint:
  - [ ] Accept: email, password_pin, organization_name, phone
  - [ ] Validate email + phone uniqueness (prevent abuse)
  - [ ] Create organization record
  - [ ] Create subscription_tiers with trial_end_date = now + 14 days, status=trialing
  - [ ] Create organization_usage with Professional tier limits (to show value)
  - [ ] Log trial_started event
  - [ ] Return auth token + trial_end_date
- [ ] 18.C.2 **TRIAL DOWNGRADE CRON**: Create scheduled job (cron/Bull): Every 1 hour, find all subscription_tiers where trial_end_date < NOW and status=trialing. Update to status=active, tier_level=starter, reset organization_usage to Starter limits. Log trial_expired event
- [ ] 18.C.3 **TRIAL ABUSE PREVENTION**: Implement unique constraints in database:
  - [ ] Create migrations for email + phone uniqueness in organizations table
  - [ ] Add validation in signup endpoint: reject if email/phone used in last 90 days
  - [ ] Monitor signup rate per IP address (alert if >10/day)
- [ ] 18.C.4 **TRIAL REMINDERS**: Integrate email service into webhook handler `handleTrialWillEnd`:
  - [ ] Fetch organization + subscription_tiers
  - [ ] Calculate days until trial end
  - [ ] Send reminder email if trial_end_date in next 3 days
  - [ ] Log trial_reminder_sent event
- [ ] 18.C.5 **TRIAL CONVERSION CONVERSION TRACKING**: Add events to analytics.service:
  - Trial started: log on signup
  - Trial reminder sent: log in webhook handler
  - Trial converted: log in webhook handler (checkout.session.completed when trial ended)
  - Trial expired: log in cron downgrade
- [ ] 18.C.6 **TEST**: Write integration test:
  - Create trial org, verify trial_end_date is 14 days out
  - Advance time to day 10, trigger cron, verify reminder email queued
  - Advance time to day 15, trigger cron, verify downgraded to Starter + limits reset
  - Verify user cannot create products past Starter limit on day 15

### Phase 18.D: Feature Gating Enforcement (CRITICAL - Feature Bypass Prevention)

- [ ] 18.D.1 **AUDIT ROUTES**: Review all protected routes in product.routes.ts, inventory.routes.ts, user.routes.ts, upload.routes.ts, report.routes.ts. Add `checkUsageLimit()` middleware to POST routes, `requireFeature()` to premium routes
- [ ] 18.D.2 **APPLY MIDDLEWARE**: 
  - [ ] POST /products: Add `checkUsageLimit('max_skus')` after authenticateToken
  - [ ] POST /inventory-items: Add `checkUsageLimit('max_skus')` + `checkUsageLimit('max_users')`
  - [ ] POST /users: Add `checkUsageLimit('max_users')`
  - [ ] GET /api/analytics: Add `requireFeature('advanced_analytics')`
  - [ ] POST /uploads: Add `checkUsageLimit('storage_bytes')`
- [ ] 18.D.3 **STORAGE QUOTA FIX**: Update feature-gate.middleware.ts line 164: Replace hardcoded 10GB with query to subscription tier limits. Use TIER_LIMITS[tierLevel].storage_bytes (when implemented)
- [ ] 18.D.4 **RACE CONDITION FIX**: Update feature-gate.middleware.ts lines 149-157: Replace non-atomic create-if-missing with Prisma `upsert()`. OR move creation to org signup (Phase 1.6)
- [ ] 18.D.5 **TEST**: Write tests for all feature gates:
  - Starter user hits 500 SKU limit (POST 501st product → 403 Forbidden)
  - Professional user can create 2000+ SKUs (same request → 201 Created)
  - Starter user tries GET /api/analytics → 403 Forbidden with upgrade CTA
  - Usage warning appears at 80% limit (e.g., 400/500 SKUs)

### Phase 18.E: Token & Auth (CRITICAL - Access Correctness)

- [ ] 18.E.1 **AUDIT LOGIN FLOW**: Review auth.service.login() code. Verify it:
  - [ ] Queries subscription_tiers after PIN validation
  - [ ] Extracts tierLevel from subscription record
  - [ ] Returns tierLevel in login response (NOT hardcoded or default)
  - Add missing subscription query if needed
- [ ] 18.E.2 **TOKEN REFRESH**: Update auth.routes.ts token refresh endpoint (line 65):
  - [ ] Query subscription_tiers for current tierLevel
  - [ ] Call generateToken() with fresh tierLevel (don't reuse from old token)
  - [ ] Test: Downgrade tier in Stripe, trigger webhook (sync subscription state), call /refresh, verify new token has Starter tier
- [ ] 18.E.3 **WEBHOOK METADATA VALIDATION**: In webhook handlers, before updating subscription_tier, verify:
  - Stripe customer metadata contains valid organizationId
  - Organization record exists in database
  - Log and skip if organization missing (don't create orphaned subscription records)
- [ ] 18.E.4 **TEST**: Integration test:
  - Login with org A, get token with Professional tier
  - Downgrade org A to Starter manually in DB (simulate failed payment)
  - Call /auth/refresh, verify returned token has Starter tier
  - Try to POST /products (with requireFeature), verify uses refreshed Starter limits

### Phase 18.F: Testing & Quality (CRITICAL - Regression Prevention)

- [ ] 18.F.1 **MULTI-TENANT CONCURRENCY**: Write load tests (Phase 13.11-13.12):
  - [ ] Spawn 10 concurrent requests to POST /products from different organizations
  - [ ] Verify each org's SKU counter incremented exactly once (no race condition)
  - [ ] Spawn requests near limit (e.g., 495/500 SKUs): verify both can create if total <500, both fail if >500
  - [ ] Use transaction isolation level testing
- [ ] 18.F.2 **TIER FEATURE FLAGS VALIDATION**: Create boot-time validation script:
  - [ ] On app startup, query tier_feature_flags table
  - [ ] Verify all 4 tiers (starter, professional, premium, concierge) have all required features
  - [ ] Log ERROR + exit if any tier missing features
  - [ ] Include in pre-flight health check endpoint (GET /health should 503 until flags verified)
- [ ] 18.F.3 **CROSS-TENANT ISOLATION TEST**: (Phase 13.1-13.3)
  - [ ] Create orgs A + B with different users
  - [ ] Verify Org A user cannot GET /products from Org B (even with valid token)
  - [ ] Test PUT/DELETE cross-tenant denial
  - [ ] Attempt parameter tampering: ?organizationId=other-org → denied
  - [ ] Add to CI/CD automated tests

### Phase 18.G: Operational (CRITICAL - Support Load)

- [ ] 18.G.1 **DUNNING STRATEGY**: Complete invoice.payment_failed handler (Phase 10.8):
  - [ ] Set subscription status to past_due
  - [ ] Queue retry email to organization owner
  - [ ] After 3 failed payment attempts: downgrade to Starter tier + log escalation alert
  - [ ] Integrate with Stripe's automatic retry (configure in Stripe dashboard)
- [ ] 18.G.2 **PENDING DOWNGRADE COMMUNICATION**: When subscription downgrade scheduled (e.g., day before period end):
  - [ ] If current usage > new tier limit, queue warning email
  - [ ] Include: current limit, new limit, recommendation to delete products
  - [ ] Test: Upgrade to Premium (unlimited SKUs), add 3000 SKUs, downgrade to Professional (2000 SKUs), verify warning sent
- [ ] 18.G.3 **OPERATIONAL RUNBOOK**: Document:
  - [ ] How to manually sync subscription state from Stripe (if cron fails)
  - [ ] How to rescue failed webhook events (replay from processed_webhook_events table)
  - [ ] How to handle customer disputes (find event in audit log, verify Stripe state matches)
  - [ ] How to diagnose cross-tenant leaks (check organizationId NULL queries, audit logs)

### Phase 18.H: Edge Cases & Integration (CRITICAL - Prevents Unexpected Failures)

- [ ] 18.H.1 **TRIAL CHECKOUT RACE**: What if trial expires DURING Stripe checkout?
  - [ ] Scenario: User on day 13 of trial, starts checkout, trial expires (day 14 limit reached) mid-checkout
  - [ ] Solution: Webhook handles trial expiry by downgrading org. But user might complete checkout for Professional tier.
  - [ ] Implementation: `handleCheckoutSessionCompleted` should always honor the paid upgrade, ignore trial_end_date
  - [ ] Test: Manually trigger checkout on day 13, advance time to day 15 using stub, complete session, verify org remains Professional

- [ ] 18.H.2 **TIER FLAG SEEDING RACE**: Multiple app instances boot concurrently, both try to seed tier_feature_flags
  - [ ] Solution: Use `UNIQUE` constraint + `INSERT IGNORE` / `ON CONFLICT DO NOTHING`
  - [ ] Verify Phase 1.6 migration uses idempotent insert, not `INSERT INTO ... VALUES` which fails on duplicate
  - [ ] Test: Run app with 2 instances simultaneously, verify both boot successfully

- [ ] 18.H.3 **DOWNGRADE OVER-LIMIT EDGE CASE**: User downgrades mid-billing-cycle when at limit
  - [ ] Scenario: Professional (2,000 limit) with 2,000 products on day 15 of month, manually downgrades to Starter (500 limit)
  - [ ] Current implementation (17.5.8): Block downgrade, send warning email
  - [ ] Solution: Block downgrade, require user to delete 1,500 products first OR downgrade at period end
  - [ ] Implementation: Routes should reject downgrade if `current_usage > new_tier_limit`, return 403 with "Delete X products to downgrade"
  - [ ] Test: Create org, add 1,500 products (fake), attempt downgrade, verify 403

- [ ] 18.H.4 **WEBHOOK EVENT ORDERING**: What if `subscription.updated` arrives BEFORE `subscription.created`?
  - [ ] Scenario: If Stripe sends events out of order (rare but possible with network delays)
  - [ ] Solution in Phase 18.B.3.1-3.2: Handler should check if subscription_tiers record exists
  - [ ] If doesn't exist, create it first, then apply update
  - [ ] Test: Manually send out-of-order webhooks via Stripe CLI, verify idempotent handling

- [ ] 18.H.5 **STORAGE QUOTA CONCURRENCY**: Two users upload files simultaneously, both near 10GB limit
  - [ ] Scenario: Org at 9.99GB limit, two users try to upload 100MB files concurrently
  - [ ] Solution: `checkUsageLimit('storage_bytes')` middleware should use transactional lock
  - [ ] Implementation: Query organisation_usage with `SELECT ... FOR UPDATE` to prevent race condition
  - [ ] Prisma doesn't support `FOR UPDATE`, so use raw SQL in middleware or service layer
  - [ ] Test: Concurrent upload requests to same org near limit, verify both don't exceed quota

- [ ] 18.H.6 **SKU DUPLICATE CHECK WITH ORG**: Product uniqueness is `(organizationId, SKU)`, not just SKU
  - [ ] Scenario: Org A creates SKU "ASPIRIN-500", then Org B tries to create same SKU
  - [ ] Solution: Schema already has `UNIQUE(organizationId, sku)` (Phase 1.8), so this is handled
  - [ ] Verify: Check migration that it actually created the unique constraint in target DB
  - [ ] Test: Create org A with SKU "TEST-1", create org B with SKU "TEST-1", verify both succeed (different orgs)

- [ ] 18.H.7 **PARTIAL WEBHOOK FAILURES**: Handler succeeds for some orgs but fails for batch
  - [ ] Scenario: Webhook handler processes 100 org downgrades, 99 succeed, 1 fails due to missing org
  - [ ] Current implementation: Handler is atomic per org, doesn't batch. So failure is per-event, not per-batch.
  - [ ] Solution: Already atomic (Phase 18.B.5), so if one update fails, webhook is retried (not skipped for other orgs)
  - [ ] Test: Create webhook scenario with missing org, verify error handling + retry logic

- [ ] 18.H.8 **TRIAL SIGNUP DUPLICATE EMAIL TXN**: Two signup requests arrive simultaneously with same email
  - [ ] Scenario: Race condition during email uniqueness check + insertion
  - [ ] Solution: DB `UNIQUE` constraint on email in organizations table (Phase 17.5.3)
  - [ ] Implementation: Catch `Prisma.PrismaClientKnownRequestError` with code P2002 (unique violation)
  - [ ] Return 409 "Email already registered" or 400 "Try again in 24 hours" (for abuse prevention)
  - [ ] Test: Concurrent signup requests with same email, verify one succeeds, other gets 409

- [ ] 18.H.9 **TOKEN STALENESS ON RAPID TIER CHANGE**: User changes tier twice in 5 seconds
  - [ ] Scenario: User on Professional, downgrades to Starter, immediately upgrades to Premium. Token is stale.
  - [ ] Solution: Phase 18.E.2 (token refresh) queries latest subscription_tiers, so next request has fresh tier
  - [ ] But current request will use old tier until token expires (1 hour)
  - [ ] Acceptable but risky: If user downgrades, limits are still high until token refresh
  - [ ] Improvement: Add `X-Org-Tier-Version` header to responses, client can force /refresh if version changed
  - [ ] For MVP: Acceptable. Monitor for this in logs (Phase 16.4)
  - [ ] Test: Downgrade tier, immediately POST product, verify product creates with old limits until refresh

- [ ] 18.H.10 **SOFT-DELETED ORGANIZATIONS**: Can we soft-delete orgs (for compliance) vs hard-delete?
  - [ ] Scenario: Customer wants account deleted for GDPR compliance
  - [ ] Current schema: No `deleted_at` field on organizations
  - [ ] Decision: Hard-delete for MVP (easier), soft-delete in Phase 2 if needed
  - [ ] Implementation in Phase 18.A.4: When deleting org, also delete all related records (cascade)
  - [ ] Verify: Test org deletion, confirm all products/users/uploads/subscriptions are deleted
  - [ ] Test: Create org, add data, delete org, verify cascade + no orphans

### Phase 18.I: Documentation Gaps (CRITICAL - Prevents Support Overload)

- [ ] 18.I.1 **TIER DOWNGRADE GUIDE**: Create guide for when usage exceeds new tier limit:
  - Document which products/inventory to delete to free space
  - Provide CSV export of excess products before deletion
  - Explain limits per tier clearly (500 SKUs = 500 unique products, not instances)

- [ ] 18.I.2 **WEBHOOK TROUBLESHOOTING**: Document common webhook failures:
  - Signature verification failed → check `STRIPE_WEBHOOK_SECRET` in `.env` matches Stripe dashboard
  - Webhook timeout → check Stripe event retry logs
  - Organization not found → check Stripe customer metadata contains correct `organizationId`

- [ ] 18.I.3 **TRIAL EXPIRATION FAQ**: Document trial behavior:
  - Trial starts on day 1, expires on day 14 at midnight UTC
  - Reminder sent on days 10, 12, 14
  - On day 15, if no payment → auto-downgrade to Starter tier
  - After downgrade, can still create up to 500 SKUs

- [ ] 18.I.4 **PAST_DUE RECOVERY**: Document dunning workflow:
  - Payment fails → past_due status (access still works)
  - Email sent with payment update link
  - After 7 days + failed retries → auto-downgrade to Starter
  - Can't recover deleted products, so downgrade before deleting products

- [ ] 18.I.5 **CROSS-TENANT ISOLATION ASSURANCE**: Document for compliance teams:
  - All queries include `WHERE organizationId = ?` filter
  - Unique constraints are `(organizationId, sku)` not just `sku`
  - Audit logs track all data access by organization
  - Penetration tests confirm no cross-tenant access possible

---

**Phase 18 Effort Estimate**: 40-50 hours (prevention + edge cases + docs)  
**Phase 18 Critical Path**: Clarifications (17.5) → Data isolation (18.A) → Webhooks (18.B) → Trial (18.C) → Feature gating (18.D) → Auth (18.E) → Edge cases (18.H)  
**MUST COMPLETE before Phase 17 Production Deployment**

---

## 20. Validation Checklist (Run Before Phase 17 Deployment)

**Must-Pass Gates**:
- [ ] 20.1 All Phase 17.5 blocking items resolved (10 clarifications answered)
- [ ] 20.2 Phase 6-7 routes/services fully verified with integration tests (6.13 passes)
- [ ] 20.3 Phase 9 Stripe service fully implemented (createSubscription, updateSubscription, cancelSubscription working)
- [ ] 20.4 Phase 10 webhook handlers fully implemented (all 6 handlers + idempotency + transactions)
- [ ] 20.5 Phase 18 edge cases (18.H.1-10) all addressed + tested
- [ ] 20.6 Email service integrated (Phase 17.5.4) and tested with real emails
- [ ] 20.7 Storage quota calculation (Phase 17.5.7) verified per-organization
- [ ] 20.8 Tier feature flags boot-time validation passing (Phase 18.F.2)
- [ ] 20.9 Cross-tenant isolation tests passing (Phase 18.F.3, penetration tests)
- [ ] 20.10 Load tests for concurrency passing (Phase 18.F.1)
- [ ] 20.11 Schema audit script passing on test DB (Phase 14.1, Phase 18.A.4)
- [ ] 20.12 Stripe test mode webhook delivery 100% success for 24 hours
- [ ] 20.13 All Sentry alerts configured (Phase 16 + Phase 18.B.7)
- [ ] 20.14 Operational runbook complete (Phase 18.G.3) and team trained

---

## Resource Planning & Estimates

**Total Tasks**: 191 (161 original + 15 clarifications + 15 gap prevention)  
**Estimated Effort**: **9-10 weeks (100-130 hours)**

**Phase Breakdown**:
| Phase | Scope | Hours | Blocker |
|-------|-------|-------|---------|
| 1-5 | **Schema, Auth, Feature Gating** | 30 | Done ✅ |
| 6-7 | **Routes, Services** | 15 | Verify completion |
| 8-10 | **Stripe Integration** | 25 | Phase 6-7 must be done |
| 11-12 | **Trial System, UI** | 15 | Phase 9-10 must be done |
| 13-17 | **Testing & Deployment** | 20 | Phase 11-12 must be done |
| **17.5** | **Blocking Clarifications** | 3 | START HERE ⚠️ |
| **18.A-E** | **Data Isolation, Webhooks, Trial, Feature Gating, Auth** | 30 | Must complete before 17 |
| **18.F-I** | **Testing, Edge Cases, Clarifications** | 20 | Before production |
| **20** | **Validation & Go-Live** | 5 | Final gate |

**Critical Path** (longest dependent chain):
```
17.5 (Clarifications) → 
9 (Stripe Service) → 
10 (Webhook Handlers) →
18.B (Webhook State Sync) →
18.C (Trial System) →
18.H (Edge Cases) →
17 (Deployment)
```

**Recommended Team Assignment**:
- **Backend Lead**: 17.5 clarifications, Phase 9-10, Phase 18.A-I
- **Frontend Lead**: Phase 12, Phase 18.D (UI feature gates)
- **DevOps/QA**: Phase 14-17, Phase 18.F (testing & deployment)
- **Product/Operations**: Phase 15-16, Phase 18.G (docs & monitoring)

**Start Date**: Week 1 → Production Deployment: Week 10-11  
**Risk Level**: **HIGH** - Multi-tenant + SaaS billing = zero-tolerance for data leaks or financial errors

---

## 🎯 Final Summary: What Changed

### Completeness Pass Results

✅ **Original 161 tasks:** Validated & re-confirmed  
✅ **Phase 17.5 added:** 10 blocking clarifications that MUST be resolved first  
✅ **Phase 18.A-I added:** 40 detailed prevention tasks across 8 categories  
✅ **Phase 18.H added:** 10 edge case scenarios with solutions  
✅ **Phase 18.I added:** 5 documentation gaps  
✅ **Phase 20 added:** 14-item validation checklist before go-live  

### New Total: 220+ Items (vs. 161 original)

**Task Count:**
- Original: 161 tasks
- Phase 17.5 (Clarifications): 10 discrete questions
- Phase 18 (Prevention): 40+ sub-tasks
- Phase 18.H (Edge Cases): 10+ sub-tasks  
- Phase 18.I (Documentation): 5 tasks
- Phase 20 (Validation): 14 gates
- **Total: 240+ specific items**

**Effort:**
- **Original estimate: 7-8 weeks (65-85 hours)**
- **Revised estimate: 9-10 weeks (100-130 hours)**
- **+25-50% effort** due to prevention-focused approach
- **Pays for itself 10x in production quality** (prevention vs. fixing in prod)

### Critical Path (Longest Dependent Chain)

```
START
  ↓
Phase 17.5 (Clarifications) - MUST RESOLVE FIRST ⚠️
  ↓
Phase 1-5 (Schema/Auth) ✅ DONE
  ↓
Phase 6-7 (Routes/Services) - VERIFY COMPLETION
  ↓
Phase 9 (Stripe Service)
  ↓
Phase 10 (Webhook Handlers)
  ↓
Phase 18.B (Webhook State Sync)
  ↓
Phase 18.C (Trial System)
  ↓
Phase 18.H (Edge Cases)
  ↓
Phase 18.F (Testing)
  ↓
Phase 20 (Validation - 14 gates)
  ↓
PRODUCTION DEPLOYMENT
```

### Blockers Identified (Must Resolve Before Continuing)

| Blocker | Prevents | Solution |
|---------|----------|----------|
| **Phase 17.5.1** (Tier flag verification) | Phase 9+ | Create boot-time validation script |
| **Phase 17.5.2** (SKU semantics) | Phase 6.5, 18.D.2 | Clarify: Only Products count, not InventoryItems |
| **Phase 17.5.3** (User onboarding) | Phase 18.C.1 | Design single-user-per-org MVP flow |
| **Phase 17.5.4** (Email service) | Phase 18.C.4, 18.G | Integrate email provider or build EmailService |
| **Phase 17.5.5** (Stripe metadata) | Phase 9.3, 18.B | Set `organizationId` in customer metadata |
| **Phase 17.5.6** (Multi-user scope) | Phase 18.C.1, Phase 6.7 | Confirm MVP = single user per org |
| **Phase 17.5.7** (Storage calculation) | Phase 18.D.3 | Verify storage byte counting works per-org |
| **Phase 17.5.8** (Downgrade policy) | Phase 18.B.3.2, 18.G.2 | Define: block vs. prune vs. warn |
| **Phase 17.5.9** (Dunning flow) | Phase 18.B.3.5, 18.G.1 | Spec exact retry timeline + downgrade |
| **Phase 17.5.10** (Phase 11 vs 18.C) | Task management clarity | Consolidate trial system tasks |

### Red Flags That Stop Deployment ⛔

If ANY of these are true on deployment day, **DO NOT DEPLOY**:

1. ❌ Phase 17.5 items remain unresolved or unanswered
2. ❌ Cross-tenant tests fail (Phase 13.3 or 18.A.3)
3. ❌ Webhook idempotency test fails (replay test in Phase 18.B.2)
4. ❌ Tier feature flags validation fails on startup (Phase 18.F.2)
5. ❌ Load test shows race conditions (Phase 18.F.1)
6. ❌ Email service not configured or tested (Phase 17.5.4)
7. ❌ Stripe customer metadata not being set (Phase 17.5.5)
8. ❌ Any Phase 20 gate fails (14 validation items)
9. ❌ Penetration test finds cross-tenant data leak
10. ❌ Webhook delivery success <99% in 24-hour test

### Key Differences from Original Plan

**Original Assumption**: All implementation details are clear  
**Reality Found**: 10 blocking clarifications + 20 edge cases not specified  

**Original Approach**: "Implement first, test later"  
**New Approach**: "Clarify first, prevent later, test thoroughly"  

**Original Tests**: Phases 13, 16  
**New Tests**: Phase 18.F (concurrency), Phase 18.H (edge cases), Phase 20 (validation gates)

**Original Documentation**: Phases 15  
**New Documentation**: + Phase 18.I (edge case docs & troubleshooting)

---

## 🚀 Next Steps (In Order)

### Week 1: Resolution Phase
1. **Team Meeting**: Review Phase 17.5 (10 questions)
2. **Decisions**: Document answers to all 17.5 items
3. **Update**: Modify this document with decisions
4. **Prep**: Set up Stripe account (Phase 8 user tasks)

### Weeks 2-4: Foundation
1. **Verify** Phase 1-5 are truly complete (run all tests)
2. **Implement** Phase 6-7 if not complete (routes, services)
3. **Prepare** Phase 9 (Stripe Service) code structure

### Weeks 5-7: Core Implementation
1. **Phase 9**: Stripe Service (createSubscription, etc.)
2. **Phase 10**: Webhook Handlers (all 6 implemented)
3. **Phase 18.B**: Webhook State Sync (database idempotency)
4. **Phase 18.C**: Trial System (signup, downgrade cron)

### Weeks 8-9: Quality & Safety
1. **Phase 18.A-E**: Data isolation, feature gating, auth, testing
2. **Phase 18.H**: Edge case handling (10 scenarios)
3. **Phase 18.F**: Load tests, concurrency tests, isolation tests

### Week 10: Validation & Deploy
1. **Phase 18.G**: Operations & runbooks
2. **Phase 20**: Run all 14 validation gates
3. **Smoke tests**: Create org, add products, upgrade, cancel
4. **Deploy**: Phase 17 production deployment

---

## 📊 Success Metrics (Post-Launch Monitoring)

- **Zero cross-tenant data access incidents** in first 30 days
- **Trial conversion rate** > 15% (KPI for business model)
- **Webhook delivery success rate** > 99%
- **Payment failure rate** < 2% (Stripe dunning working)
- **Support tickets per 100 customers** < 5/month
- **System uptime** > 99.5%
- **Subscription revenue** tracking correctly (Stripe sync good)

---

**Status**: ✅ **COMPREHENSIVE REVIEW COMPLETE**  
**Recommendation**: Start with Phase 17.5 clarifications immediately  
**Owner**: Backend Lead (coordinate with Product & DevOps)  
**Due Date for Clarifications**: EOW (end of week)  
**Deploy Target**: Week 10-11

