# Proposal: Plan SaaS Monetization Model

## Why

**Current State**: Architecture audit confirmed the system is currently single-tenant with zero tenant isolation. Before implementing multi-tenant data model, routes, auth, and subscription infrastructure, we must decide on the monetization strategy. The economic model drives schema design (e.g., per-organization storage limits, plan tiers, feature gates).

**Opportunity**: Lock down the monetization model now so implementation can build the correct subscription/billing infrastructure (Stripe integration, quota enforcement, feature flags) in one coordinated change rather than retrofitting later.

**Why Now**: Phase 13 (security hardening) and Phase 12 (service refactoring) are in progress but neither addresses multi-tenancy. This is the moment to finalize requirements before Phase 14 (multi-tenant SaaS foundation) begins implementation.

## What Changes

We will research and document:
- **Freemium model** (free storage tier, paid cloud storage overages) vs **Tiered subscription model** (free/pro/enterprise with plan-based feature sets)
- **Pricing tiers** (storage limits, max users, features per tier)
- **Stripe integration approach** (products, prices, webhooks, subscription lifecycle)
- **Tenant model confirmation**: Pharmacy location = one tenant (single concurrent user per location expected)
- **Billing features**: Subscription management, invoicing, plan upgrades/downgrades, trial periods

**Outcome**: Agreed specification document that drives Phase 14 implementation schema, auth, and subscription code.

## Capabilities

### New Capabilities

- `saas-monetization-strategy`: Decision framework comparing freemium vs tiered models with cost/benefit analysis
- `stripe-billing-integration`: Stripe product setup, price configuration, webhook handlers for subscription lifecycle
- `subscription-management`: Organization subscription CRUD (create, upgrade, downgrade, cancel) with plan enforcement
- `subscription-quota-enforcement`: Storage and feature limits enforced per organization's current subscription tier
- `multi-tenant-data-model`: Organization entity with subscription reference, tenantId on all shared resources

### Modified Capabilities

- `authentication`: Will need tenant context in JWT (organizationId) — requires updated auth flow
- `user-management`: Will need to scope users to organization and handle organization membership
- `storage-abstraction-layer`: Will need to enforce per-org storage quotas based on subscription tier

## Impact

**Code Areas**:
- Schema: Add `Organization`, `Subscription`, `Plan` models; add `organizationId` FK to all shared resources
- Auth: Extend JWT to include `organizationId`; validate tenant context on all protected routes
- Services: All services must filter by `organizationId`
- Frontend: Display appropriate features/limits based on organization's subscription tier
- Workers/Edge: May need rate-limiting or feature gates per subscription tier

**External Dependencies**:
- Stripe account setup (products, prices, webhooks)
- Stripe Node.js SDK configuration
- Payment method storage (PCI considerations)

**Breaking Changes**: None yet (this is research phase). Implementation phase (Phase 14) will require breaking schema and auth changes.

---

## Research Questions to Resolve

### 1. Monetization Model (Freemium vs Tiered)

**Freemium Model**
- ✅ Free tier: 1 GB cloud storage (or 5 user imports/month)
- ✅ Paid: $X/month per additional GB (or $X flat for unlimited)
- **Pros**: Low barrier to entry, users grow into paid plan
- **Cons**: Hard to predict revenue, storage-cost correlation may flip at scale

**Tiered Subscription Model**
- ✅ Free: 1 GB storage, 1 location, email support
- ✅ Pro: 10 GB storage, 5 locations, priority support
- ✅ Enterprise: 1 TB storage, unlimited locations, custom support
- **Pros**: Predictable revenue, clear upsell path, can add feature gates (e.g., audit logs on Pro+)
- **Cons**: Harder to exceed limit; users may stay on free tier longer

**Recommendation for Research**: Create cost model for both scenarios at different user counts (100, 1k, 10k, 50k pharmacies). Research Deputy's pricing model for comparison.

### 2. Stripe Configuration

**Questions**:
- One Stripe customer per Organization or per User?
- Automatic subscription renewal (monthly/annual)?
- Test mode vs live mode transition?
- Subscription trial period (14 days free before charging)?
- Dunning (retry failed payments or cancel immediately)?

### 3. Plan Tiers & Pricing

**Open Questions**:
- Exact storage limits per tier?
- Max concurrent users per location (expected: 1, but edge case if team grows)?
- Feature gates (e.g., audit logs, API access, custom reports on Pro+)?
- Annual discount (e.g., 20% off if paid yearly)?

### 4. Tenant Model Confirmation

✅ **Decided**: One pharmacy location = one organization/tenant
✅ **Decided**: Single concurrent user expected in-store use case
✅ **Decided**: Stripe is billing provider

**Remaining**: Should we design for multi-user future (e.g., manager + team member roles within org)? Or optimize for single user + invite-only?

---

## Next Steps

1. **Research phase** (this change): Analyze competitor pricing, cost models, Stripe best practices
2. **Design document**: Create detailed specification with exact pricing, Stripe config, schema
3. **Specification**: Lock down requirements for phase-14 implementation
4. **Implementation** (phase-14): Schema, auth, routes, services, subscription lifecycle, Stripe webhooks

