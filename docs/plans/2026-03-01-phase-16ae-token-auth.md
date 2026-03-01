# Phase 16A.E Token & Auth Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ensure absolute access correctness by strictly sourcing the user's `tierLevel` from the database/cache rather than trusting potentially stale JWT payloads, while optimizing authentication performance and ensuring immediate webhook synchronization.

**Architecture:**
Since the system has migrated to Clerk for auth, the original concept of a backend "token refresh endpoint" is handled by Clerk's automated token rotation. However, to guarantee that a Stripe downgrade immediately restricts access without waiting for a token to expire, we must refactor `auth.middleware.ts` to ALWAYS override the token's `tierLevel` with the fresh database value (using the existing 5-minute cache). We will also optimize performance by removing redundant DB queries in the Clerk validation fallback, fix legacy token generation bugs in `AuthService`, and introduce instant cache invalidation triggered by Stripe webhooks to eliminate the 5-minute staleness window.

**Tech Stack:** Express, Node.js, Jest, Prisma, Stripe

---

### Task 1: Fix Legacy Token Generation in AuthService

**Files:**
- Modify: `backend/src/services/auth.service.ts`
- Modify: `backend/src/tests/unit/auth.service.test.ts`

**Step 1: Update token payload requirements**
In `auth.service.ts`, update `TokenPayload` interface to make `tierLevel` optional (since it will be overridden by middleware):
```typescript
export interface TokenPayload {
  userId: number;
  role: string;
  organizationId: string;
  tierLevel?: TierLevel;
  iat?: number;
  exp?: number;
}
```

**Step 2: Fix `generateTokens` signature and implementation**
Update `generateTokens` to accept `organizationId` and include it in the JWT payload:
```typescript
  async generateTokens(userId: number, role: string, organizationId: string): Promise<TokenPair> {
    // ...
      const accessToken = jwt.sign({ userId, role, organizationId }, secret, {
        expiresIn: this.ACCESS_TOKEN_EXPIRY,
      });
```

**Step 3: Fix `refreshAccessToken` implementation**
Include `organizationId` when generating the new access token:
```typescript
      const accessToken = jwt.sign(
        { 
          userId: storedToken.userId, 
          role: storedToken.user.role,
          organizationId: storedToken.user.organizationId 
        },
        secret,
        { expiresIn: this.ACCESS_TOKEN_EXPIRY },
      );
```

**Step 4: Update Unit Tests**
Fix `backend/src/tests/unit/auth.service.test.ts` to pass a mock `organizationId` to `generateTokens` calls and mock the correct `organizationId` in `refreshAccessToken` tests.

**Step 5: Verify tests pass**
Run: `cd backend && npm test -- auth.service.test.ts`
Expected: PASS

**Step 6: Commit**
```bash
git add backend/src/services/auth.service.ts backend/src/tests/unit/auth.service.test.ts
git commit -m "fix: include organizationId in auth token generation and refresh"
```

---

### Task 2: Refactor Auth Middleware for Tier Override & Performance

**Files:**
- Modify: `backend/src/middleware/auth.middleware.ts`

**Step 1: Update required fields validation**
Change `hasRequiredTokenFields` to not require `tierLevel`:
```typescript
const hasRequiredTokenFields = (token: any): boolean => {
  return 'userId' in token && 'role' in token && 'organizationId' in token;
};
```

**Step 2: Optimize Clerk Token Resolution**
In `resolveFromClerkToken()`, remove the redundant `subscriptionTier` database query. The middleware already queries this immediately afterwards!
```typescript
      // Exclude soft-deleted users
      if (!user || user.organizationId === null) {
        return null;
      }

      // Return without tierLevel (middleware will populate it)
      return {
        userId: user.id,
        role: user.role,
        organizationId: user.organizationId,
        exp: clerkDecoded.exp,
      };
```

**Step 3: Enforce Database Source-of-Truth for Tier Level**
At the bottom of `authenticateToken`, override the `tierLevel` from the token with the fresh `subscription.tierLevel` from the DB/cache:
```typescript
  // Now that we've verified, we can safely access the properties
  req.userId = decodedToken.userId;
  req.userRole = decodedToken.role;
  req.organizationId = decodedToken.organizationId;
  req.tierLevel = subscription.tierLevel;
  req.user = {
    id: decodedToken.userId,
    role: decodedToken.role,
    organizationId: decodedToken.organizationId,
    tierLevel: subscription.tierLevel,
  };
```

**Step 4: Export Cache Invalidation Method**
At the top of `auth.middleware.ts`, export a function to allow clearing the cache:
```typescript
export const invalidateSubscriptionCache = (organizationId: string): void => {
  subscriptionCache.delete(organizationId);
};
```

**Step 5: Commit**
```bash
git add backend/src/middleware/auth.middleware.ts
git commit -m "refactor: enforce DB source-of-truth for tier level in auth middleware"
```

---

### Task 3: Implement Instant Webhook Cache Invalidation

**Files:**
- Modify: `backend/src/services/webhook.service.ts`

**Step 1: Import Invalidation Function**
At the top of `webhook.service.ts`:
```typescript
import { invalidateSubscriptionCache } from '../middleware/auth.middleware';
```

**Step 2: Clear cache on subscription events**
Call `invalidateSubscriptionCache(organizationId)` immediately after the `$transaction` completes in the following handlers to ensure 0-second staleness for tier changes:
- `handleSubscriptionCreated`
- `handleSubscriptionUpdated`
- `handleSubscriptionDeleted`
- `handleCheckoutSessionCompleted`

**Step 3: Commit**
```bash
git add backend/src/services/webhook.service.ts
git commit -m "feat: instantly invalidate auth tier cache on stripe webhook events"
```

---

### Task 4: Write Integration Test for Tier Refresh Correctness

**Files:**
- Create: `backend/src/tests/integration/auth-tier-override.test.ts`

**Step 1: Create the Test File**
Create a test that uses real auth middleware, issues a legacy JWT with a stale `premium` tier, and verifies that the middleware correctly enforces the `starter` tier from the database.
- Use `process.env.TEST_AUTH_BYPASS = 'false'`
- Test 1: Generate token with `tierLevel: 'premium'`, but DB has `starter`. Access restricted endpoint (e.g., `GET /api/reports/analytics` which requires `advanced_analytics`). Ensure it is blocked (403), proving DB override worked.
- Test 2: Modify DB tier from `starter` to `premium`. Call `invalidateSubscriptionCache(orgId)`. Access restricted endpoint again. Ensure it is allowed (200).

**Step 2: Run test to verify it passes**
Run: `cd backend && npm test -- auth-tier-override.test.ts`
Expected: PASS

**Step 3: Commit**
```bash
git add backend/src/tests/integration/auth-tier-override.test.ts
git commit -m "test: verify auth middleware overrides stale token tier levels"
```

---

### Task 5: Update Progress in Tasks Document

**Files:**
- Modify: `openspec/changes/plan-saas-monetization-model/tasks.md`

**Step 1: Mark tasks as completed**
- Check off `16A.E.1`, `16A.E.2`, `16A.E.3`, `16A.E.4`.
- Add context notes under 16A.E.1 and 16A.E.2 explaining that the middleware override and Clerk integration eliminates the need for a dedicated backend `/refresh` endpoint, as the DB `tierLevel` is injected automatically on every request. Note that 16A.E.3 was already completed in a prior phase via `validateWebhookMetadata`.

**Step 2: Commit**
```bash
git add openspec/changes/plan-saas-monetization-model/tasks.md
git commit -m "docs: mark Phase 16A.E Token & Auth as completed"
```
