# Phase 16A.B: Webhook & State Sync — Implementation Plan

> **For LLMs:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete all remaining gaps in Phase 16A.B (Webhook & State Sync) to harden revenue-critical Stripe webhook processing, implement the creation-lock soft-lock mechanism, add an hourly Stripe reconciliation job, and close monitoring gaps.

**Architecture:** The webhook pipeline is already wired: `POST /api/webhooks/stripe` → `WebhookService.verifySignature` → idempotency check → `handleEvent` → `markEventProcessed`. The remaining work falls into four areas: (1) a missing schema field for creation-locking, (2) the hourly Stripe reconciliation cron job, and (3) Sentry monitoring enhancements for raw error counts and replay attack detection.

**Tech Stack:** Node.js 20, Express, TypeScript, Prisma (SQLite), `node-cron`, Stripe Node SDK, `@sentry/node`, Jest, `@sendgrid/mail`.

---

## Pre-Implementation: Current State Audit

After exhaustive code review, here is the honest status of each task:

| Task                                     | Status      | Evidence                                                                                                                           |
| ---------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 16A.B.1 CREATE TABLE                     | ✅ DONE     | `ProcessedWebhookEvent` model in `schema.prisma:100-107`; migration `20260215052314_add_processed_webhook_events`                  |
| 16A.B.2 IDEMPOTENCY                      | ✅ DONE     | `isNewEvent()` at line 100, `markEventProcessed()` at line 113 in `webhook.service.ts`; P2002 handled                              |
| 16A.B.3.1 handleSubscriptionCreated      | ✅ DONE     | Lines 288-366 `webhook.service.ts`; metadata validation, transaction, audit log                                                    |
| 16A.B.3.2 handleSubscriptionUpdated      | ⚠️ PARTIAL  | Lines 374-479; handler works but **soft lock NOT set** — comment at line 439: "readOnlyMode field doesn't exist in current schema" |
| 16A.B.3.3 handleSubscriptionDeleted      | ⚠️ PARTIAL  | Lines 487-568; handler works but **soft lock NOT set**                                                                             |
| 16A.B.3.4 handleCheckoutSessionCompleted | ✅ DONE     | Lines 576-626                                                                                                                      |
| 16A.B.3.5 handleInvoicePaymentFailed     | ✅ DONE     | Lines 634-686; dunning email queued                                                                                                |
| 16A.B.3.6 handleTrialWillEnd             | ✅ DONE     | Lines 694-730; trial reminder email sent                                                                                           |
| 16A.B.4 CRON JOB (Stripe sync)           | ❌ NOT DONE | `HourlyWebhookCheckJob` only checks failure rates; NO job fetches Stripe subscriptions list                                        |
| 16A.B.5 TRANSACTION                      | ✅ DONE     | Every handler uses `this.prisma.$transaction()`                                                                                    |
| 16A.B.6 VALIDATION (org exists)          | ✅ DONE     | `validateWebhookMetadata()` lines 211-262 checks org in every handler                                                              |
| 16A.B.7 MONITORING                       | ⚠️ PARTIAL  | Error reporting exists; missing: raw count >1/day alert + replay attack detection                                                  |

**Net remaining work: Tasks 16A.B.3.2/3.3 (soft lock), 16A.B.4 (Stripe sync), 16A.B.7 (monitoring gaps).**

---

## Task 1: Schema Migration — Add `isCreationLocked` to Organization

Implements the "creation_locked" state from Decision 8A.8 that 16A.B.3.2 and 16A.B.3.3 require.

**Files:**

- Modify: `backend/prisma/schema.prisma`
- Create migration via: `npx prisma migrate dev --name add_creation_locked_to_org`
- Test: `backend/src/tests/integration/webhook.integration.test.ts`

### Step 1: Write the failing migration test

Add to `backend/src/tests/integration/webhook.integration.test.ts` inside the existing `describe('SubscriptionTier Operations'` block:

```typescript
it('should support isCreationLocked field on organization', async () => {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: testOrganizationId },
  });
  expect(org).toHaveProperty('isCreationLocked');
  expect(org.isCreationLocked).toBe(false);
});

it('should allow setting isCreationLocked to true', async () => {
  await prisma.organization.update({
    where: { id: testOrganizationId },
    data: { isCreationLocked: true },
  });
  const updated = await prisma.organization.findUniqueOrThrow({
    where: { id: testOrganizationId },
  });
  expect(updated.isCreationLocked).toBe(true);
});
```

### Step 2: Run test to confirm it fails

```bash
cd backend && npx jest webhook.integration.test.ts --testNamePattern="isCreationLocked" --no-coverage
```

Expected: FAIL — `Property 'isCreationLocked' not found on type`

### Step 3: Add field to Prisma schema

In `backend/prisma/schema.prisma`, inside the `model Organization` block, add after the `updatedAt` field:

```prisma
isCreationLocked Boolean @default(false) @map("is_creation_locked")
```

So the `Organization` model becomes:

