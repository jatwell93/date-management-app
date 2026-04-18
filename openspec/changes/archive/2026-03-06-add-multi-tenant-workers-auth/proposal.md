# Proposal: Multi-Tenant Workers Support (Phase 8B)

## Status: PLAN - Ready for Review

**Change ID:** `add-multi-tenant-workers-auth`  
**Phase:** 8B of "Use Cloudflare R2 & Serverless Database"  
**Priority:** 🔴 CRITICAL - Blocks production deployment  
**Estimated Effort:** 8-10 hours across 4 implementation phases  
**Timeline:** Next 1-2 sprints

---

## Problem Statement

**Current Situation:**

- Cloudflare Workers handlers exist but lack multi-tenant authentication and authorization
- JWT tokens contain `organizationId`, but Workers handlers do NOT extract or validate it
- No subscription tier validation in Workers
- No feature gate enforcement (e.g., preventing Starter tier from accessing Premium features)
- No usage limit checks (e.g., Starter tier limited to 500 SKUs)

**Risk:**

- 🚨 Production Workers would allow cross-tenant data access
- 🚨 Subscription limits would be bypassed
- 🚨 Canceled organizations would still have access
- **Production deployment is BLOCKED until this phase completes**

---

## Solution Overview

Port multi-tenant authentication from backend Express middleware to edge-native Cloudflare Workers handlers. This involves:

1. **Auth Context Extraction** — Verify JWT, extract organizationId, validate subscription
2. **Feature Gate Enforcement** — Check tier-based feature access and usage limits
3. **Handler Updates** — Add organizationId filtering to all database queries
4. **Integration Tests** — Verify cross-tenant isolation and feature enforcement

### Design Decisions

#### Decision 1: Use Edge-Native Handlers (NOT importing backend routes)

- **Why:** Backend routes depend on better-sqlite3 (native bindings incompatible with Workers)
- **Chosen approach:** Jose for JWT verification + @neondatabase/serverless for Neon queries
- **Benefit:** 254.8KB bundle size (10x smaller than Prisma import approach)

#### Decision 2: JWT Verification with Jose

- **Why:** Jose is lightweight, zero-dependency, Works-compatible
- **Alternative:** Clerk fallback (requires CLERK_SECRET_KEY, higher latency)
- **Pattern:** Verify JWT → extract organizationId → query subscription tier from Neon

#### Decision 3: Subscription Caching Strategy

- **Phase 8B (MVP):** Query Neon on each request (acceptable: Hyperdrive pooling keeps latency <30ms)
- **Phase 8B+:** Implement Durable Objects or KV cache for distributed caching (future optimization)
- **Why:** Simple, no coordination needed for MVP; good enough with Hyperdrive pooling

#### Decision 4: Parameterized Queries Only

- **Why:** Prevent SQL injection, especially critical with untrusted organizationId
- **Pattern:** Use @neondatabase/serverless sql template literals exclusively
- **Enforcement:** Code review gate: any raw SQL string concatenation = reject

---

## Current State

### ✅ Completed (Foundation)

- Phase 2: Storage abstraction layer with R2 provider
- Phase 3: Database abstraction with Prisma + Neon integration
- Phase 4: Services refactored with organizationId parameter
- Phase 5: Streaming CSV parser with batch upserts
- Phase 7: Neon PostgreSQL + Hyperdrive configured
- Phase 8: Workers infrastructure with health check
- Phase 8.1-8.13: Basic Workers handlers (login, register, getProducts, etc.)

### ⚠️ Incomplete (Blocking)

- **Auth context extraction** — JWT verified but organizationId NOT extracted/validated
- **Subscription tier validation** — No check for active status
- **Organization scope filtering** — Handlers don't filter queries by organizationId
- **Feature gate enforcement** — No tier-based access control
- **Usage limit checks** — No prevention of exceeding limits (e.g., SKU count)
- **Multi-tenant tests** — Missing cross-tenant isolation tests

---

## Scope & Tasks Breakdown

### Phase 1: Auth Context (Task 8B.1) — ~3 hours

**Goal:** Extract and validate organization context from JWT in Workers

**Tasks:**

- Create auth utilities module (`workers/src/utils/auth.ts`)
- Implement JWT verification using jose
- Extract organizationId from token payload
- Query SubscriptionTier from Neon via @neondatabase/serverless
- Validate organization status is 'active' (not 'canceled')
- Create auth middleware wrapper for Workers
- Write unit tests: JWT parsing, org validation, subscription lookup

**Output:** `AuthContext` object injected into request with userId, organizationId, tierLevel

### Phase 2: Feature Gates (Task 8B.2) — ~2 hours

**Goal:** Port feature gate and usage limit logic to Workers

**Tasks:**

- Create feature gate utility (`workers/src/utils/feature-gates.ts`)
- Port `requireFeature` logic from backend middleware
- Port `checkUsageLimit` logic from backend middleware
- Create middleware helper for composing gates
- Map TIER_LIMITS constant from backend/types/subscription.ts
- Write unit tests: feature enabled/disabled by tier, usage limits enforced

