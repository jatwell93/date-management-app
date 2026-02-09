# Implementation Tasks: SaaS Monetization Model & Multi-Tenant Foundation

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

- [ ] 3.1 Create interface `Organization` in `backend/src/models/organization.model.ts`
- [ ] 3.2 Create interface `SubscriptionTier` in `backend/src/models/subscription-tier.model.ts`
- [ ] 3.3 Create interface `TierFeatureFlag` in `backend/src/models/tier-feature-flag.model.ts`
- [ ] 3.4 Create interface `OrganizationUsage` in `backend/src/models/organization-usage.model.ts`
- [ ] 3.5 Update `TokenPayload` interface in `backend/src/middleware/auth.middleware.ts` to include organizationId and tierLevel
- [ ] 3.6 Update `AuthRequest` interface to include `organizationId: string` and `tierLevel: TierLevel`
- [ ] 3.7 Add `organizationId: string` field to Product, InventoryItem, User, Upload models
- [ ] 3.8 Create type `TierLevel = 'starter' | 'professional' | 'premium' | 'concierge'` in `backend/src/types/subscription.ts`

## 4. Authentication Layer (Phase 2 - Week 3)

- [ ] 4.1 Update `generateToken()` in auth.middleware.ts to accept organizationId and tierLevel parameters
- [ ] 4.2 Update `generateToken()` to include organizationId and tierLevel in JWT payload
- [ ] 4.3 Update `authenticateToken()` middleware to extract organizationId and tierLevel from JWT
- [ ] 4.4 Add validation in middleware: Check organization exists and is not canceled before allowing request
- [ ] 4.5 Update login service to query user.organizationId after PIN validation
- [ ] 4.6 Update login service to query organization.subscription.tier_level for JWT
- [ ] 4.7 Add error handling: Reject login if organization.subscription.status='canceled'
- [ ] 4.8 Update login response to include organizationId in addition to token
- [ ] 4.9 Write unit tests for JWT generation with organization context
- [ ] 4.10 Write integration tests for login flow with multi-tenant validation

## 5. Feature Gating Middleware (Phase 2 - Week 3)

- [ ] 5.1 Create `requireFeature(featureKey: string)` middleware in `backend/src/middleware/feature-gate.middleware.ts`
- [ ] 5.2 Implement feature lookup: Query tier_feature_flags by tierLevel and featureKey
- [ ] 5.3 Return 403 Forbidden if feature not enabled for tier with upgrade CTA
- [ ] 5.4 Create `checkUsageLimit(limitKey: string)` middleware for SKU/user limits
- [ ] 5.5 Implement usage limit check: Query organization_usage and compare against max_skus/max_users
- [ ] 5.6 Return 403 Forbidden with upgrade message if limit reached
- [ ] 5.7 Write unit tests for feature gating with Starter/Professional/Premium tiers
- [ ] 5.8 Write tests for usage limit enforcement (e.g., 500 SKU limit on Starter)

## 6. Route Layer Refactor (Phase 3 - Week 4)

- [ ] 6.1 Update `/products` GET route: Filter by `WHERE organization_id = req.organizationId`
- [ ] 6.2 Update `/products` POST route: Add organizationId from req.organizationId before insert
- [ ] 6.3 Update `/products/:id` PUT/DELETE routes: Validate product.organization_id matches req.organizationId
- [ ] 6.4 Update `/inventory-items` GET route: Filter by req.organizationId
- [ ] 6.5 Update `/inventory-items` POST route: Add organizationId, check SKU limit with checkUsageLimit middleware
- [ ] 6.6 Update `/inventory-items/:id` PUT/DELETE routes: Validate item.organization_id matches req.organizationId
- [ ] 6.7 Update `/users` GET route: Filter by req.organizationId
- [ ] 6.8 Update `/users` POST route: Add organizationId, check user limit with checkUsageLimit middleware
- [ ] 6.9 Update `/uploads` GET route: Filter by req.organizationId
- [ ] 6.10 Update `/uploads` POST route: Add organizationId, check storage limit
- [ ] 6.11 Add feature gate to `/api/analytics` route: requireFeature('advanced_analytics')
- [ ] 6.12 Write integration tests for all routes with tenant filtering

## 7. Service Layer Refactor (Phase 3 - Week 4)

- [ ] 7.1 Update productService.getAllProducts() to accept organizationId parameter
- [ ] 7.2 Update productService.createProduct() to accept organizationId and increment organization_usage.total_skus
- [ ] 7.3 Update productService.deleteProduct() to decrement organization_usage.total_skus
- [ ] 7.4 Update inventoryService methods to filter by organizationId
- [ ] 7.5 Update userService methods to filter by organizationId
- [ ] 7.6 Update uploadService.recordUpload() to accept organizationId and update organization_usage.storage_used_bytes
- [ ] 7.7 Update uploadService.deleteUpload() to decrement organization_usage.storage_used_bytes
- [ ] 7.8 Create organizationService with getOrganization(), updateOrganization() methods
- [ ] 7.9 Write unit tests for services with organizationId parameter
- [ ] 7.10 Write tests for usage counter atomicity (increment/decrement in transactions)

## 8. Stripe Configuration (Phase 4 - Week 5)

- [ ] 8.1 **USER:** Create Stripe account and obtain API keys (test mode + production mode) at https://dashboard.stripe.com
- [ ] 8.2 **USER:** Create Stripe product "Pharmacy Expiry Management SaaS" in Stripe dashboard
- [ ] 8.3 **USER:** Create price: starter_monthly ($99/month) with metadata tier=starter
- [ ] 8.4 **USER:** Create price: starter_annual ($990/year) with metadata tier=starter
- [ ] 8.5 **USER:** Create price: professional_monthly ($249/month) with metadata tier=professional
- [ ] 8.6 **USER:** Create price: professional_annual ($2,490/year) with metadata tier=professional
- [ ] 8.7 **USER:** Create price: premium_monthly ($499/month) with metadata tier=premium
- [ ] 8.8 **USER:** Create price: premium_annual ($4,990/year) with metadata tier=premium
- [ ] 8.9 **USER:** Create price: concierge_addon ($600/month) with metadata addon=concierge
- [ ] 8.10 **USER:** Configure Stripe webhook endpoint in dashboard (Settings → Webhooks → Add endpoint → URL: https://yourdomain.com/api/webhooks/stripe)
- [ ] 8.11 **USER:** Add webhook endpoint secret to `.env` file as `STRIPE_WEBHOOK_SECRET` (copy from Stripe dashboard)
- [ ] 8.12 Document Stripe configuration in `docs/stripe-setup.md`

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

**Total Tasks**: 161 (9 skipped in Phase 2)  
**Estimated Effort**: 7-8 weeks (65-85 hours)  
**Critical Path**: Schema (Week 1-2) → Auth (Week 3) → Routes/Services (Week 4) → Stripe (Week 5-6) → Testing (Week 7) → Deploy (Week 8)
