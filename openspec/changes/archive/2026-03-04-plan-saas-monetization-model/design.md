# Design: SaaS Monetization Model & Multi-Tenant Foundation

## Context

**Current State**: The application is architected as a single-tenant system with:

- Zero tenant isolation at database layer (no `organizationId` on any model)
- JWT tokens containing only `{userId, role}` (no tenant context)
- All routes returning global data with no tenant filtering
- Storage quota service with TODO comments for multi-tenant support
- No subscription or billing model

**Target State**: Multi-tenant SaaS platform with:

- Pharmacy-level tenant isolation (one pharmacy = one organization)
- Four subscription tiers: Starter ($99/mo), Professional ($249/mo), Premium ($499/mo), Concierge ($1,099/mo)
- Stripe-based billing with subscription lifecycle management
- Feature gating based on subscription tier
- Storage and user limits enforced per organization

**Stakeholders**:

- Development team (implementation)
- Pharmacy customers (end users)
- Finance/billing (revenue tracking, churn management)
- Support team (tier-appropriate support workflows)

**Constraints**:

- Single concurrent user per pharmacy location expected (UI/UX optimized for this)
- Must support trial system (14 days, auto-downgrade to Starter if not converted)
- Stripe as billing provider (already decided)
- Must maintain backward compatibility during multi-tenant migration (existing data needs migration path)

## Goals / Non-Goals

**Goals:**

1. **Define monetization model**: Lock down pricing tiers, features per tier, revenue projections
2. **Design multi-tenant data model**: Schema changes to support organization-level tenant isolation
3. **Stripe integration architecture**: Products, prices, webhooks, subscription lifecycle
4. **Feature gating strategy**: Tier-based limits and capabilities enforcement
5. **Trial system design**: 14-day trials with automatic downgrade and conversion tracking
6. **Migration planning**: Path from single-tenant to multi-tenant without data loss

**Non-Goals:**

- Full implementation (this is planning/design phase)
- UI/UX design for subscription management screens (implementation concern)
- Add-on features (AI pricing, compliance reporting) — deferred to Phase 2
- Supplier partnership portal — deferred to Month 4+
- Multi-location support — deferred to Enterprise tier (future)

## Decisions

### 1. Monetization Model: Hybrid Tiered + Concierge Service

**Decision**: Adopt 4-tier subscription model with service-based differentiation

| Tier         | Price (Monthly) | SKUs      | Users | Support          | Key Features                                    |
| ------------ | --------------- | --------- | ----- | ---------------- | ----------------------------------------------- |
| Starter      | $99             | 500       | 1     | Email (48h)      | Manual tracking, weekly reports                 |
| Professional | $249            | 2,000     | 3     | Email (24h)      | Daily alerts, basic automation                  |
| Premium      | $499            | Unlimited | 10    | Phone (24h)      | Real-time alerts, API access, POS integration   |
| Concierge    | $1,099          | Unlimited | 10    | Dedicated (2-4h) | Premium + CSM, 5h onboarding, quarterly reviews |

**Rationale**:

- **Predictable revenue**: Generates $285K ARR at 100 customers vs freemium models which are harder to forecast
- **Clear upgrade path**: Feature-gating creates natural progression (SKU limits → user limits → automation → service)
- **Service defensibility**: Concierge tier (dedicated CSM, onboarding) is hard for competitors to replicate
- **Support economics**: Support intensity aligns with pricing (self-serve → dedicated)
- **Market validation**: Mirrors successful B2B SaaS models like Deputy

**Alternatives Considered**:

- **Freemium with storage overages**: Rejected due to unpredictable revenue and storage cost correlation risk
- **Flat $X/pharmacy pricing**: Rejected due to lack of upsell path for growing customers
- **Usage-based pricing**: Rejected due to complexity in billing and customer preference for predictable costs

**Financial Model**:

- Break-even: ~40 customers
- Target ARR at 100 customers: $285K
- Gross margin: 63%
- Infrastructure costs: $15K/year (Neon + Cloudflare R2)
- Support costs: $60K/year (0.5 FTE)

### 2. Multi-Tenant Data Model: Organization as Primary Tenant

**Decision**: Add `Organization` entity and `organizationId` foreign key to all shared resources