**Output:** Reusable middleware for protecting endpoints with feature/usage gates

### Phase 3: Handler Updates (Task 8B.3) — ~3 hours

**Goal:** Update all edge-native handlers to filter by organizationId

**Tasks:**

- Update `getProducts` handler: Add `WHERE organizationId = $1` to query
- Update `getInventory` handler: Add org scope filter
- Update `getStoreAreas` handler: Add org scope filter
- Update `getDashboard` handler: Add org scope to all aggregations
- Ensure all POST handlers validate organizationId quota/limit
- Convert all SQL to parameterized queries (@neondatabase/serverless style)
- Add unit tests: verify queries include organizationId filter

**Output:** All handlers safely scoped to organization

### Phase 4: Integration Tests (Task 8B.4) — ~2 hours

**Goal:** Verify multi-tenant security boundary and subscription enforcement

**Tests to Write:**

- **Cross-tenant isolation:** Org A cannot read Org B's products/inventory (2 tests)
- **Feature gate enforcement:** Starter tier blocked from Premium features (2 tests)
- **Usage limit enforcement:** Starter tier SKU limit = 500 (1 test)
- **Subscription validation:** Canceled org rejected with 403 (1 test)
- **Organization status check:** Inactive org denied access (1 test)
- **Token expiry:** Expired token rejected (1 test)

**Pattern:** Use Miniflare to simulate Workers environment, create test data in Neon

**Output:** 100% test coverage for multi-tenant security boundary

---

## Risks & Mitigations

| Risk                                 | Severity    | Root Cause            | Mitigation                                                                         |
| ------------------------------------ | ----------- | --------------------- | ---------------------------------------------------------------------------------- |
| Hyperdrived latency spikes           | 🟡 Medium   | Cold Neon connection  | Implement Durable Objects cache in Phase 8B+, monitor p95 latency                  |
| SQL injection via organizationId     | 🔴 Critical | Raw SQL concatenation | Code review gate: reject any non-parameterized SQL, use sql template literals only |
| Stale tier data (user on old plan)   | 🟡 Medium   | No tier caching       | Add X-Org-Tier-Version header like backend, clients validate on read               |
| Test environment cross-contamination | 🟡 Medium   | Shared test DB        | Use test org ID prefix, clean up in afterEach hook                                 |

---

## Success Criteria

✅ **Must Have (MVP):**

1. JWT organizationId extracted and validated in every request
2. Organization status checked (active orgs only, canceled rejected)
3. All database queries filtered by organizationId
4. Feature gates enforced (tier-based endpoint access)
5. Usage limits enforced (SKU count, user count, etc.)
6. Cross-tenant data isolation verified by tests
7. Subscription tier validation tests passing

✅ **Nice to Have (Post-MVP):**

- Distributed caching (Durable Objects/KV) for subscription tiers
- Per-tier rate limiting (Pro tier: 100 req/min, Starter: 10 req/min)
- Detailed usage analytics per organization
- Tier downgrade/upgrade enforcement (grace period before feature loss)

---

## Related Artifacts

**Existing Backend Code to Port:**

- `backend/src/middleware/auth.middleware.ts` — JWT verification, subscription validation
- `backend/src/middleware/feature-gate.middleware.ts` — Feature gates, usage limits
- `backend/src/types/subscription.ts` — TIER_LIMITS, FEATURE_FLAGS constants
- `backend/src/handlers/` — Query patterns using Prisma (adapt to @neondatabase/serverless)

**Specs Affected:**

- Will update `openspec/specs/workers.md` with auth flow and tier validation requirments
- May add new security delta spec for multi-tenant isolation (TBD in Phase 8B.1)

**Dependencies:**

- Phase 2 ✅ Storage abstraction
- Phase 7 ✅ Neon + Hyperdrive
- Phase 8 ⚠️ Workers infrastructure (in progress)
- Phase 8B 🔴 **THIS PHASE** (blocks Phase 15 production deployment)

---

## Next Steps

1. **User Review** — Validate proposal approach and timeline estimate
2. **Phase 8B.1 Implementation** — Start with auth context extraction
3. **Integrate Testing** — Multi-tenant tests as implementation progresses
4. **Production Readiness** — All 4 phases complete before Phase 15 deployment

---

## Glossary

- **organizationId** — Tenant identifier, extracted from JWT, used in all data queries
- **tier/tierLevel** — Subscription tier (starter, professional, premium, concierge)
- **Feature gate** — Boolean check: is feature enabled for this tier?
- **Usage limit** — Numeric limit (e.g., max 500 SKUs for Starter tier)
- **Hyperdrive** — Cloudflare's connection pooling service for edge-connected databases
- **@neondatabase/serverless** — Neon's serverless driver for Worker/Edge environments