```prisma
model Organization {
  id                      String                   @id @default(uuid())
  clerkOrganizationId     String?                  @unique @map("clerk_organization_id")
  name                    String
  slug                    String                   @unique
  contactEmail            String?                  @map("contact_email")
  createdAt               DateTime                 @default(now()) @map("created_at")
  updatedAt               DateTime                 @updatedAt @map("updated_at")
  isCreationLocked        Boolean                  @default(false) @map("is_creation_locked")
  // ... relations unchanged
```

### Step 4: Run migration

```bash
cd backend && npx prisma migrate dev --name add_creation_locked_to_org
```

Expected: Creates `backend/prisma/migrations/<timestamp>_add_creation_locked_to_org/migration.sql`

### Step 5: Run test to confirm it passes

```bash
cd backend && npx jest webhook.integration.test.ts --testNamePattern="isCreationLocked" --no-coverage
```

Expected: PASS

### Step 6: TypeScript check

```bash
cd backend && npx tsc --noEmit
```

Expected: 0 errors

### Step 7: Commit

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/
git commit -m "feat(schema): add isCreationLocked field to Organization for soft lock"
```

---

## Task 2: Implement Soft Lock in `handleSubscriptionUpdated` and `handleSubscriptionDeleted`

Closes the gap in 16A.B.3.2 and 16A.B.3.3.

**Files:**

- Modify: `backend/src/services/webhook.service.ts`
- Modify: `backend/src/tests/unit/webhook.service.test.ts`

### Step 1: Write failing tests

In `backend/src/tests/unit/webhook.service.test.ts`, add inside `describe('handler behaviors')`:

```typescript
it('sets isCreationLocked=true on org when downgrading over SKU limit', async () => {
  prisma.subscriptionTier.findFirst.mockResolvedValue({ tierLevel: 'professional' });
  prisma.organizationUsage.findUnique.mockResolvedValue({ totalSkus: 9999 });
  prisma.organization.update = jest
    .fn()
    .mockResolvedValue({ id: organizationId, isCreationLocked: true });

  const subscription = {
    id: 'sub_updated',
    customer: customerId,
    status: 'active',
    items: {
      data: [{ price: { metadata: { tier: 'starter' } } }],
    },
    trial_end: null,
  } as unknown as Stripe.Subscription;

  await (service as any).handleSubscriptionUpdated(subscription);

  expect(prisma.organization.update).toHaveBeenCalledWith({
    where: { id: organizationId },
    data: { isCreationLocked: true },
  });
});

it('sets isCreationLocked=true on org when subscription deleted and over Starter limit', async () => {
  prisma.organizationUsage.findUnique.mockResolvedValue({ totalSkus: 9999 });
  prisma.organization.update = jest
    .fn()
    .mockResolvedValue({ id: organizationId, isCreationLocked: true });

  const subscription = {
    id: 'sub_deleted',
    customer: customerId,
  } as unknown as Stripe.Subscription;

  await (service as any).handleSubscriptionDeleted(subscription);

  expect(prisma.organization.update).toHaveBeenCalledWith({
    where: { id: organizationId },
    data: { isCreationLocked: true },
  });
});

it('does NOT lock org when downgrade is within new SKU limit', async () => {
  prisma.subscriptionTier.findFirst.mockResolvedValue({ tierLevel: 'professional' });
  prisma.organizationUsage.findUnique.mockResolvedValue({ totalSkus: 100 }); // Under starter limit of 500
  prisma.organization.update = jest.fn().mockResolvedValue({ id: organizationId });

  const subscription = {
    id: 'sub_within_limit',
    customer: customerId,
    status: 'active',
    items: {
      data: [{ price: { metadata: { tier: 'starter' } } }],
    },
    trial_end: null,
  } as unknown as Stripe.Subscription;

  await (service as any).handleSubscriptionUpdated(subscription);

  // organization.update should NOT be called for creation lock
  // (may be called for other reasons but NOT with isCreationLocked)
  const lockCalls = (prisma.organization.update as jest.Mock).mock.calls.filter(
    (c) => c[0].data?.isCreationLocked !== undefined,
  );
  expect(lockCalls).toHaveLength(0);
});
```

### Step 2: Run tests to confirm they fail

```bash
cd backend && npx jest webhook.service.test.ts --testNamePattern="isCreationLocked|locked" --no-coverage
```

Expected: FAIL — `prisma.organization.update is not a function` / assertion failures

### Step 3: Add `organization.update` to mock prisma in test beforeEach

In the `beforeEach` block of `webhook.service.test.ts`, add to the `prisma` mock object:

```typescript
organization: {
  findUnique: jest.fn(),
  update: jest.fn(),
},
```

### Step 4: Implement soft lock in `handleSubscriptionUpdated`

In `backend/src/services/webhook.service.ts`, inside `handleSubscriptionUpdated`, replace the comment block at lines 438-449:

```typescript
// Note: readOnlyMode field doesn't exist in current schema
// This is a placeholder for future implementation
// For now, just send the warning email

