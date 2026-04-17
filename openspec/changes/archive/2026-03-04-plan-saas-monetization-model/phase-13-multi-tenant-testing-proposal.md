# Proposal: Phase 13 - Multi-Tenant Testing

## Analysis

**Current State**: Multi-tenant infrastructure is partially implemented (Phases 1-12 complete):

- ✅ Schema: `organizations`, `subscription_tiers`, `tier_feature_flags`, `organization_usage` tables exist
- ✅ Auth: JWT includes `organizationId` and `tierLevel` (Task 4.1-4.10)
- ✅ Feature Gates: `requireFeature()` and `checkUsageLimit()` middleware implemented (Task 5.1-5.8)
- ✅ Routes: Multi-tenant filtering applied to products, inventory, users, uploads (Task 6.1-6.13)
- ✅ Services: Organization-scoped methods with usage tracking (Task 7.1-7.8)
- ✅ Stripe: Subscription service, webhook handlers, trial system implemented (Tasks 8-12)

**Testing Gap**: Existing test coverage at `c:\Users\josha\date-management-app\backend\src\tests\integration\multi-tenant-route-filtering.test.ts` provides route-level validation but lacks:

- Cross-tenant data isolation verification (no actual database queries in existing tests)
- Feature gate enforcement with real tier limits
- Usage limit boundary testing (500 SKU limit, 1 user limit for Starter)
- Trial expiration workflow validation
- Subscription upgrade/downgrade state transitions
- Concurrent access race condition testing
- Penetration testing for parameter tampering
- Load testing for 100+ concurrent organizations

**Affected Files**:

- `backend/src/tests/integration/multi-tenant-route-filtering.test.ts` (460 lines) - Extend with database-backed tests
- `backend/src/tests/unit/feature-gate.middleware.test.ts` (existing) - Has tier-based feature tests
- `backend/src/tests/unit/atomicity.test.ts` (283 lines) - Has concurrent SKU counter tests
- `backend/src/tests/integration/upload-load.test.ts` (97 lines) - Load test pattern to reuse
- `backend/src/tests/services/subscription.service.test.ts` (682 lines) - Trial/subscription test patterns

**Pattern Analysis**:

- Existing `multi-tenant-route-filtering.test.ts` uses mock Prisma (no real DB queries)
- Load test pattern in `upload-load.test.ts`: 1000 concurrent requests with in-memory storage
- Atomicity tests use `$transaction` mock to verify rollback behavior
- Subscription tests mock Stripe API for trial creation/expiration

## Reuse Strategy

### 1. Extend Existing Multi-Tenant Test Suite

**File**: `backend/src/tests/integration/multi-tenant-route-filtering.test.ts`

- **Current**: 460 lines with mock Prisma, tests route structure only
- **Extend**: Add real database integration tests using test Prisma client
- **Pattern**: Follow `backend/src/tests/integration/subscription.integration.test.ts` which uses real DB

### 2. Reuse Load Test Infrastructure

**File**: `backend/src/tests/integration/upload-load.test.ts`

- **Pattern**: `Promise.all()` with 1000 concurrent requests
- **Adapt**: Create `multi-tenant-load.test.ts` for concurrent organization product creation
- **Opt-in**: Use `RUN_MULTI_TENANT_LOAD_TESTS=true` environment variable

### 3. Leverage Existing Atomicity Tests

**File**: `backend/src/tests/unit/atomicity.test.ts`

- **Pattern**: Mock `$transaction` to verify rollback on failure
- **Extend**: Add concurrent usage counter tests (multiple orgs creating products simultaneously)

### 4. Reuse Subscription Service Test Patterns

**File**: `backend/src/tests/services/subscription.service.test.ts`

- **Pattern**: Mock Stripe API for trial creation, expiration, upgrade/downgrade
- **Extend**: Add integration tests for trial-to-paid conversion workflow

### 5. Create New Penetration Test Suite

**New File**: `backend/src/tests/security/cross-tenant-penetration.test.ts`

- **Pattern**: Attempt parameter tampering (organizationId spoofing)
- **Validation**: Verify 403 Forbidden responses for cross-tenant access

## Implementation Steps

### Step 1: Database-Backed Cross-Tenant Isolation Tests (Tasks 13.1-13.3)

**File**: `backend/src/tests/integration/multi-tenant-cross-tenant-isolation.test.ts` (NEW)

- Create two organizations with real Prisma client (not mocked)
- Create products for each organization
- Verify user from Org A cannot read/update/delete products from Org B
- Verify login with organizationId correctly filters data

**Reuse**: Test database setup from `subscription.integration.test.ts`

### Step 2: Feature Gate Enforcement Tests (Tasks 13.4, 13.9-13.10)

**File**: `backend/src/tests/integration/multi-tenant-feature-gates.test.ts` (NEW)

- Test `requireFeature('advanced_analytics')` blocks Starter tier
- Test subscription upgrade immediately applies new limits (Starter → Professional)
- Test subscription downgrade warns if over-limit (Professional → Starter with 1500 SKUs)

**Reuse**: Feature gate middleware from `feature-gate.middleware.test.ts`

### Step 3: Usage Limit Boundary Tests (Tasks 13.5-13.7)