```sql
-- Core tenant entity
CREATE TABLE organizations (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Subscription tracking
CREATE TABLE subscription_tiers (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  tier_level ENUM('starter','professional','premium','concierge','enterprise'),
  stripe_subscription_id TEXT UNIQUE,
  stripe_customer_id TEXT UNIQUE,
  current_period_start TIMESTAMP,
  current_period_end TIMESTAMP,
  trial_end_date TIMESTAMP NULL,
  is_trial BOOLEAN DEFAULT true,
  billing_cycle ENUM('monthly','annual'),
  status ENUM('active','past_due','canceled','unpaid') DEFAULT 'active',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Feature flags by tier (static reference table)
CREATE TABLE tier_feature_flags (
  id UUID PRIMARY KEY,
  tier_level ENUM('starter','professional','premium','concierge'),
  feature_key TEXT NOT NULL,
  enabled BOOLEAN DEFAULT false,
  limit_value INT NULL, -- e.g., 500 for SKU limit, 1 for user limit
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(tier_level, feature_key)
);

-- Usage tracking per organization
CREATE TABLE organization_usage (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id),
  tier_level ENUM('starter','professional','premium','concierge'),
  active_users INT DEFAULT 0,
  max_users INT,
  total_skus INT DEFAULT 0,
  max_skus INT,
  storage_used_bytes BIGINT DEFAULT 0,
  max_storage_bytes BIGINT,
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**Schema Changes for Existing Models**:

- Add `organization_id UUID NOT NULL REFERENCES organizations(id)` to: Product, InventoryItem, StoreArea, User, Upload, AuditLog, ItemTransaction, ExpiredItemTransaction
- Add composite indexes: `(organization_id, created_at)`, `(organization_id, sku)`, `(organization_id, barcode)`
- Add unique constraints that include organizationId: `UNIQUE(organization_id, sku)` on Product

**Rationale**:

- One pharmacy location = one organization (single concurrent user expected)
- Organization is primary tenant boundary (all data scoped to org)
- Subscription state stored with organization (not user)
- Feature limits enforced at organization level (not user level)

**Alternatives Considered**:

- **Multi-location organizations**: Rejected for MVP (adds complexity, can add later as Enterprise feature)
- **User-level subscriptions**: Rejected (doesn't match pharmacy business model where location subscribes, not individual staff)
- **Workspace model**: Rejected (semantically unclear; "pharmacy" or "organization" is clearer)

### 3. Authentication: Tenant-Aware JWT Tokens

**Decision**: Extend JWT payload to include `organizationId` and validate tenant context on all requests

**Current TokenPayload** (Single-Tenant):

```typescript
interface TokenPayload {
  userId: number;
  role: string;
}
```

**New TokenPayload** (Multi-Tenant):

```typescript
interface TokenPayload {
  userId: number;
  organizationId: string; // UUID
  role: string; // Role within organization
  tierLevel: 'starter' | 'professional' | 'premium' | 'concierge'; // For feature gating
}
```

**Auth Flow Changes**:

1. **Login**: User provides PIN → System looks up user → validates organizationId → issues JWT with org context
2. **Middleware**: Extract `organizationId` from token → validate org exists and is active → store in `req.organizationId`
3. **Routes**: All queries filter by `req.organizationId`
4. **Services**: Accept `organizationId` as parameter, enforce in all database queries

**Rationale**:

- Prevents cross-tenant data access at middleware level
- Enables feature gating based on tier in token (reduces DB lookups)
- Simplifies route logic (organizationId always available in request)

**Security Considerations**:

- Token tampering prevented by JWT signature verification
- Organization existence validated on every request (not just during login)
- Role enforcement scoped to organization (Manager in Org A cannot manage Org B)

### 4. Stripe Integration: Subscription Lifecycle Architecture

**Decision**: Use Stripe Subscriptions with webhook-driven state synchronization

**Stripe Product Structure**:

```
Product: Pharmacy Expiry Management SaaS
├─ Price: starter_monthly ($99/month)
├─ Price: starter_annual ($990/year)
├─ Price: professional_monthly ($249/month)
├─ Price: professional_annual ($2,490/year)
├─ Price: premium_monthly ($499/month)
├─ Price: premium_annual ($4,990/year)
├─ Price: concierge_addon ($600/month, attached to Premium only)
```

**Webhook Handlers** (Critical for State Sync):
| Event | Handler Action | Database Update |
|-------|---------------|-----------------|
| `customer.subscription.created` | Create subscription_tier record | status=active, is_trial=true |
| `customer.subscription.updated` | Update tier_level, billing cycle | tier_level, current_period_end |
| `customer.subscription.deleted` | Downgrade to free tier | status=canceled, tier_level=starter |
| `customer.subscription.trial_will_end` | Send conversion email (3 days before) | (No DB change, trigger email) |
| `checkout.session.completed` | Mark trial as converted | is_trial=false |
| `invoice.payment_failed` | Mark subscription past_due, retry dunning | status=past_due |

**Webhook Reliability Requirements**:

- Idempotent handlers (check `event.id` before processing)
- Exponential backoff retry logic (up to 72 hours)
- Dead letter queue for failed events
- Alert on webhook failure rate >5% in 1-hour window

**Trial System**:

- 14-day trial on Professional tier features
- No payment method required to start trial
- Automatic downgrade to Starter on day 15 if not converted
- Daily email reminders (days 10, 12, 14)
- One trial per unique email/phone (prevent abuse)

**Rationale**:

- Stripe handles payment complexity (PCI compliance, dunning, invoices)
- Webhook-driven architecture ensures eventual consistency
- Trial on Professional tier (not Starter) increases perceived value
- Automatic downgrade reduces manual support burden

**Alternatives Considered**:

- **Poll Stripe API for subscription status**: Rejected (inefficient, introduces lag, misses real-time events)
- **Trial on Starter tier**: Rejected (low perceived value, users don't see automation benefits)
- **Require payment method for trial**: Rejected (higher friction, reduces trial sign-ups)

### 5. Feature Gating: Middleware-Based Enforcement

**Decision**: Implement feature gates as middleware validators before controller logic

**Feature Gate Implementation Pattern**:

```typescript
// Middleware: Check feature access
export const requireFeature = (featureKey: string) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { organizationId, tierLevel } = req; // From JWT

    // Lookup feature flag for this tier
    const feature = await prisma.tierFeatureFlag.findUnique({
      where: { tier_level_feature_key: { tier_level: tierLevel, feature_key: featureKey } },
    });

    if (!feature || !feature.enabled) {
      return res.status(403).json({
        error: 'Feature not available on your plan',
        upgradeUrl: '/subscription/upgrade',
      });
    }

    next();
  };
};