// Queue warning email
await this.emailService.sendDowngradeWarningEmail(organizationId, usage.totalSkus, limits.max_skus);
```

With:

```typescript
// Apply creation lock — blocks new product creation until usage drops
await tx.organization.update({
  where: { id: organizationId },
  data: { isCreationLocked: true },
});

log.warn('Creation lock applied on tier downgrade', {
  organizationId,
  currentUsage: usage.totalSkus,
  newLimit: limits.max_skus,
});

// Queue warning email (outside transaction — non-blocking)
await this.emailService.sendDowngradeWarningEmail(organizationId, usage.totalSkus, limits.max_skus);
```

### Step 5: Implement soft lock in `handleSubscriptionDeleted`

In `backend/src/services/webhook.service.ts`, inside `handleSubscriptionDeleted`, add after the `organizationUsage.update` call inside the transaction (after line ~518) but before the audit log:

```typescript
// Apply creation lock if usage exceeds Starter limits
const usage = await tx.organizationUsage.findUnique({
  where: { organizationId },
});

if (usage && usage.totalSkus > (starterLimits.max_skus || 500)) {
  await tx.organization.update({
    where: { id: organizationId },
    data: { isCreationLocked: true },
  });

  log.warn('Creation lock applied on subscription cancellation', {
    organizationId,
    currentUsage: usage.totalSkus,
    starterLimit: starterLimits.max_skus,
  });

  await this.emailService.sendDowngradeWarningEmail(
    organizationId,
    usage.totalSkus,
    starterLimits.max_skus || 500,
  );
}
```

> **IMPORTANT**: Remove or replace the existing standalone `organizationUsage.findUnique` + `sendDowngradeWarningEmail` block (lines 522-539) since the new code above replaces it entirely.

### Step 6: Unlock org when subscription is created/upgraded above the limit

In `handleSubscriptionCreated`, after the `organizationUsage.upsert` inside the transaction, add:

```typescript
// Clear creation lock if org was previously locked (new subscription covers usage)
await tx.organization.update({
  where: { id: organizationId },
  data: { isCreationLocked: false },
});
```

In `handleSubscriptionUpdated`, inside the transaction after `organizationUsage.update`, add the following — only when it is NOT a downgrade-over-limit case:

```typescript
// If not locking, ensure creation lock is cleared (e.g. upgrading back)
if (!(isDowngrade && limits.max_skus !== null && usage && usage.totalSkus > limits.max_skus)) {
  await tx.organization.update({
    where: { id: organizationId },
    data: { isCreationLocked: false },
  });
}
```

### Step 7: Run tests to confirm they pass

```bash
cd backend && npx jest webhook.service.test.ts --no-coverage
```

Expected: All tests PASS

### Step 8: TypeScript check

```bash
cd backend && npx tsc --noEmit
```

Expected: 0 errors

### Step 9: Commit

```bash
git add backend/src/services/webhook.service.ts backend/src/tests/unit/webhook.service.test.ts
git commit -m "feat(webhook): apply isCreationLocked on tier downgrade/cancellation when over limit"
```

---

## Task 3: Enforce Creation Lock in Feature-Gate Middleware

The soft lock is useless unless `checkUsageLimit` and/or the product creation route respects it.

**Files:**

- Modify: `backend/src/middleware/feature-gate.middleware.ts`
- Modify: `backend/src/tests/unit/feature-gate.test.ts` (or integration test)

### Step 1: Write failing test

Find or create `backend/src/tests/unit/feature-gate.test.ts` and add:

```typescript
it('returns 403 with creation_locked message when org isCreationLocked=true', async () => {
  const mockPrisma = {
    organizationUsage: {
      findUnique: jest.fn().mockResolvedValue({
        organizationId: 'org-123',
        activeUsers: 0,
        maxUsers: 1,
        totalSkus: 600, // Over limit
        maxSkus: 500,
        storageUsedBytes: 0,
      }),
    },
    organization: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'org-123',
        isCreationLocked: true,
      }),
    },
  };

  jest.mock('../../database/database-factory', () => ({
    getDefaultDatabaseClient: () => mockPrisma,
  }));

  const req = {
    organizationId: 'org-123',
    tierLevel: 'starter',
    userId: 1,
    ip: '127.0.0.1',
    get: jest.fn(),
    headers: {},
    path: '/products',
    method: 'POST',
  } as any;

  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
    locals: {},
  } as any;

  const next = jest.fn();

  await checkUsageLimit('max_skus')(req, res, next);

  expect(res.status).toHaveBeenCalledWith(403);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ locked: true }));
  expect(next).not.toHaveBeenCalled();
});
```

### Step 2: Run test to confirm it fails

```bash
cd backend && npx jest feature-gate --no-coverage
```

Expected: FAIL

### Step 3: Implement creation lock check in `checkUsageLimit`

In `backend/src/middleware/feature-gate.middleware.ts`, inside the `checkUsageLimit` middleware function, add immediately after obtaining `organizationUsage`:

```typescript
// Check creation lock — applied by webhook handler on over-limit downgrade
const prisma = getDefaultDatabaseClient();
const org = await prisma.organization.findUnique({
  where: { id: req.organizationId },
  select: { isCreationLocked: true },
});