**File**: `backend/src/tests/integration/multi-tenant-usage-limits.test.ts` (NEW)

- Test Starter tier SKU limit (create 500 products, 501st fails with 403)
- Test Starter tier user limit (create 1 user, 2nd fails with 403)
- Test storage quota increment/decrement per organization

**Reuse**: Atomicity test patterns from `atomicity.test.ts`

### Step 4: Trial System Workflow Tests (Task 13.8)

**File**: `backend/src/tests/integration/multi-tenant-trial-workflow.test.ts` (NEW)

- Create trial organization with 14-day trial_end_date
- Mock time advance to day 15
- Trigger scheduler service trial expiration cron
- Verify organization downgraded to Starter tier
- Verify usage limits reset to Starter (500 SKUs, 1 user)

**Reuse**: Subscription service trial tests from `subscription.service.test.ts`

### Step 5: Penetration Tests (Task 13.11)

**File**: `backend/src/tests/security/cross-tenant-penetration.test.ts` (NEW)

- Attempt organizationId parameter tampering in API requests
- Attempt JWT token manipulation to access other organization's data
- Verify middleware validates organizationId from JWT, not request body
- Verify 403 Forbidden for all cross-tenant access attempts

**Pattern**: Security-focused test suite (new pattern)

### Step 6: Load Tests (Task 13.12)

**File**: `backend/src/tests/integration/multi-tenant-load.test.ts` (NEW)

- Create 100 organizations
- Spawn 100 concurrent requests (1 per org) to POST /products
- Verify each org's SKU counter incremented exactly once (no race conditions)
- Verify no cross-tenant data leaks under concurrent load

**Reuse**: Load test pattern from `upload-load.test.ts`

## Test Execution Strategy

### Unit Tests (Fast - Run Always)

- Feature gate middleware tests (existing)
- Atomicity tests (existing)
- Subscription service tests (existing)

### Integration Tests (Medium - Run on PR)

- Cross-tenant isolation tests (NEW)
- Feature gate enforcement tests (NEW)
- Usage limit boundary tests (NEW)
- Trial workflow tests (NEW)

### Security Tests (Medium - Run on PR)

- Penetration tests (NEW)

### Load Tests (Slow - Opt-in Only)

- Multi-tenant load tests (NEW)
- Opt-in via `RUN_MULTI_TENANT_LOAD_TESTS=true`

## Success Criteria

### Phase 13 Complete When:

1. ✅ All 12 tasks in `tasks.md` marked complete
2. ✅ Test coverage >80% for multi-tenant code paths
3. ✅ Zero cross-tenant data leaks detected in penetration tests
4. ✅ Load tests pass with 100 concurrent organizations
5. ✅ All tests pass: `npm run test:backend:diff` exit code 0
6. ✅ UBS scan clean: `ubs backend/src/tests/` exit code 0

### Validation Commands

```bash
# Run all multi-tenant tests
npm run test:backend -- --testPathPattern=multi-tenant

# Run security tests
npm run test:backend -- --testPathPattern=security

# Run load tests (opt-in)
RUN_MULTI_TENANT_LOAD_TESTS=true npm run test:backend -- --testPathPattern=load

# Full test suite
npm run test:backend:diff
```

## Risk Mitigation

### Risk 1: Test Database State Pollution

**Mitigation**: Use `beforeEach()` to create isolated test organizations with unique IDs
**Pattern**: `subscription.integration.test.ts` uses `beforeEach` cleanup

### Risk 2: Flaky Load Tests

**Mitigation**: Use deterministic test data, avoid time-based assertions
**Pattern**: `upload-load.test.ts` uses in-memory storage (no external dependencies)

### Risk 3: Missing Edge Cases

**Mitigation**: Review Phase 18.A-18.H prevention tasks for additional test scenarios
**Reference**: `tasks.md` lines 340-494 (Phase 18 gap analysis)

## Dependencies

### External Dependencies

- None (all tests use existing infrastructure)

### Internal Dependencies

- Prisma test client (existing)
- Mock Stripe SDK (existing)
- Scheduler service for trial expiration (Task 11.3 - completed)

### Blocking Issues

- None identified

## Estimated Effort

| Task Group                   | Tasks            | Estimated Hours |
| ---------------------------- | ---------------- | --------------- |
| Cross-tenant isolation tests | 13.1-13.3        | 4h              |
| Feature gate tests           | 13.4, 13.9-13.10 | 3h              |
| Usage limit tests            | 13.5-13.7        | 4h              |
| Trial workflow tests         | 13.8             | 3h              |
| Penetration tests            | 13.11            | 4h              |
| Load tests                   | 13.12            | 4h              |
| **Total**                    | **12 tasks**     | **22h**         |

## Memory Storage

After completion, store in project memory:

```bash
node scripts/mem-log.js PATTERN "Multi-Tenant Testing" "Comprehensive test suite for cross-tenant isolation, feature gates, usage limits, trial workflows, penetration testing, and load testing. Uses real Prisma client for integration tests, mock Stripe for subscription tests, and Promise.all() for concurrent load tests. All tests opt-in via RUN_MULTI_TENANT_LOAD_TESTS=true for slow tests."
```