// Usage in routes
router.get(
  '/api/analytics',
  authenticateToken,
  requireFeature('advanced_analytics'),
  analyticsController,
);
```

**Usage Limit Enforcement** (e.g., SKU limit):

```typescript
// Service layer: Check before insert
export const createProduct = async (organizationId: string, productData: CreateProductDTO) => {
  // Check current usage
  const usage = await prisma.organizationUsage.findUnique({
    where: { organization_id: organizationId },
  });

  if (usage.total_skus >= usage.max_skus) {
    throw new FeatureLimitError(
      `SKU limit reached (${usage.max_skus}). Upgrade to add more products.`,
    );
  }

  // Create product and increment counter (transaction)
  return await prisma.$transaction([
    prisma.product.create({ data: { ...productData, organizationId } }),
    prisma.organizationUsage.update({
      where: { organization_id: organizationId },
      data: { total_skus: { increment: 1 } },
    }),
  ]);
};
```

**Rationale**:

- Middleware approach centralizes feature enforcement (DRY)
- Clear error messages with upgrade CTA improve conversion
- Usage counters updated atomically (prevents race conditions)
- Feature flags in database allow dynamic tier changes without code deploy

**Alternatives Considered**:

- **Service-layer checks only**: Rejected (easy to forget, inconsistent enforcement)
- **Frontend-only feature hiding**: Rejected (insecure, users can bypass)
- **Hard-coded tier checks in controllers**: Rejected (not DRY, hard to maintain)

### 6. Migration Strategy: Zero-Downtime Multi-Tenant Refactor

**Decision**: Phased migration with feature flags and parallel schema migration

**Phase 1: Schema Preparation** (No Breaking Changes)

1. Add `organizations` table
2. Add `subscription_tiers` table
3. Add `organization_id` column to all shared models as **NULLABLE** (allows existing data)
4. Create default organization for existing data
5. Backfill `organization_id` for all existing records
6. Add indexes on `(organization_id, ...)`

**Phase 2: Auth Layer** (Breaking Change - Coordinate with Users)

1. Update JWT payload to include `organizationId`
2. Update login flow to validate org membership
3. Update middleware to extract and validate `organizationId`
4. **Coordinate downtime**: All users must re-login after deployment

**Phase 3: Route & Service Refactor** (Gradual Rollout)

1. Update all routes to filter by `req.organizationId`
2. Update all services to accept `organizationId` parameter
3. Deploy with feature flag (e.g., `MULTI_TENANT_ENABLED=true`)
4. Monitor for cross-tenant data leaks

**Phase 4: Stripe Integration** (New Feature - No Breaking Changes)

1. Create Stripe products and prices
2. Implement webhook handlers
3. Deploy subscription management UI
4. Enable trial system

**Phase 5: Enforcement** (Make organizationId NOT NULL)

1. Validate all records have `organization_id`
2. Alter table to set `NOT NULL` constraint
3. Remove feature flag (multi-tenant now mandatory)

**Rollback Strategy**:

- Each phase can be rolled back independently
- Database migrations are reversible (down migrations)
- Feature flags allow disabling multi-tenant mode if critical issues found

**Rationale**:

- Phased approach reduces risk of catastrophic failure
- NULLABLE organizationId allows data backfill before enforcement
- Feature flags enable testing in production before full rollout
- Coordinated downtime for auth layer minimizes user impact (once)

## Risks / Trade-offs

| Risk                                                                 | Mitigation                                                                                                          |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Stripe webhook delivery failures**                                 | Implement idempotent handlers, exponential backoff retry, dead letter queue, alert on >5% failure rate              |
| **Trial abuse** (users creating multiple accounts)                   | Track by email + phone, implement CAPTCHA on signup, manual review for suspicious patterns                          |
| **Feature limit bypass** (users circumventing SKU/user limits)       | Enforce limits in service layer with database transactions, audit usage counters daily                              |
| **Migration data loss** (existing records not assigned to org)       | Pre-migration audit script, verify all records have organizationId before setting NOT NULL                          |
| **Cross-tenant data leak** (bug in filtering logic)                  | Comprehensive multi-tenant tests, audit all queries for organizationId filter, penetration testing                  |
| **Support overload at launch** (tier-inappropriate support requests) | Tiered support routing (Starter → chatbot/docs, Concierge → dedicated queue), clear tier expectations in onboarding |
| **Revenue leakage** (trial users not converting)                     | Monitor conversion funnel daily, automated reminder emails, upgrade discount on day 14                              |
| **Payment failure churn**                                            | Stripe dunning management, automated retry logic, proactive email before card expiry                                |

## Migration Plan

### Pre-Deployment (MVP Launch Prep)

- [ ] Set up Stripe account (test mode + production mode)
- [ ] Create products and prices in Stripe
- [ ] Configure webhook endpoints (expose `/api/webhooks/stripe`)
- [ ] Load test trial conversion flow (1,000+ concurrent users)
- [ ] Security audit: payment data handling, PII protection, webhook signature validation

### Deployment Sequence

1. **Week 1**: Deploy schema changes (organizations, subscription_tiers, organizationId as NULLABLE)
2. **Week 2**: Backfill organizationId for existing data, verify integrity
3. **Week 3**: Deploy auth layer changes (JWT with organizationId) - **COORDINATE DOWNTIME**
4. **Week 4**: Deploy route/service refactors with feature flag enabled
5. **Week 5**: Deploy Stripe integration, enable trial system
6. **Week 6**: Monitor metrics, fix issues, enable NOT NULL constraint on organizationId
7. **Week 7+**: Remove feature flag, declare multi-tenant GA

### Rollback Strategy

- Phase 1-2: Revert database migrations
- Phase 3-4: Disable feature flag (`MULTI_TENANT_ENABLED=false`)
- Phase 5: Cannot rollback after NOT NULL constraint (point of no return)

### Success Criteria

- [ ] Zero cross-tenant data access incidents in 30 days post-launch
- [ ] Trial conversion rate >15%
- [ ] Webhook delivery success rate >99%
- [ ] Support ticket volume <5/month per 100 customers
- [ ] API uptime >99.5%
- [ ] Break-even achieved within 6 months (target: 40 customers)

## Open Questions

1. **Multi-user within single pharmacy** (Future Decision)
   - Current design assumes 1 user per pharmacy (Starter tier)
   - Professional tier allows 3 users — do we need role-based permissions within org (e.g., Manager vs Team Member)?
   - **Recommendation**: Defer to Phase 2, start with all users as equals within org

2. **Annual discount percentage** (Pricing Decision)
   - Currently 10% discount for annual billing
   - Should this be 15% or 20% to incentivize annual commitments?
   - **Recommendation**: Start at 10%, A/B test higher discounts if annual uptake <30%

3. **Concierge onboarding logistics** (Operational)
   - 5-hour onboarding included — who delivers this?
   - Calendar integration required?
   - **Recommendation**: Use Calendly for scheduling, document onboarding playbook before launch

4. **Data retention enforcement** (Compliance)
   - Starter tier: 12-month data retention
   - How do we handle archiving? S3 Glacier? Manual export + delete?
   - **Recommendation**: Automated archiving to cold storage, export available before deletion

5. **API rate limiting implementation** (Technical)
   - Premium: 1,000 req/day, Concierge: 10,000 req/day
   - Which library? Redis-based? In-memory?
   - **Recommendation**: Use `express-rate-limit` with Redis backend for distributed rate limiting

---

**Next Steps**: Create specification documents for each capability, then implementation tasks for Phase 14.