if (org?.isCreationLocked) {
  Logger.warn('Creation locked: org over limit, blocking write operation', {
    organizationId: req.organizationId,
    limitKey,
    path: req.path,
  });

  return res.status(403).json({
    message: `Your account is creation-locked because your current usage exceeds your subscription tier limits. Remove items or upgrade to re-enable creation.`,
    locked: true,
    limitKey,
    upgradeCTA: 'Upgrade your plan to unlock creation',
    upgradeUrl: '/subscription/upgrade',
  });
}
```

> **Note**: Only apply this check on write operations (POST/PUT methods). Add a guard:

```typescript
if (org?.isCreationLocked && ['POST', 'PUT', 'PATCH'].includes(req.method)) {
```

### Step 4: Run tests

```bash
cd backend && npx jest feature-gate --no-coverage
```

Expected: PASS

### Step 5: Full unit test suite

```bash
cd backend && npm test -- --forceExit --no-coverage
```

Expected: All existing 678+ tests pass (0 new failures)

### Step 6: Commit

```bash
git add backend/src/middleware/feature-gate.middleware.ts
git commit -m "feat(middleware): enforce isCreationLocked in checkUsageLimit — blocks writes when over-limit"
```

---

## Task 4: Hourly Stripe Subscription Sync Cron Job (16A.B.4)

Creates a new job that reconciles local `subscription_tiers` against Stripe's API state hourly.

**Files:**

- Create: `backend/src/jobs/stripe-sync.job.ts`
- Modify: `backend/src/services/scheduler.service.ts`
- Create: `backend/src/tests/unit/stripe-sync.job.test.ts`

### Step 1: Write failing test

Create `backend/src/tests/unit/stripe-sync.job.test.ts`:

```typescript
import { runStripeSyncJob } from '../../jobs/stripe-sync.job';
import { PrismaClient } from '@prisma/client';
import Stripe from 'stripe';

jest.mock('@prisma/client');
jest.mock('stripe');
jest.mock('../../database/database-factory');
jest.mock('../../config/environment', () => ({
  envConfig: { STRIPE_SECRET_KEY: 'sk_test_123' },
}));

describe('StripeSyncJob', () => {
  let mockPrisma: any;
  let mockStripe: any;

  beforeEach(() => {
    mockPrisma = {
      subscriptionTier: {
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
      $disconnect: jest.fn(),
    };

    mockStripe = {
      subscriptions: {
        list: jest.fn(),
      },
    };

    jest.clearAllMocks();
  });

  it('syncs a diverged subscription tier from Stripe', async () => {
    // Local DB says 'starter', Stripe says 'professional'
    mockPrisma.subscriptionTier.findMany.mockResolvedValue([
      {
        id: 1,
        organizationId: 'org-123',
        stripeSubscriptionId: 'sub_abc',
        tierLevel: 'starter',
        status: 'active',
      },
    ]);

    mockStripe.subscriptions.list.mockResolvedValue({
      data: [
        {
          id: 'sub_abc',
          status: 'active',
          items: {
            data: [{ price: { metadata: { tier: 'professional' } } }],
          },
        },
      ],
      has_more: false,
    });

    await runStripeSyncJob(mockPrisma, mockStripe);

    expect(mockPrisma.subscriptionTier.updateMany).toHaveBeenCalledWith({
      where: { stripeSubscriptionId: 'sub_abc' },
      data: expect.objectContaining({ tierLevel: 'professional' }),
    });
  });

  it('does NOT update when local state matches Stripe', async () => {
    mockPrisma.subscriptionTier.findMany.mockResolvedValue([
      {
        id: 1,
        organizationId: 'org-123',
        stripeSubscriptionId: 'sub_abc',
        tierLevel: 'professional',
        status: 'active',
      },
    ]);

    mockStripe.subscriptions.list.mockResolvedValue({
      data: [
        {
          id: 'sub_abc',
          status: 'active',
          items: {
            data: [{ price: { metadata: { tier: 'professional' } } }],
          },
        },
      ],
      has_more: false,
    });

    await runStripeSyncJob(mockPrisma, mockStripe);

    expect(mockPrisma.subscriptionTier.updateMany).not.toHaveBeenCalled();
  });

  it('handles subscriptions missing from Stripe (log warning, do not delete)', async () => {
    mockPrisma.subscriptionTier.findMany.mockResolvedValue([
      {
        id: 1,
        organizationId: 'org-123',
        stripeSubscriptionId: 'sub_missing',
        tierLevel: 'professional',
        status: 'active',
      },
    ]);

    // Stripe returns no subscriptions
    mockStripe.subscriptions.list.mockResolvedValue({
      data: [],
      has_more: false,
    });

    // Should not throw
    await expect(runStripeSyncJob(mockPrisma, mockStripe)).resolves.not.toThrow();
    // Should NOT delete or change status
    expect(mockPrisma.subscriptionTier.updateMany).not.toHaveBeenCalled();
  });

  it('handles Stripe API error gracefully without crashing', async () => {
    mockPrisma.subscriptionTier.findMany.mockResolvedValue([]);
    mockStripe.subscriptions.list.mockRejectedValue(new Error('Stripe API down'));

    await expect(runStripeSyncJob(mockPrisma, mockStripe)).resolves.not.toThrow();
  });

  it('handles paginated Stripe response with has_more=true', async () => {
    mockPrisma.subscriptionTier.findMany.mockResolvedValue([]);

    // First page returns has_more=true, second page has_more=false
    mockStripe.subscriptions.list
      .mockResolvedValueOnce({
        data: [
          {
            id: 'sub_page1',
            status: 'active',
            items: { data: [{ price: { metadata: { tier: 'starter' } } }] },
          },
        ],
        has_more: true,
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: 'sub_page2',
            status: 'active',
            items: { data: [{ price: { metadata: { tier: 'starter' } } }] },
          },
        ],
        has_more: false,
      });

    await runStripeSyncJob(mockPrisma, mockStripe);

    // Should have called list twice (pagination)
    expect(mockStripe.subscriptions.list).toHaveBeenCalledTimes(2);
  });
});
```

### Step 2: Run tests to confirm they fail

```bash
cd backend && npx jest stripe-sync.job.test.ts --no-coverage
```

Expected: FAIL — module not found

### Step 3: Create `backend/src/jobs/stripe-sync.job.ts`

```typescript
/**
 * Stripe Subscription Sync Job
 *
 * Runs hourly to reconcile local subscription_tiers table against Stripe's API.
 * Detects divergences (e.g. tier mismatch, status mismatch) and updates local state.
 * Logs warnings for any divergences found.
 *
 * Schedule: Every hour at minute 0 (0 * * * *)
 *
 * 16A.B.4: Implements required hourly Stripe state sync.
 */

import cron, { ScheduledTask } from 'node-cron';
import Stripe from 'stripe';
import { PrismaClient } from '@prisma/client';
import { getDefaultDatabaseClient } from '../database/database-factory';
import { envConfig } from '../config/environment';
import { Logger } from '../utils/logger';
import * as Sentry from '@sentry/node';

let cronJob: ScheduledTask | null = null;

// Tier extraction — mirrors webhook.service.ts logic
function extractTierFromStripeSubscription(subscription: Stripe.Subscription): string {
  const price = subscription.items.data[0]?.price;
  if (!price) return 'starter';
  const tier = price.metadata?.tier;
  const validTiers = ['starter', 'professional', 'premium', 'concierge'];
  return validTiers.includes(tier) ? tier : 'starter';
}

// Normalize Stripe status to local status string
function normalizeStatus(stripeStatus: Stripe.Subscription.Status): string {
  switch (stripeStatus) {
    case 'active':
      return 'active';
    case 'canceled':
      return 'canceled';
    case 'past_due':
      return 'past_due';
    case 'trialing':
      return 'trialing';
    default:
      return 'active';
  }
}

/**
 * Core sync logic — exported for testability with injected dependencies.
 */
export async function runStripeSyncJob(prisma: PrismaClient, stripeClient: Stripe): Promise<void> {
  Logger.info('Starting hourly Stripe subscription sync job');

  try {
    // Step 1: Fetch all local subscriptions that have a Stripe subscription ID
    const localSubscriptions = await prisma.subscriptionTier.findMany({
      where: {
        stripeSubscriptionId: { not: null },
      },
      select: {
        id: true,
        organizationId: true,
        stripeSubscriptionId: true,
        tierLevel: true,
        status: true,
      },
    });

    if (localSubscriptions.length === 0) {
      Logger.info('No local Stripe-linked subscriptions found, skipping sync');
      return;
    }

    // Step 2: Fetch all active subscriptions from Stripe (paginated)
    const stripeSubscriptionMap = new Map<string, Stripe.Subscription>();

    let startingAfter: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const page = await stripeClient.subscriptions.list({
        status: 'all',
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });

      for (const sub of page.data) {
        stripeSubscriptionMap.set(sub.id, sub);
      }

      hasMore = page.has_more;
      if (hasMore && page.data.length > 0) {
        startingAfter = page.data[page.data.length - 1].id;
      }
    }

    Logger.info(`Fetched ${stripeSubscriptionMap.size} subscriptions from Stripe`);

    // Step 3: Compare and sync
    let syncCount = 0;
    let divergenceCount = 0;

    for (const local of localSubscriptions) {
      const stripeId = local.stripeSubscriptionId!;
      const stripeSub = stripeSubscriptionMap.get(stripeId);

      if (!stripeSub) {
        // Subscription not found in Stripe — log warning, do NOT auto-delete
        Logger.warn('Local subscription not found in Stripe during sync', {
          organizationId: local.organizationId,
          stripeSubscriptionId: stripeId,
          localStatus: local.status,
        });
        divergenceCount++;
        continue;
      }

      const stripeTier = extractTierFromStripeSubscription(stripeSub);
      const stripeStatus = normalizeStatus(stripeSub.status);
      const stripeTrialEnd = stripeSub.trial_end ? new Date(stripeSub.trial_end * 1000) : null;

      const tierMismatch = local.tierLevel !== stripeTier;
      const statusMismatch = local.status !== stripeStatus;

      if (tierMismatch || statusMismatch) {
        Logger.warn('Subscription divergence detected — syncing from Stripe', {
          organizationId: local.organizationId,
          stripeSubscriptionId: stripeId,
          localTier: local.tierLevel,
          stripeTier,
          localStatus: local.status,
          stripeStatus,
        });

        await prisma.subscriptionTier.updateMany({
          where: { stripeSubscriptionId: stripeId },
          data: {
            tierLevel: stripeTier,
            status: stripeStatus,
            trialEndDate: stripeTrialEnd,
          },
        });

        divergenceCount++;
        syncCount++;
      }
    }

    Logger.info('Hourly Stripe sync completed', {
      checkedCount: localSubscriptions.length,
      divergenceCount,
      syncCount,
    });

    if (divergenceCount > 0) {
      Logger.warn(`Stripe sync: ${divergenceCount} divergences found, ${syncCount} corrected`);
    }
  } catch (error) {
    Logger.error('Stripe sync job failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    Sentry.captureException(error, {
      level: 'error',
      tags: { job: 'stripe_sync', component: 'scheduler' },
    });

    // Do NOT rethrow — cron job should not stop on single failure
  }
}

/**
 * Start the hourly Stripe sync cron job
 */
export function startStripeSyncJob(): void {
  if (cronJob) {
    Logger.warn('Stripe sync job already running');
    return;
  }

  if (!envConfig.STRIPE_SECRET_KEY) {
    Logger.warn('STRIPE_SECRET_KEY not set — Stripe sync job will not start');
    return;
  }

  const prisma = getDefaultDatabaseClient();
  const stripeClient = new Stripe(envConfig.STRIPE_SECRET_KEY, {
    apiVersion: '2023-08-16',
  });

  // Schedule: Every hour at minute 0
  cronJob = cron.schedule('0 * * * *', async () => {
    await runStripeSyncJob(prisma, stripeClient);
  });

  Logger.info('Stripe subscription sync job started (hourly at :00)');
}

export function stopStripeSyncJob(): void {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    Logger.info('Stripe sync job stopped');
  }
}
```

### Step 4: Register in SchedulerService

In `backend/src/services/scheduler.service.ts`, add import at top:

```typescript
import { startStripeSyncJob } from '../jobs/stripe-sync.job';
```

In the `static initialize()` method, add after the trial expiration cron:

```typescript
// Schedule hourly Stripe subscription sync (16A.B.4)
// Fetches all Stripe subscriptions and reconciles against local subscription_tiers
cron.schedule('0 * * * *', () => {
  console.log('Running hourly Stripe subscription sync...');
  // Delegate to job module for testability
});

startStripeSyncJob();
```

### Step 5: Run the new tests

```bash
cd backend && npx jest stripe-sync.job.test.ts --no-coverage
```

Expected: All 5 tests PASS

### Step 6: TypeScript check

```bash
cd backend && npx tsc --noEmit
```

Expected: 0 errors

### Step 7: Full test suite

```bash
cd backend && npm test -- --forceExit --no-coverage
```

Expected: All existing tests pass + 5 new tests pass

### Step 8: Commit

```bash
git add backend/src/jobs/stripe-sync.job.ts backend/src/services/scheduler.service.ts backend/src/tests/unit/stripe-sync.job.test.ts
git commit -m "feat(jobs): add hourly Stripe subscription sync job (16A.B.4)"
```

---

## Task 5: Webhook Monitoring Enhancements (16A.B.7)

Closes the two remaining monitoring gaps:

1. Raw error count alert (`webhook_handler_error > 1/day`)
2. Replay attack detection via `processed_webhook_events` growth rate

**Files:**

- Modify: `backend/src/jobs/daily-metrics.job.ts`
- Modify: `backend/src/services/saas-metrics.service.ts`
- Create: `backend/src/tests/unit/webhook-monitoring.test.ts`

### Step 1: Write failing tests

Create `backend/src/tests/unit/webhook-monitoring.test.ts`:

```typescript
import { HourlyWebhookCheckJob } from '../../jobs/daily-metrics.job';
import { SaasMetricsService } from '../../services/saas-metrics.service';

jest.mock('../../services/saas-metrics.service');
jest.mock('../../database/database-factory');

describe('Webhook Monitoring', () => {
  let job: HourlyWebhookCheckJob;
  let mockSaasMetrics: jest.Mocked<SaasMetricsService>;

  beforeEach(() => {
    mockSaasMetrics = {
      calculateWebhookFailureRate: jest.fn().mockResolvedValue(0),
      getDailyWebhookErrorCount: jest.fn().mockResolvedValue(0),
      getProcessedWebhookEventGrowthRate: jest.fn().mockResolvedValue(1.0),
    } as any;

    (SaasMetricsService as jest.Mock).mockImplementation(() => mockSaasMetrics);
    job = new HourlyWebhookCheckJob();
  });

  it('captures Sentry alert when daily webhook error count exceeds 1', async () => {
    mockSaasMetrics.getDailyWebhookErrorCount.mockResolvedValue(2);

    const Sentry = require('@sentry/node');
    jest.spyOn(Sentry, 'captureMessage').mockImplementation(() => 'id');

    await job.execute();

    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('webhook handler errors today'),
      expect.objectContaining({ level: 'error' }),
    );
  });

  it('does NOT alert when daily webhook error count is 0', async () => {
    mockSaasMetrics.getDailyWebhookErrorCount.mockResolvedValue(0);

    const Sentry = require('@sentry/node');
    jest.spyOn(Sentry, 'captureMessage').mockImplementation(() => 'id');

    await job.execute();

    const rawCountAlerts = (Sentry.captureMessage as jest.Mock).mock.calls.filter(([msg]) =>
      msg.includes('webhook handler errors today'),
    );
    expect(rawCountAlerts).toHaveLength(0);
  });

  it('captures Sentry alert when replay attack growth rate exceeds threshold', async () => {
    mockSaasMetrics.getProcessedWebhookEventGrowthRate.mockResolvedValue(15.0); // 15x baseline

    const Sentry = require('@sentry/node');
    jest.spyOn(Sentry, 'captureMessage').mockImplementation(() => 'id');

    await job.execute();

    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('replay attack'),
      expect.objectContaining({ level: 'error' }),
    );
  });

  it('does NOT alert when growth rate is normal (<=5x)', async () => {
    mockSaasMetrics.getProcessedWebhookEventGrowthRate.mockResolvedValue(2.0);

    const Sentry = require('@sentry/node');
    jest.spyOn(Sentry, 'captureMessage').mockImplementation(() => 'id');

    await job.execute();

    const replayAlerts = (Sentry.captureMessage as jest.Mock).mock.calls.filter(([msg]) =>
      msg.includes('replay attack'),
    );
    expect(replayAlerts).toHaveLength(0);
  });
});
```

### Step 2: Run tests to confirm they fail

```bash
cd backend && npx jest webhook-monitoring.test.ts --no-coverage
```

Expected: FAIL — methods not found on SaasMetricsService

### Step 3: Add `getDailyWebhookErrorCount` to `SaasMetricsService`

In `backend/src/services/saas-metrics.service.ts`, add the following method:

```typescript
/**
 * Get total webhook handler error count for the current calendar day (UTC)
 * Used for the "webhook_handler_error > 1/day" Sentry alert (16A.B.7)
 */
async getDailyWebhookErrorCount(): Promise<number> {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const result = await this.prisma.webhookMetrics.findMany({
    where: {
      date: { gte: startOfDay },
    },
    select: { failureCount: true },
  });

  return result.reduce((total, row) => total + row.failureCount, 0);
}

/**
 * Get the growth rate of processed_webhook_events in the last hour vs. previous hour.
 * A rate > 10x the previous hour may indicate a replay attack (16A.B.7).
 * Returns ratio: currentHourCount / previousHourCount (returns 1.0 if previousHour is 0).
 */
async getProcessedWebhookEventGrowthRate(): Promise<number> {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

  const [currentHourCount, previousHourCount] = await Promise.all([
    this.prisma.processedWebhookEvent.count({
      where: { processedAt: { gte: oneHourAgo } },
    }),
    this.prisma.processedWebhookEvent.count({
      where: { processedAt: { gte: twoHoursAgo, lt: oneHourAgo } },
    }),
  ]);

  if (previousHourCount === 0) {
    // No baseline — only alert if current hour is abnormally high (>100 events with no history)
    return currentHourCount > 100 ? 10.0 : 1.0;
  }

  return currentHourCount / previousHourCount;
}
```

### Step 4: Update `HourlyWebhookCheckJob.execute()` to use new methods

In `backend/src/jobs/daily-metrics.job.ts`, update the `execute()` method of `HourlyWebhookCheckJob`:

```typescript
async execute(): Promise<void> {
  Logger.info('Starting hourly webhook metrics check');

  try {
    // Check 1: Webhook failure rate (existing)
    const webhookFailureRate = await this.saasMetricsService.calculateWebhookFailureRate();

    Logger.info('Webhook metrics check completed', {
      failureRate: webhookFailureRate.toFixed(2) + '%',
      timestamp: new Date().toISOString(),
    });

    if (webhookFailureRate > ALERT_THRESHOLDS.webhookFailureRateMax) {
      Logger.error('High webhook failure rate detected', {
        failureRate: webhookFailureRate.toFixed(2) + '%',
        threshold: `${ALERT_THRESHOLDS.webhookFailureRateMax}%`,
      });

      Sentry.captureMessage(`High webhook failure rate: ${webhookFailureRate.toFixed(2)}%`, {
        level: 'error',
        tags: { component: 'webhook_monitoring', severity: 'critical' },
      });
    }

    // Check 2: Raw error count for the day (NEW — 16A.B.7)
    const dailyErrorCount = await this.saasMetricsService.getDailyWebhookErrorCount();

    if (dailyErrorCount > 1) {
      Logger.error('Webhook handler errors today exceeded threshold', {
        dailyErrorCount,
        threshold: 1,
      });

      Sentry.captureMessage(
        `${dailyErrorCount} webhook handler errors today (threshold: >1/day)`,
        {
          level: 'error',
          tags: {
            component: 'webhook_monitoring',
            alert_type: 'daily_error_count',
          },
          extra: { dailyErrorCount },
        },
      );
    }

    // Check 3: Replay attack detection via processed_webhook_events growth rate (NEW — 16A.B.7)
    const growthRate = await this.saasMetricsService.getProcessedWebhookEventGrowthRate();
    const REPLAY_ATTACK_GROWTH_THRESHOLD = 5.0; // >5x previous hour volume

    if (growthRate > REPLAY_ATTACK_GROWTH_THRESHOLD) {
      Logger.error('Potential replay attack detected: webhook event volume spike', {
        growthRate: growthRate.toFixed(2) + 'x',
        threshold: `${REPLAY_ATTACK_GROWTH_THRESHOLD}x`,
      });

      Sentry.captureMessage(
        `Potential replay attack: processed_webhook_events grew ${growthRate.toFixed(1)}x in the last hour`,
        {
          level: 'error',
          tags: {
            component: 'webhook_monitoring',
            alert_type: 'replay_attack_suspected',
            severity: 'critical',
          },
          extra: { growthRate },
        },
      );
    }
  } catch (error) {
    Logger.error('Hourly webhook check failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    Sentry.captureException(error, {
      tags: { job: 'hourly_webhook_check', component: 'scheduler' },
    });
  }
}
```

### Step 5: Run monitoring tests

```bash
cd backend && npx jest webhook-monitoring.test.ts --no-coverage
```

Expected: All 4 tests PASS

### Step 6: TypeScript check

```bash
cd backend && npx tsc --noEmit
```

Expected: 0 errors

### Step 7: Full test suite

```bash
cd backend && npm test -- --forceExit --no-coverage
```

Expected: All 678+ tests pass + 4 new tests pass

### Step 8: Commit

```bash
git add backend/src/jobs/daily-metrics.job.ts backend/src/services/saas-metrics.service.ts backend/src/tests/unit/webhook-monitoring.test.ts
git commit -m "feat(monitoring): add raw error count alert and replay attack detection (16A.B.7)"
```

---

## Task 6: Mark Phase 16A.B Complete in tasks.md

After all tests pass, update the checkboxes in `openspec/changes/plan-saas-monetization-model/tasks.md`:

Change lines 885-897 from `- [ ]` to `- [x]` for all 16A.B tasks.

```bash
git add openspec/changes/plan-saas-monetization-model/tasks.md
git commit -m "chore(tasks): mark Phase 16A.B Webhook & State Sync as complete"
```

---

## Task 7: Final Verification

### Step 1: Run full backend test suite

```bash
cd backend && npm test -- --forceExit
```

Expected: All suites pass, 0 failures

### Step 2: TypeScript compilation

```bash
cd backend && npx tsc --noEmit
```

Expected: 0 errors

### Step 3: Lint check

```bash
cd backend && npm run lint
```

Expected: 0 errors (warnings acceptable)

### Step 4: Smoke test webhook endpoint manually

```bash
# Verify the webhook endpoint still returns 400 for missing signature
curl -X POST http://localhost:3001/api/webhooks/stripe \
  -H "Content-Type: application/json" \
  -d '{"test": true}'
# Expected: {"error":"Missing stripe-signature header"}
```

---

## Risk Register

| Risk                                                     | Impact | Mitigation                                                                           |
| -------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------ |
| `isCreationLocked` migration breaks existing org queries | High   | Default is `false`, all existing code still works                                    |
| Stripe API rate limits during sync job                   | Medium | `limit: 100` per page + pagination is conservative; Stripe allows 100 req/s          |
| Replay attack alert false-positives at launch            | Low    | Threshold is 5x hourly baseline; new installs with 0 baseline capped to avoid noise  |
| `handleSubscriptionUpdated` transaction size increase    | Low    | Adding `organization.update` is one extra SQL; within SQLite transaction safe limits |
| `checkUsageLimit` extra DB query for org lock check      | Low    | One `findUnique` per write request; indexed on PK, negligible overhead               |

---

## Execution Checklist

- [ ] Task 1: Schema migration for `isCreationLocked`
- [ ] Task 2: Soft lock in `handleSubscriptionUpdated` + `handleSubscriptionDeleted`
- [ ] Task 3: Creation lock enforcement in `checkUsageLimit` middleware
- [ ] Task 4: Hourly Stripe subscription sync cron job
- [ ] Task 5: Webhook monitoring — raw error count + replay attack detection
- [ ] Task 6: Mark Phase 16A.B tasks complete in tasks.md
- [ ] Task 7: Final verification (tests + TypeScript + lint)
