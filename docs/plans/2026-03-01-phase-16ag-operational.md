# Phase 16A.G: Operational Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the three outstanding operational gaps in Phase 16A.G — the dunning auto-downgrade strategy (G.1), complete pending-downgrade communication for inventory items (G.2), and the SaaS operational runbook (G.3).

**Architecture:** Three coordinated work streams: (1) a new daily dunning cron job with schema migration and service method for auto-downgrading stale `past_due` subscriptions after a 7-day grace period; (2) a fix to the downgrade communication webhook handler to also check `totalInventoryItems` against new tier limits (currently only SKUs are checked); (3) a SaaS-specific operational runbook appended to the existing doc. All code must stay within existing service/job patterns already established in the codebase.

**Tech Stack:** Node.js, TypeScript, Prisma (SQLite dev / PostgreSQL production), node-cron, SendGrid (`@sendgrid/mail`), Stripe SDK, Sentry (`@sentry/node`), Jest (unit + integration tests)

---

## Pre-Flight Gap Checklist

> Read these before starting any task. They summarise every concrete gap found in the codebase.

| # | File | Gap |
|---|------|-----|
| G1a | `backend/prisma/schema.prisma` | `SubscriptionTier` missing `pastDueSince DateTime?` field — no way to measure 7-day grace period |
| G1b | `webhook.service.ts:674-691` | `handleInvoicePaymentFailed` doesn't set `pastDueSince` when first transitioning to `past_due` |
| G1c | `subscription.service.ts` | Missing `downgradeExpiredPastDue()` method |
| G1d | `scheduler.service.ts` | No dunning cron job registered |
| G1e | *(new file)* | `backend/src/jobs/dunning.job.ts` does not exist |
| G1f | Dunning downgrade path | `organizationUsage.maxSkus/maxUsers/maxInventoryItems` not reset to Starter limits on dunning downgrade |
| G1g | Dunning downgrade path | `isCreationLocked` not applied when dunning downgrade puts org over Starter limits |
| G1h | Dunning downgrade path | No Sentry `fatal` escalation alert fired after dunning downgrade |
| G2a | `webhook.service.ts:437-465` | `handleSubscriptionUpdated` only checks `totalSkus > limits.max_skus` — ignores `totalInventoryItems` (DECISION 8A.2) |
| G2b | `webhook.service.ts:540-562` | `handleSubscriptionDeleted` same inventory-item gap |
| G2c | *(missing test)* | No integration test for: upgrade → 3000 SKUs → downgrade to Professional → warning email verified |
| G3a | `backend/docs/operational-runbooks.md` | Entire file is pre-SaaS generic content — all four required SaaS sections absent |

---

## Task 1: Schema — Add `pastDueSince` to `SubscriptionTier`

**Files:**
- Modify: `backend/prisma/schema.prisma` (~line 43)
- Modify: `backend/prisma/production/schema.prisma` (same section)

---

**Step 1: Write the failing test (schema field existence)**

Open `backend/src/tests/integration/webhook.integration.test.ts` and add after the existing `isCreationLocked` test (~line 100):

```typescript
it('should have pastDueSince field on subscription_tiers', async () => {
  const subId = `sub_pds_${crypto.randomBytes(4).toString('hex')}`;

  const created = await prisma.subscriptionTier.create({
    data: {
      organizationId: testOrganizationId,
      tierLevel: 'professional',
      stripeSubscriptionId: subId,
      status: 'past_due',
      billingCycle: 'monthly',
      pastDueSince: new Date('2026-01-01T00:00:00Z'),
    },
  });

  expect(created.pastDueSince).toEqual(new Date('2026-01-01T00:00:00Z'));
});
```

**Step 2: Run test to confirm it fails**

```bash
cd backend && npx jest webhook.integration.test.ts --testNamePattern "pastDueSince" --no-coverage
```

Expected: FAIL — `Unknown argument 'pastDueSince'`

**Step 3: Add field to dev schema**

In `backend/prisma/schema.prisma`, within the `SubscriptionTier` model, add after `trialConvertedAt`:

```prisma
pastDueSince         DateTime?    @map("past_due_since")
```

And add an index:

```prisma
@@index([pastDueSince])
```

**Step 4: Run Prisma migration**

```bash
cd backend && npx prisma migrate dev --name add_past_due_since_to_subscription_tiers
```

Expected output: `The following migration(s) have been created and applied: migrations/..._add_past_due_since_to_subscription_tiers`

**Step 5: Regenerate Prisma client**

```bash
cd backend && npx prisma generate
```

Expected: `✔  Generated Prisma Client`

**Step 6: Sync to production schema**

In `backend/prisma/production/schema.prisma`, add the same field to `SubscriptionTier` model:

```prisma
pastDueSince         DateTime?    @map("past_due_since")
```

And the same index `@@index([pastDueSince])`.

**Step 7: Run test to confirm it passes**

```bash
cd backend && npx jest webhook.integration.test.ts --testNamePattern "pastDueSince" --no-coverage
```

Expected: PASS

**Step 8: Commit**

```bash
cd backend && git add prisma/schema.prisma prisma/production/schema.prisma prisma/migrations/ src/tests/integration/webhook.integration.test.ts
git commit -m "feat(schema): add pastDueSince field to SubscriptionTier for 7-day dunning window"
```

---

## Task 2: Update `handleInvoicePaymentFailed` — Record `pastDueSince`

**Files:**
- Modify: `backend/src/services/webhook.service.ts` (lines 660–712)
- Modify: `backend/src/tests/unit/webhook.service.test.ts` (lines 320–344)

---

**Step 1: Write the failing test**

In `webhook.service.test.ts`, replace the existing `'handles invoice payment failed'` test (lines 320–344) with:

```typescript
it('handles invoice payment failed — sets past_due and records pastDueSince on first failure', async () => {
  // Org is currently ACTIVE (first failure)
  prisma.subscriptionTier.findFirst.mockResolvedValue({ status: 'active', pastDueSince: null });

  const invoice = {
    id: 'in_test_123',
    customer: customerId,
    amount_due: 5000,
    hosted_invoice_url: 'https://invoice.test',
  } as unknown as Stripe.Invoice;

  await (service as any).handleInvoicePaymentFailed(invoice);

  expect(prisma.subscriptionTier.updateMany).toHaveBeenCalledWith({
    where: { organizationId },
    data: expect.objectContaining({
      status: SubscriptionStatus.PAST_DUE,
      pastDueSince: expect.any(Date),
    }),
  });
  expect(emailService.sendDunningEmail).toHaveBeenCalledWith(organizationId, invoice.hosted_invoice_url);
});

it('handles invoice payment failed — does NOT reset pastDueSince on retry failures', async () => {
  const existingPastDueSince = new Date('2026-01-01');
  // Org is ALREADY past_due (retry failure)
  prisma.subscriptionTier.findFirst.mockResolvedValue({
    status: 'past_due',
    pastDueSince: existingPastDueSince,
  });

  const invoice = {
    id: 'in_retry_123',
    customer: customerId,
    amount_due: 5000,
    hosted_invoice_url: 'https://invoice.test',
  } as unknown as Stripe.Invoice;

  await (service as any).handleInvoicePaymentFailed(invoice);

  const updateCall = (prisma.subscriptionTier.updateMany as jest.Mock).mock.calls[0][0];
  // pastDueSince should NOT be in the update data (already set)
  expect(updateCall.data.pastDueSince).toBeUndefined();
  expect(updateCall.data.status).toBe(SubscriptionStatus.PAST_DUE);
});
```

Also add `findFirst: jest.fn()` to the mock prisma's `subscriptionTier` block if not already present (it is present at line 46).

**Step 2: Run tests to confirm they fail**

```bash
cd backend && npx jest webhook.service.test.ts --no-coverage 2>&1 | tail -30
```

Expected: 2 new tests FAIL (updateMany call doesn't match expected data)

**Step 3: Update `handleInvoicePaymentFailed` in `webhook.service.ts`**

Replace the inner `$transaction` block (lines 675–691) with:

```typescript
// Determine if this is the FIRST failure (transition) or a retry
const currentTier = await this.prisma.subscriptionTier.findFirst({
  where: { organizationId },
  select: { status: true, pastDueSince: true },
});

const isFirstFailure = currentTier?.status !== SubscriptionStatus.PAST_DUE;

await this.prisma.$transaction(async (tx) => {
  await tx.subscriptionTier.updateMany({
    where: { organizationId },
    data: {
      status: SubscriptionStatus.PAST_DUE,
      // Only set pastDueSince on first transition — do NOT reset on Stripe retries
      ...(isFirstFailure ? { pastDueSince: new Date() } : {}),
    },
  });

  // Log dunning event
  await tx.auditLog.create({
    data: {
      organizationId,
      action: 'payment_failed',
      changeDescription: `Invoice ${invoice.id} payment failed: ${invoice.amount_due} cents (attempt ${isFirstFailure ? 1 : 'retry'})`,
    },
  });
});
```

> **Note:** The `currentTier` query runs OUTSIDE the transaction intentionally — it's a read-before-write pattern for the conditional. The `updateMany` inside the transaction is still atomic.

**Step 4: Run tests to confirm they pass**

```bash
cd backend && npx jest webhook.service.test.ts --no-coverage
```

Expected: All tests PASS (including the 2 new ones)

**Step 5: Commit**

```bash
cd backend && git add src/services/webhook.service.ts src/tests/unit/webhook.service.test.ts
git commit -m "feat(dunning): track pastDueSince on first invoice.payment_failed — skip reset on retries"
```

---

## Task 3: Add `downgradeExpiredPastDue()` to `SubscriptionService`

**Files:**
- Modify: `backend/src/services/subscription.service.ts` (after the `downgradeExpiredTrials` method, ~line 686)

---

**Step 1: Write the failing test**

Create new file `backend/src/tests/unit/dunning.service.test.ts`:

```typescript
import { SubscriptionService } from '../../services/subscription.service';
import { PrismaClient } from '@prisma/client';
import { SubscriptionStatus, TIER_LIMITS } from '../../types/subscription';
import * as Sentry from '@sentry/node';

jest.mock('@sentry/node', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));

jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({}));
});

jest.mock('../../database/database-factory');

type MockPrisma = Record<string, any> & { $transaction: jest.Mock };

describe('SubscriptionService.downgradeExpiredPastDue', () => {
  let prisma: MockPrisma;
  let service: SubscriptionService;
  const sevenDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000); // 8 days ago

  beforeEach(() => {
    prisma = {
      subscriptionTier: {
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
      organizationUsage: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      organization: {
        update: jest.fn(),
      },
      auditLog: {
        create: jest.fn(),
        count: jest.fn(),
      },
      $transaction: jest.fn((callback) => callback(prisma)),
    };

    service = new SubscriptionService(prisma as unknown as PrismaClient);
    jest.clearAllMocks();
  });

  it('returns 0 and does nothing when no subscriptions are past_due > 7 days', async () => {
    prisma.subscriptionTier.findMany.mockResolvedValue([]);

    const count = await service.downgradeExpiredPastDue();

    expect(count).toBe(0);
    expect(prisma.subscriptionTier.updateMany).not.toHaveBeenCalled();
  });

  it('downgrades past_due subscription > 7 days old to Starter', async () => {
    prisma.subscriptionTier.findMany.mockResolvedValue([
      { id: 1, organizationId: 'org-abc', pastDueSince: sevenDaysAgo },
    ]);
    prisma.organizationUsage.findUnique.mockResolvedValue({
      totalSkus: 100, // within Starter limit of 500
      totalInventoryItems: 200, // within Starter limit of 5000
    });

    const count = await service.downgradeExpiredPastDue();

    expect(count).toBe(1);
    expect(prisma.subscriptionTier.updateMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-abc' },
      data: {
        status: SubscriptionStatus.ACTIVE,
        tierLevel: 'starter',
        pastDueSince: null,
      },
    });
    expect(prisma.organizationUsage.update).toHaveBeenCalledWith({
      where: { organizationId: 'org-abc' },
      data: {
        maxSkus: TIER_LIMITS.starter.max_skus,
        maxUsers: TIER_LIMITS.starter.max_users,
        maxInventoryItems: TIER_LIMITS.starter.max_inventory_items,
      },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'dunning_downgrade' }),
    });
  });

  it('applies isCreationLocked=true when SKU usage exceeds Starter limit after dunning downgrade', async () => {
    prisma.subscriptionTier.findMany.mockResolvedValue([
      { id: 1, organizationId: 'org-over', pastDueSince: sevenDaysAgo },
    ]);
    prisma.organizationUsage.findUnique.mockResolvedValue({
      totalSkus: 999, // over Starter limit of 500
      totalInventoryItems: 100,
    });

    await service.downgradeExpiredPastDue();

    expect(prisma.organization.update).toHaveBeenCalledWith({
      where: { id: 'org-over' },
      data: { isCreationLocked: true },
    });
  });

  it('applies isCreationLocked=true when inventory usage exceeds Starter limit', async () => {
    prisma.subscriptionTier.findMany.mockResolvedValue([
      { id: 1, organizationId: 'org-inv-over', pastDueSince: sevenDaysAgo },
    ]);
    prisma.organizationUsage.findUnique.mockResolvedValue({
      totalSkus: 100,
      totalInventoryItems: 9999, // over Starter limit of 5000
    });

    await service.downgradeExpiredPastDue();

    expect(prisma.organization.update).toHaveBeenCalledWith({
      where: { id: 'org-inv-over' },
      data: { isCreationLocked: true },
    });
  });

  it('does NOT apply lock when usage is within Starter limits', async () => {
    prisma.subscriptionTier.findMany.mockResolvedValue([
      { id: 1, organizationId: 'org-ok', pastDueSince: sevenDaysAgo },
    ]);
    prisma.organizationUsage.findUnique.mockResolvedValue({
      totalSkus: 10,
      totalInventoryItems: 20,
    });

    await service.downgradeExpiredPastDue();

    expect(prisma.organization.update).not.toHaveBeenCalled();
  });

  it('sends Sentry fatal escalation alert for each dunning downgrade', async () => {
    prisma.subscriptionTier.findMany.mockResolvedValue([
      { id: 1, organizationId: 'org-alert', pastDueSince: sevenDaysAgo },
    ]);
    prisma.organizationUsage.findUnique.mockResolvedValue({
      totalSkus: 10, totalInventoryItems: 10,
    });

    await service.downgradeExpiredPastDue();

    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('org-alert'),
      expect.objectContaining({ level: 'fatal' }),
    );
  });

  it('continues processing remaining orgs when one fails', async () => {
    prisma.subscriptionTier.findMany.mockResolvedValue([
      { id: 1, organizationId: 'org-fail', pastDueSince: sevenDaysAgo },
      { id: 2, organizationId: 'org-ok2', pastDueSince: sevenDaysAgo },
    ]);
    prisma.$transaction
      .mockRejectedValueOnce(new Error('DB error'))  // org-fail fails
      .mockImplementation((cb) => cb(prisma));         // org-ok2 succeeds
    prisma.organizationUsage.findUnique.mockResolvedValue({
      totalSkus: 10, totalInventoryItems: 10,
    });

    const count = await service.downgradeExpiredPastDue();

    expect(count).toBe(1); // Only org-ok2 succeeded
  });
});
```

**Step 2: Run test to confirm it fails**

```bash
cd backend && npx jest dunning.service.test.ts --no-coverage 2>&1 | tail -20
```

Expected: FAIL — `service.downgradeExpiredPastDue is not a function`

**Step 3: Add `downgradeExpiredPastDue()` to `SubscriptionService`**

In `backend/src/services/subscription.service.ts`, add the following method after the `downgradeExpiredTrials()` method (after line 686, before the trial conversion section):

```typescript
// ========== Dunning: Auto-downgrade past_due subscriptions (7-day grace period) ==========

/**
 * Downgrade subscriptions that have been past_due for more than 7 days.
 * DECISION 8A.9: 7-day grace period before auto-downgrade.
 *
 * For each expired past_due subscription:
 * 1. Atomically update to starter tier (status=active)
 * 2. Reset organization_usage limits to Starter
 * 3. Apply isCreationLocked if usage exceeds Starter limits
 * 4. Log dunning_downgrade audit event
 * 5. Send Sentry fatal escalation alert
 *
 * @returns Number of organizations downgraded
 */
async downgradeExpiredPastDue(): Promise<number> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Find all past_due subscriptions that have exceeded the grace period
  const expiredPastDue = await this.prisma.subscriptionTier.findMany({
    where: {
      status: SubscriptionStatus.PAST_DUE,
      pastDueSince: { lte: sevenDaysAgo },
    },
    select: {
      id: true,
      organizationId: true,
      pastDueSince: true,
    },
  });

  if (expiredPastDue.length === 0) {
    return 0;
  }

  const starterLimits = TIER_LIMITS.starter;
  let downgradedCount = 0;

  for (const tier of expiredPastDue) {
    try {
      await this.prisma.$transaction(async (tx) => {
        // 1. Downgrade to Starter, clear pastDueSince
        await tx.subscriptionTier.updateMany({
          where: { organizationId: tier.organizationId },
          data: {
            status: SubscriptionStatus.ACTIVE,
            tierLevel: 'starter',
            pastDueSince: null,
          },
        });

        // 2. Reset usage limits to Starter tier
        await tx.organizationUsage.update({
          where: { organizationId: tier.organizationId },
          data: {
            maxSkus: starterLimits.max_skus,
            maxUsers: starterLimits.max_users,
            maxInventoryItems: starterLimits.max_inventory_items,
          },
        });

        // 3. Check if usage exceeds new Starter limits — apply creation lock if so
        const usage = await tx.organizationUsage.findUnique({
          where: { organizationId: tier.organizationId },
        });

        const isOverSkuLimit =
          starterLimits.max_skus !== null &&
          usage &&
          usage.totalSkus > starterLimits.max_skus;

        const isOverInventoryLimit =
          starterLimits.max_inventory_items !== null &&
          usage &&
          usage.totalInventoryItems > starterLimits.max_inventory_items;

        if (isOverSkuLimit || isOverInventoryLimit) {
          await tx.organization.update({
            where: { id: tier.organizationId },
            data: { isCreationLocked: true },
          });

          Logger.warn('Creation lock applied after dunning downgrade', {
            organizationId: tier.organizationId,
            totalSkus: usage?.totalSkus,
            totalInventoryItems: usage?.totalInventoryItems,
            starterSkuLimit: starterLimits.max_skus,
            starterInventoryLimit: starterLimits.max_inventory_items,
          });
        }

        // 4. Log audit event
        await tx.auditLog.create({
          data: {
            organizationId: tier.organizationId,
            action: 'dunning_downgrade',
            changeDescription: `Dunning auto-downgrade to Starter after 7-day past_due grace period. SKUs: ${usage?.totalSkus ?? 0}, InventoryItems: ${usage?.totalInventoryItems ?? 0}`,
          },
        });
      });

      // 5. Sentry fatal escalation alert (outside transaction — non-critical path)
      Sentry.captureMessage(
        `[DUNNING] Organization ${tier.organizationId} auto-downgraded to Starter after 7-day past_due grace period`,
        {
          level: 'fatal',
          tags: { component: 'dunning', event: 'auto_downgrade' },
          extra: {
            organizationId: tier.organizationId,
            pastDueSince: tier.pastDueSince?.toISOString(),
            gracePeriodDays: 7,
          },
        },
      );

      downgradedCount++;
      Logger.warn(`Dunning downgrade completed for organization ${tier.organizationId}`);
    } catch (error) {
      Logger.error(
        `Dunning downgrade failed for org ${tier.organizationId}: ${String(error)}`,
      );
      Sentry.captureException(error, {
        level: 'error',
        tags: { component: 'dunning', event: 'downgrade_failed' },
        extra: { organizationId: tier.organizationId },
      });
      // Continue with remaining orgs
    }
  }

  return downgradedCount;
}
```

Also add the `Sentry` import to `subscription.service.ts` if not already present at the top:

```typescript
import * as Sentry from '@sentry/node';
```

> Check line 18 — `Sentry` is already imported ✅

**Step 4: Run tests to confirm they pass**

```bash
cd backend && npx jest dunning.service.test.ts --no-coverage
```

Expected: All 6 tests PASS

**Step 5: Run the full test suite to check for regressions**

```bash
cd backend && npm test -- --forceExit 2>&1 | tail -20
```

Expected: 62+ suites pass, 0 failures

**Step 6: Commit**

```bash
cd backend && git add src/services/subscription.service.ts src/tests/unit/dunning.service.test.ts
git commit -m "feat(dunning): add downgradeExpiredPastDue() to SubscriptionService with soft-lock and Sentry alert"
```

---

## Task 4: Create Dunning Cron Job

**Files:**
- Create: `backend/src/jobs/dunning.job.ts`

---

**Step 1: Write the failing test**

Create `backend/src/tests/unit/dunning.job.test.ts`:

```typescript
import { runDunningJob, startDunningJob, stopDunningJob } from '../../jobs/dunning.job';
import { SubscriptionService } from '../../services/subscription.service';
import { EmailService } from '../../services/email.service';
import * as Sentry from '@sentry/node';

jest.mock('../../services/subscription.service');
jest.mock('../../services/email.service');
jest.mock('@sentry/node', () => ({ captureException: jest.fn() }));
jest.mock('node-cron', () => ({
  schedule: jest.fn().mockReturnValue({ stop: jest.fn() }),
}));

const MockSubscriptionService = SubscriptionService as jest.MockedClass<typeof SubscriptionService>;
const MockEmailService = EmailService as jest.MockedClass<typeof EmailService>;

describe('runDunningJob', () => {
  let mockSubService: jest.Mocked<SubscriptionService>;
  let mockEmailService: jest.Mocked<EmailService>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockSubService = {
      downgradeExpiredPastDue: jest.fn(),
      getRecentlyDunningDowngraded: jest.fn(),
    } as any;

    mockEmailService = {
      sendDowngradeWarningEmail: jest.fn(),
    } as any;

    MockSubscriptionService.mockImplementation(() => mockSubService);
    MockEmailService.mockImplementation(() => mockEmailService);
  });

  it('calls downgradeExpiredPastDue and returns count', async () => {
    mockSubService.downgradeExpiredPastDue.mockResolvedValue(2);
    mockSubService.getRecentlyDunningDowngraded.mockResolvedValue([]);

    await runDunningJob();

    expect(mockSubService.downgradeExpiredPastDue).toHaveBeenCalledTimes(1);
  });

  it('sends downgrade warning emails to each dunning-downgraded org', async () => {
    mockSubService.downgradeExpiredPastDue.mockResolvedValue(1);
    mockSubService.getRecentlyDunningDowngraded.mockResolvedValue([
      { organizationId: 'org-1', organizationName: 'Org One', contactEmail: 'admin@org1.com' },
    ]);

    await runDunningJob();

    expect(mockEmailService.sendDowngradeWarningEmail).toHaveBeenCalledWith(
      'org-1',
      expect.any(Number),
      500, // Starter SKU limit
    );
  });

  it('does not crash when one email send fails — continues processing', async () => {
    mockSubService.downgradeExpiredPastDue.mockResolvedValue(2);
    mockSubService.getRecentlyDunningDowngraded.mockResolvedValue([
      { organizationId: 'org-fail', organizationName: 'Org Fail', contactEmail: 'fail@org.com' },
      { organizationId: 'org-ok', organizationName: 'Org OK', contactEmail: 'ok@org.com' },
    ]);
    mockEmailService.sendDowngradeWarningEmail
      .mockRejectedValueOnce(new Error('SendGrid down'))
      .mockResolvedValueOnce(undefined);

    await expect(runDunningJob()).resolves.not.toThrow();

    expect(mockEmailService.sendDowngradeWarningEmail).toHaveBeenCalledTimes(2);
  });

  it('does not crash when downgradeExpiredPastDue throws', async () => {
    mockSubService.downgradeExpiredPastDue.mockRejectedValue(new Error('DB error'));

    await expect(runDunningJob()).resolves.not.toThrow();
    expect(Sentry.captureException).toHaveBeenCalled();
  });
});

describe('startDunningJob / stopDunningJob', () => {
  it('starts without throwing', () => {
    expect(() => startDunningJob()).not.toThrow();
    stopDunningJob(); // clean up
  });

  it('warns if started twice (idempotent)', () => {
    startDunningJob();
    expect(() => startDunningJob()).not.toThrow(); // second call just warns
    stopDunningJob();
  });
});
```

**Step 2: Run test to confirm it fails**

```bash
cd backend && npx jest dunning.job.test.ts --no-coverage 2>&1 | tail -20
```

Expected: FAIL — `Cannot find module '../../jobs/dunning.job'`

**Step 3: Create `backend/src/jobs/dunning.job.ts`**

```typescript
/**
 * Dunning Cron Job
 *
 * Runs daily at 01:00 UTC to auto-downgrade subscriptions that have been
 * past_due for more than 7 days (DECISION 8A.9).
 *
 * Steps:
 * 1. Find all past_due subscriptions where pastDueSince < now - 7 days
 * 2. Downgrade each to Starter tier (via SubscriptionService.downgradeExpiredPastDue)
 * 3. Send downgrade warning email to each affected org
 *
 * Schedule: Daily at 01:00 UTC (staggered from trial job at 00:00 UTC)
 */

import cron, { ScheduledTask } from 'node-cron';
import { SubscriptionService } from '../services/subscription.service';
import { EmailService } from '../services/email.service';
import { TIER_LIMITS } from '../types/subscription';
import { Logger } from '../utils/logger';
import * as Sentry from '@sentry/node';

let cronJob: ScheduledTask | null = null;

export function startDunningJob(): void {
  if (cronJob) {
    Logger.warn('Dunning job already running');
    return;
  }

  // Schedule: Daily at 01:00 UTC
  cronJob = cron.schedule('0 1 * * *', async () => {
    await runDunningJob();
  });

  Logger.info('Dunning job started (daily at 01:00 UTC)');
}

export function stopDunningJob(): void {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    Logger.info('Dunning job stopped');
  }
}

export async function runDunningJob(): Promise<void> {
  const subscriptionService = new SubscriptionService();
  const emailService = new EmailService();

  Logger.info('Starting dunning job — checking for past_due > 7 days');

  try {
    // Step 1: Downgrade expired past_due subscriptions
    const downgradedCount = await subscriptionService.downgradeExpiredPastDue();
    Logger.info(`Dunning job: downgraded ${downgradedCount} organizations to Starter tier`);

    // Step 2: Send downgrade warning emails to affected orgs
    if (downgradedCount > 0) {
      const recentDowngrades = await subscriptionService.getRecentlyDunningDowngraded();

      for (const org of recentDowngrades) {
        try {
          await emailService.sendDowngradeWarningEmail(
            org.organizationId,
            0, // Caller does not have current usage count; email template handles generic message
            TIER_LIMITS.starter.max_skus ?? 500,
          );
          Logger.info(`Dunning warning email sent to org ${org.organizationId}`);
        } catch (error) {
          Logger.error(
            `Failed to send dunning warning email to org ${org.organizationId}: ${String(error)}`,
          );
          Sentry.captureException(error, {
            level: 'error',
            tags: { job: 'dunning', event: 'warning-email-failed' },
            extra: { organizationId: org.organizationId },
          });
          // Continue with remaining orgs
        }
      }
    }

    Logger.info('Dunning job completed successfully');
  } catch (error) {
    Logger.error(`Dunning job failed: ${String(error)}`);
    Sentry.captureException(error, {
      level: 'error',
      tags: { job: 'dunning', event: 'job-failure' },
    });
    // Do NOT rethrow — cron job must not stop on single failure
  }
}
```

**Step 4: Add `getRecentlyDunningDowngraded()` to `SubscriptionService`**

In `subscription.service.ts`, directly below `downgradeExpiredPastDue()`, add:

```typescript
/**
 * Get organizations that were dunning-downgraded in the last 24 hours
 * Used by the dunning job to send post-downgrade warning emails.
 */
async getRecentlyDunningDowngraded(): Promise<
  Array<{ organizationId: string; organizationName: string; contactEmail: string | null }>
> {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const events = await this.prisma.auditLog.findMany({
    where: {
      action: 'dunning_downgrade',
      changedAt: { gte: yesterday },
    },
    orderBy: { changedAt: 'desc' },
  });

  const results: Array<{
    organizationId: string;
    organizationName: string;
    contactEmail: string | null;
  }> = [];

  for (const event of events) {
    const org = await this.prisma.organization.findUnique({
      where: { id: event.organizationId },
      select: { name: true, contactEmail: true },
    });

    if (org) {
      results.push({
        organizationId: event.organizationId,
        organizationName: org.name,
        contactEmail: org.contactEmail,
      });
    }
  }

  return results;
}
```

**Step 5: Run tests to confirm they pass**

```bash
cd backend && npx jest dunning.job.test.ts --no-coverage
```

Expected: All 6 tests PASS

**Step 6: Commit**

```bash
cd backend && git add src/jobs/dunning.job.ts src/services/subscription.service.ts src/tests/unit/dunning.job.test.ts
git commit -m "feat(dunning): create dunning cron job with email warnings and getRecentlyDunningDowngraded helper"
```

---

## Task 5: Register Dunning Job in Scheduler

**Files:**
- Modify: `backend/src/services/scheduler.service.ts` (lines 1–43)

---

**Step 1: Write the failing test**

In `backend/src/tests/unit/dunning.job.test.ts`, add at the bottom:

```typescript
describe('Scheduler integration', () => {
  it('dunning job module exports startDunningJob', () => {
    const { startDunningJob } = require('../../jobs/dunning.job');
    expect(typeof startDunningJob).toBe('function');
  });
});
```

**Step 2: Run test to confirm it passes already**

```bash
cd backend && npx jest dunning.job.test.ts --no-coverage
```

Expected: PASS (module already exports `startDunningJob`)

**Step 3: Register dunning job in scheduler**

In `backend/src/services/scheduler.service.ts`, add import at the top:

```typescript
import { startDunningJob } from '../jobs/dunning.job';
```

Then inside `SchedulerService.initialize()`, after `startStripeSyncJob()`:

```typescript
// Schedule dunning job daily at 01:00 UTC (DECISION 8A.9: 7-day grace period)
// Staggered 1 hour after trial expiration job (00:00 UTC) to avoid DB contention
startDunningJob();
```

**Step 4: Verify scheduler compiles**

```bash
cd backend && npx tsc --noEmit 2>&1
```

Expected: 0 errors

**Step 5: Commit**

```bash
cd backend && git add src/services/scheduler.service.ts
git commit -m "feat(dunning): register dunning cron job in SchedulerService.initialize()"
```

---

## Task 6: Fix `handleSubscriptionUpdated` — Add Inventory Item Limit Check (Gap G2a)

**Files:**
- Modify: `backend/src/services/webhook.service.ts` (lines 384–498, specifically lines 436–465)
- Modify: `backend/src/tests/unit/webhook.service.test.ts`

> **Context:** `handleSubscriptionUpdated` currently only checks `totalSkus > limits.max_skus` and applies `isCreationLocked`. Per DECISION 8A.2, the limits apply to both Products (SKUs) AND InventoryItems separately. Both must be checked on downgrade.

---

**Step 1: Write the failing test**

In `webhook.service.test.ts`, add after the existing `'sets isCreationLocked=true on org when downgrading over SKU limit'` test:

```typescript
it('sets isCreationLocked=true when totalInventoryItems exceeds new tier inventory limit', async () => {
  prisma.subscriptionTier.findFirst.mockResolvedValue({ tierLevel: 'professional' });
  // Within SKU limit, but OVER inventory item limit
  prisma.organizationUsage.findUnique.mockResolvedValue({
    totalSkus: 100,
    totalInventoryItems: 25000, // Over Professional limit of 20000
  });
  prisma.organization.update = jest.fn().mockResolvedValue({ id: organizationId });

  const subscription = {
    id: 'sub_inv_limit',
    customer: customerId,
    status: 'active',
    items: {
      data: [{ price: { metadata: { tier: 'starter' } } }], // downgrade to starter
    },
    trial_end: null,
    current_period_end: Math.floor(Date.now() / 1000) + 1000,
  } as unknown as Stripe.Subscription;

  await (service as any).handleSubscriptionUpdated(subscription);

  // Verify creation lock was applied (inventory over limit even if SKUs are OK)
  const lockCalls = (prisma.organization.update as jest.Mock).mock.calls.filter(
    (c) => c[0].data?.isCreationLocked === true,
  );
  expect(lockCalls).toHaveLength(1);
  expect(emailService.sendDowngradeWarningEmail).toHaveBeenCalled();
});
```

**Step 2: Run test to confirm it fails**

```bash
cd backend && npx jest webhook.service.test.ts --testNamePattern "inventory" --no-coverage 2>&1 | tail -20
```

Expected: FAIL — lock is not applied when only inventory is over limit

**Step 3: Update `handleSubscriptionUpdated` in `webhook.service.ts`**

Locate the check block inside the `$transaction` (around line 436):

```typescript
if (isDowngrade && limits.max_skus !== null && usage && usage.totalSkus > limits.max_skus) {
```

Replace the entire `if (isDowngrade ...)` block with:

```typescript
// DECISION 8A.2: Limits apply to Products (SKUs) AND InventoryItems separately
const isOverSkuLimit =
  isDowngrade &&
  limits.max_skus !== null &&
  usage !== null &&
  (usage?.totalSkus ?? 0) > (limits.max_skus as number);

const isOverInventoryLimit =
  isDowngrade &&
  limits.max_inventory_items !== null &&
  usage !== null &&
  (usage?.totalInventoryItems ?? 0) > (limits.max_inventory_items as number);

if (isOverSkuLimit || isOverInventoryLimit) {
  // Apply creation lock — blocks new product/inventory creation until usage drops
  await tx.organization.update({
    where: { id: organizationId },
    data: { isCreationLocked: true },
  });

  Logger.warn('Creation lock applied on tier downgrade (over limit)', {
    organizationId,
    totalSkus: usage?.totalSkus,
    totalInventoryItems: usage?.totalInventoryItems,
    newSkuLimit: limits.max_skus,
    newInventoryLimit: limits.max_inventory_items,
    isOverSkuLimit,
    isOverInventoryLimit,
  });

  // Queue warning email (non-blocking)
  await this.emailService.sendDowngradeWarningEmail(
    organizationId,
    isOverSkuLimit ? (usage?.totalSkus ?? 0) : (usage?.totalInventoryItems ?? 0),
    isOverSkuLimit ? (limits.max_skus as number) : (limits.max_inventory_items as number),
  );
} else if (!isDowngrade) {
  // If not locking (e.g. upgrade), ensure creation lock is cleared
  await tx.organization.update({
    where: { id: organizationId },
    data: { isCreationLocked: false },
  });
}
```

> **Note:** `sendDowngradeWarningEmail` receives the *primary* exceeded metric. For SKU violations it reports SKU count; for inventory-only violations it reports inventory count. This is acceptable for MVP — a future improvement could add both metrics.

**Step 4: Apply the same fix to `handleSubscriptionDeleted`**

Locate the check block inside `handleSubscriptionDeleted` (around line 540):

```typescript
if (usage && usage.totalSkus > (starterLimits.max_skus || 500)) {
```

Replace the entire `if` block with:

```typescript
const isOverSkuLimit = usage && usage.totalSkus > (starterLimits.max_skus ?? 500);
const isOverInventoryLimit =
  usage &&
  starterLimits.max_inventory_items !== null &&
  usage.totalInventoryItems > (starterLimits.max_inventory_items ?? 5000);

if (isOverSkuLimit || isOverInventoryLimit) {
  await tx.organization.update({
    where: { id: organizationId },
    data: { isCreationLocked: true },
  });

  Logger.warn('Creation lock applied on subscription cancellation', {
    organizationId,
    totalSkus: usage?.totalSkus,
    totalInventoryItems: usage?.totalInventoryItems,
    starterSkuLimit: starterLimits.max_skus,
    starterInventoryLimit: starterLimits.max_inventory_items,
  });

  await this.emailService.sendDowngradeWarningEmail(
    organizationId,
    isOverSkuLimit ? (usage?.totalSkus ?? 0) : (usage?.totalInventoryItems ?? 0),
    isOverSkuLimit
      ? (starterLimits.max_skus ?? 500)
      : (starterLimits.max_inventory_items ?? 5000),
  );
}
```

**Step 5: Run all webhook tests to confirm they pass**

```bash
cd backend && npx jest webhook.service.test.ts --no-coverage
```

Expected: All tests PASS (including new inventory-limit test)

**Step 6: Commit**

```bash
cd backend && git add src/services/webhook.service.ts src/tests/unit/webhook.service.test.ts
git commit -m "fix(downgrade): check totalInventoryItems as well as totalSkus on tier downgrade (DECISION 8A.2)"
```

---

## Task 7: Write Integration Test for Downgrade Communication (Gap G2c)

**Files:**
- Create: `backend/src/tests/integration/dunning-downgrade-communication.test.ts`

> **Pattern:** Real Prisma client, mocked Stripe and EmailService. Follows `webhook.edge-cases.test.ts` pattern.

---

**Step 1: Create the test file**

```typescript
/**
 * Dunning Downgrade Communication Integration Tests
 *
 * Tests the end-to-end flow for 16A.G.2:
 * - Subscription downgrade sends warning email when usage exceeds new tier limits
 * - Both SKU and inventory item limits are checked (DECISION 8A.2)
 */

import { PrismaClient } from '@prisma/client';
import { WebhookService } from '../../services/webhook.service';
import { EmailService } from '../../services/email.service';
import Stripe from 'stripe';
import crypto from 'crypto';
import { TIER_LIMITS } from '../../types/subscription';

jest.mock('stripe');
jest.mock('../../services/email.service');
jest.mock('@sendgrid/mail', () => ({ setApiKey: jest.fn(), send: jest.fn() }));

const prisma = new PrismaClient();

describe('Downgrade Communication Integration Tests (16A.G.2)', () => {
  let webhookService: WebhookService;
  let mockEmailService: jest.Mocked<EmailService>;
  let mockStripe: jest.Mocked<Stripe>;
  let testOrgId: string;

  beforeAll(() => {
    mockEmailService = {
      sendDowngradeWarningEmail: jest.fn().mockResolvedValue(undefined),
      sendDunningEmail: jest.fn().mockResolvedValue(undefined),
    } as any;

    webhookService = new WebhookService(
      prisma as unknown as PrismaClient,
      undefined,
      mockEmailService,
    );

    mockStripe = {
      customers: { retrieve: jest.fn() },
    } as any;
    (webhookService as any).stripe = mockStripe;
  });

  beforeEach(async () => {
    await prisma.auditLog.deleteMany({});
    await prisma.organizationUsage.deleteMany({});
    await prisma.subscriptionTier.deleteMany({});
    await prisma.organization.deleteMany({});
    jest.clearAllMocks();

    const slug = `test-org-${crypto.randomBytes(4).toString('hex')}`;
    const org = await prisma.organization.create({
      data: {
        id: `org-${crypto.randomBytes(4).toString('hex')}`,
        name: 'Downgrade Test Org',
        slug,
        contactEmail: 'admin@test.com',
      },
    });
    testOrgId = org.id;

    mockStripe.customers.retrieve.mockResolvedValue({
      id: 'cus_test',
      deleted: false,
      metadata: { organizationId: testOrgId },
    } as any);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('16A.G.2: sends warning email when SKUs exceed new tier limit on upgrade → downgrade', async () => {
    // Setup: org on Premium with 3000 SKUs (over Professional limit of 2000)
    await prisma.subscriptionTier.create({
      data: {
        organizationId: testOrgId,
        tierLevel: 'premium',
        status: 'active',
        billingCycle: 'monthly',
        stripeSubscriptionId: 'sub_premium_123',
      },
    });

    await prisma.organizationUsage.create({
      data: {
        organizationId: testOrgId,
        totalSkus: 3000, // over Professional limit of 2000
        maxSkus: TIER_LIMITS.premium.max_skus ?? 999999,
        activeUsers: 2,
        maxUsers: TIER_LIMITS.premium.max_users ?? 10,
        totalInventoryItems: 100,
        maxInventoryItems: TIER_LIMITS.premium.max_inventory_items ?? 999999,
        storageUsedBytes: 0,
      },
    });

    // Trigger: subscription.updated to Professional (downgrade)
    const subscription: Partial<Stripe.Subscription> = {
      id: 'sub_prof_123',
      customer: 'cus_test',
      status: 'active',
      items: {
        object: 'list',
        data: [
          {
            price: { metadata: { tier: 'professional' } } as any,
          } as any,
        ],
        has_more: false,
        url: '',
      },
      trial_end: null,
      current_period_end: Math.floor(Date.now() / 1000) + 2592000,
    };

    await (webhookService as any).handleSubscriptionUpdated(subscription);

    // Verify: warning email was sent (3000 SKUs > 2000 Professional limit)
    expect(mockEmailService.sendDowngradeWarningEmail).toHaveBeenCalledWith(
      testOrgId,
      3000, // current usage
      2000, // new Professional SKU limit
    );

    // Verify: creation lock applied
    const org = await prisma.organization.findUnique({ where: { id: testOrgId } });
    expect(org?.isCreationLocked).toBe(true);
  });

  it('16A.G.2: sends warning email when inventory items exceed new tier limit on downgrade', async () => {
    // Setup: org on Premium with 8000 inventory items (over Starter limit of 5000)
    await prisma.subscriptionTier.create({
      data: {
        organizationId: testOrgId,
        tierLevel: 'premium',
        status: 'active',
        billingCycle: 'monthly',
        stripeSubscriptionId: 'sub_premium_456',
      },
    });

    await prisma.organizationUsage.create({
      data: {
        organizationId: testOrgId,
        totalSkus: 100, // within Starter limit
        maxSkus: 999999,
        activeUsers: 1,
        maxUsers: 10,
        totalInventoryItems: 8000, // over Starter inventory limit of 5000
        maxInventoryItems: 999999,
        storageUsedBytes: 0,
      },
    });

    // Trigger: downgrade to Starter
    const subscription: Partial<Stripe.Subscription> = {
      id: 'sub_starter_456',
      customer: 'cus_test',
      status: 'active',
      items: {
        object: 'list',
        data: [{ price: { metadata: { tier: 'starter' } } as any } as any],
        has_more: false,
        url: '',
      },
      trial_end: null,
      current_period_end: Math.floor(Date.now() / 1000) + 2592000,
    };

    await (webhookService as any).handleSubscriptionUpdated(subscription);

    // Verify: warning sent for inventory items (the over-limit resource)
    expect(mockEmailService.sendDowngradeWarningEmail).toHaveBeenCalledWith(
      testOrgId,
      8000, // inventory usage
      5000, // Starter inventory limit
    );

    const org = await prisma.organization.findUnique({ where: { id: testOrgId } });
    expect(org?.isCreationLocked).toBe(true);
  });

  it('16A.G.2: does NOT send warning email when usage is within new tier limits', async () => {
    // Setup: org on Professional with 100 SKUs (within Starter limits)
    await prisma.subscriptionTier.create({
      data: {
        organizationId: testOrgId,
        tierLevel: 'professional',
        status: 'active',
        billingCycle: 'monthly',
        stripeSubscriptionId: 'sub_prof_ok',
      },
    });

    await prisma.organizationUsage.create({
      data: {
        organizationId: testOrgId,
        totalSkus: 100, // within Starter limit of 500
        maxSkus: 2000,
        activeUsers: 1,
        maxUsers: 3,
        totalInventoryItems: 200, // within Starter limit of 5000
        maxInventoryItems: 20000,
        storageUsedBytes: 0,
      },
    });

    const subscription: Partial<Stripe.Subscription> = {
      id: 'sub_starter_ok',
      customer: 'cus_test',
      status: 'active',
      items: {
        object: 'list',
        data: [{ price: { metadata: { tier: 'starter' } } as any } as any],
        has_more: false,
        url: '',
      },
      trial_end: null,
      current_period_end: Math.floor(Date.now() / 1000) + 2592000,
    };

    await (webhookService as any).handleSubscriptionUpdated(subscription);

    expect(mockEmailService.sendDowngradeWarningEmail).not.toHaveBeenCalled();

    const org = await prisma.organization.findUnique({ where: { id: testOrgId } });
    expect(org?.isCreationLocked).toBeFalsy();
  });
});
```

**Step 2: Run the integration tests**

```bash
cd backend && npx jest dunning-downgrade-communication.test.ts --no-coverage
```

Expected: All 3 tests PASS

**Step 3: Commit**

```bash
cd backend && git add src/tests/integration/dunning-downgrade-communication.test.ts
git commit -m "test(downgrade): add integration tests for 16A.G.2 SKU and inventory downgrade communication"
```

---

## Task 8: Write SaaS Operational Runbook (Gap G3)

**Files:**
- Modify: `backend/docs/operational-runbooks.md` (append new section at end)

---

**Step 1: Verify current state of the runbook**

Run:

```bash
cd backend && wc -l docs/operational-runbooks.md
```

Expected: 244 lines (all pre-SaaS generic content, ends at `## Escalation Contacts`). The file has nothing for SaaS-specific operations.

**Step 2: Append the SaaS Operations section**

Append the following to `backend/docs/operational-runbooks.md`:

````markdown

---

## SaaS Operations (Stripe / Subscriptions / Multi-Tenant)

> This section covers SaaS-specific operational procedures for webhook management,
> subscription state, dunning, and cross-tenant diagnostics.

---

### 1. Manually Sync Stripe Subscription State (If Cron Fails)

**When to use:** The hourly `stripe-sync.job` (registered in `SchedulerService`) failed silently,
or a webhook was missed, and local `subscription_tiers` is out of sync with Stripe.

**Check current divergence:**

```bash
# Check when the last sync ran (look for "Hourly Stripe sync completed" log lines)
pm2 logs date-management-app --lines 500 | grep "Stripe sync"

# Check a specific org's subscription state in the local DB
sqlite3 backend/prisma/database.sqlite \
  "SELECT org.name, st.tier_level, st.status, st.stripe_subscription_id, st.past_due_since
   FROM subscription_tiers st
   JOIN organizations org ON org.id = st.organization_id
   WHERE org.id = '<ORGANIZATION_ID>';"
```

**Trigger a one-off sync manually:**

```bash
# From the backend directory, run the sync job directly via ts-node
cd backend && npx ts-node -e "
const { runStripeSyncJob } = require('./src/jobs/stripe-sync.job');
const { getDefaultDatabaseClient } = require('./src/database/database-factory');
const Stripe = require('stripe');
const prisma = getDefaultDatabaseClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-08-16' });
runStripeSyncJob(prisma, stripe).then(() => { console.log('Sync complete'); process.exit(0); });
"
```

**Manually update a single org's tier (last resort, when Stripe and DB both agree but data is wrong):**

```sql
-- ALWAYS verify with Stripe dashboard first before running this
UPDATE subscription_tiers
SET tier_level = 'professional', status = 'active', updated_at = CURRENT_TIMESTAMP
WHERE organization_id = '<ORGANIZATION_ID>';

UPDATE organization_usage
SET max_skus = 2000, max_users = 3, max_inventory_items = 20000
WHERE organization_id = '<ORGANIZATION_ID>';
```

> **Caution:** Only run raw SQL updates if Stripe dashboard confirms the correct tier.
> Restart the app after manual updates to invalidate the subscription cache:
> `pm2 restart date-management-app`

---

### 2. Rescue Failed Webhook Events

**When to use:** Stripe shows a webhook event was delivered and returned 5xx.
The event was NOT recorded in `processed_webhook_events` and the subscription state was not updated.

**Check the idempotency log:**

```bash
sqlite3 backend/prisma/database.sqlite \
  "SELECT id, event_type, processed_at
   FROM processed_webhook_events
   WHERE processed_at > datetime('now', '-24 hours')
   ORDER BY processed_at DESC LIMIT 20;"
```

**Find unprocessed events via Stripe dashboard:**

1. Go to Stripe Dashboard → Developers → Webhooks → Select your endpoint
2. Filter by status `Failed`
3. Note the Event ID (e.g., `evt_1ABCDEfgHI`)

**Replay a specific event via Stripe CLI:**

```bash
# Install Stripe CLI if not present: https://stripe.com/docs/stripe-cli
stripe events resend evt_1ABCDEfgHI --webhook-endpoint <YOUR_WEBHOOK_ENDPOINT_ID>
```

**Alternatively, replay via Stripe Dashboard:**

1. Click the failed event
2. Click "Resend" button in the top right

**Verify the event was processed after replay:**

```bash
sqlite3 backend/prisma/database.sqlite \
  "SELECT id, event_type, processed_at FROM processed_webhook_events WHERE id = 'evt_1ABCDEfgHI';"
```

Expected: One row returned.

**If the webhook endpoint is unreachable (e.g., server is down during maintenance):**

The `processed_webhook_events` table prevents double-processing once the server is back.
Stripe will auto-retry failed webhooks for 72 hours. No manual action required if the server
recovers within 72 hours. After 72 hours, use the Stripe CLI `stripe events resend` approach above.

---

### 3. Handle Customer Disputes

**When to use:** A customer disputes a charge via their bank (chargeback), or contacts support
to dispute their subscription tier, payment amount, or access level.

**Step 1: Find the customer's organization in the audit log:**

```bash
sqlite3 backend/prisma/database.sqlite \
  "SELECT al.action, al.change_description, al.changed_at, org.name, org.contact_email
   FROM audit_logs al
   JOIN organizations org ON org.id = al.organization_id
   WHERE org.contact_email = '<CUSTOMER_EMAIL>'
   ORDER BY al.changed_at DESC LIMIT 50;"
```

**Step 2: Verify Stripe state matches local state:**

```bash
# In the Stripe dashboard, search by customer email
# Cross-check subscription status and payment history

# In local DB:
sqlite3 backend/prisma/database.sqlite \
  "SELECT org.name, st.tier_level, st.status, st.stripe_subscription_id, st.stripe_customer_id
   FROM subscription_tiers st
   JOIN organizations org ON org.id = st.organization_id
   WHERE org.contact_email = '<CUSTOMER_EMAIL>';"
```

**Step 3: Check processed webhook events for the subscription:**

```bash
sqlite3 backend/prisma/database.sqlite \
  "SELECT id, event_type, processed_at FROM processed_webhook_events
   WHERE event_type LIKE '%invoice%' OR event_type LIKE '%subscription%'
   ORDER BY processed_at DESC LIMIT 30;"
```

**Step 4: For billing disputes, respond to Stripe chargeback via Stripe Dashboard:**

1. Go to Stripe Dashboard → Disputes
2. Submit evidence: invoice PDF, product usage data from audit_logs, email correspondence
3. Stripe resolution takes 7-21 days

**Step 5: Temporary access restoration (if dispute is valid):**

```bash
# Manually restore access while dispute is resolved
sqlite3 backend/prisma/database.sqlite \
  "UPDATE subscription_tiers SET status = 'active'
   WHERE organization_id = '<ORGANIZATION_ID>';"

# Clear any creation lock
sqlite3 backend/prisma/database.sqlite \
  "UPDATE organizations SET is_creation_locked = 0
   WHERE id = '<ORGANIZATION_ID>';"
```

Then restart to clear the subscription cache: `pm2 restart date-management-app`

---

### 4. Diagnose Cross-Tenant Data Leaks

**When to use:** Suspicion or report that data from one organization is visible to another.
Or a security audit requires verification of tenant isolation.

**Step 1: Check for NULL organizationId rows (potential orphaned data):**

```bash
# Run the built-in audit script (exits with code 1 if NULLs found)
cd backend && npm run audit:org-ids
```

If this script doesn't exist, run manually:

```bash
sqlite3 backend/prisma/database.sqlite <<'SQL'
SELECT 'products' as tbl, COUNT(*) as null_orgs FROM products WHERE organization_id IS NULL
UNION ALL
SELECT 'inventory_items', COUNT(*) FROM inventory_items WHERE organization_id IS NULL
UNION ALL
SELECT 'users', COUNT(*) FROM users WHERE organization_id IS NULL
UNION ALL
SELECT 'uploads', COUNT(*) FROM uploads WHERE organization_id IS NULL
UNION ALL
SELECT 'audit_logs', COUNT(*) FROM audit_logs WHERE organization_id IS NULL;
SQL
```

Expected: All counts = 0. If any are non-zero, those are orphaned records that need backfill.

**Step 2: Check audit logs for cross-tenant access attempts:**

The `tenant-isolation.middleware.ts` logs cross-tenant access attempts. Search Sentry:

```
# In Sentry, filter by:
# Tag: component = "tenant_isolation"
# Level: warning or error
# Time range: last 24 hours
```

Or scan application logs:

```bash
pm2 logs date-management-app --lines 1000 | grep "cross-tenant\|CROSS_TENANT\|tenant.*isolation"
```

**Step 3: Verify specific org cannot access another org's data:**

```bash
# Check if product X belongs to the correct org
sqlite3 backend/prisma/database.sqlite \
  "SELECT p.id, p.sku, p.organization_id, org.name
   FROM products p JOIN organizations org ON org.id = p.organization_id
   WHERE p.id = '<PRODUCT_ID>';"

# Verify the requesting user's org matches
sqlite3 backend/prisma/database.sqlite \
  "SELECT u.id, u.organization_id, org.name
   FROM users u JOIN organizations org ON org.id = u.organization_id
   WHERE u.id = '<USER_ID>';"
```

**Step 4: Check for missing WHERE organizationId clause in a slow query log:**

If you suspect a query is returning cross-tenant data, enable SQLite slow query logging
temporarily and filter for queries without `organization_id` in the WHERE clause.

```bash
pm2 logs date-management-app --lines 500 | grep "Slow query\|organization_id.*IS NULL"
```

**Step 5: If a real leak is confirmed — immediate response:**

1. **Immediately** revoke the affected JWT tokens by restarting the app: `pm2 restart date-management-app`
2. Identify which data was exposed (from audit logs, Sentry breadcrumbs)
3. Notify affected organizations within 72 hours per GDPR requirements
4. File incident report with root cause and fix timeline

---

### 5. Dunning & Past-Due Subscription Operations

**Check orgs currently in past_due status:**

```bash
sqlite3 backend/prisma/database.sqlite \
  "SELECT org.name, org.contact_email, st.tier_level, st.status, st.past_due_since
   FROM subscription_tiers st
   JOIN organizations org ON org.id = st.organization_id
   WHERE st.status = 'past_due'
   ORDER BY st.past_due_since ASC;"
```

**Manually trigger the dunning job (emergency re-run):**

```bash
cd backend && npx ts-node -e "
const { runDunningJob } = require('./src/jobs/dunning.job');
runDunningJob().then(() => { console.log('Dunning job complete'); process.exit(0); });
"
```

**Manually clear past_due status (after customer resolves payment):**

```bash
# Stripe webhook will do this automatically when payment succeeds.
# Only run manually if webhook was missed.
sqlite3 backend/prisma/database.sqlite \
  "UPDATE subscription_tiers
   SET status = 'active', past_due_since = NULL
   WHERE organization_id = '<ORGANIZATION_ID>';"

# Clear creation lock if it was applied
sqlite3 backend/prisma/database.sqlite \
  "UPDATE organizations SET is_creation_locked = 0 WHERE id = '<ORGANIZATION_ID>';"

# Restart to clear cache
pm2 restart date-management-app
```

**Check dunning downgrade history (last 30 days):**

```bash
sqlite3 backend/prisma/database.sqlite \
  "SELECT al.organization_id, org.name, org.contact_email, al.changed_at
   FROM audit_logs al
   JOIN organizations org ON org.id = al.organization_id
   WHERE al.action = 'dunning_downgrade'
     AND al.changed_at > datetime('now', '-30 days')
   ORDER BY al.changed_at DESC;"
```

---

### 6. Emergency: Restore Access After Service Outage

**When to use:** The app was down > 72 hours, Stripe webhooks were missed, and customers
report incorrect access levels or missing subscriptions.

**Step 1: Identify outage window**

```bash
# Check app logs for downtime window
pm2 logs date-management-app --lines 1000 | grep -E "(Starting|stopped|restart|error)"
```

**Step 2: Run full Stripe sync for all active subscriptions**

```bash
cd backend && npx ts-node -e "
const { runStripeSyncJob } = require('./src/jobs/stripe-sync.job');
const { getDefaultDatabaseClient } = require('./src/database/database-factory');
const Stripe = require('stripe');
const prisma = getDefaultDatabaseClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-08-16' });
console.log('Running full Stripe sync...');
runStripeSyncJob(prisma, stripe).then(() => { console.log('Full sync complete'); process.exit(0); });
"
```

**Step 3: Manually replay critical missed webhooks**

In Stripe Dashboard → Webhooks:
1. Filter by date range of outage
2. Look for events with status `Failed` or `Not Delivered`
3. Bulk replay: select events → "Resend selected"
4. Prioritize: `invoice.payment_succeeded`, `customer.subscription.updated`, `invoice.payment_failed`

**Step 4: Verify critical customers are correctly synced**

```bash
# Check top 10 customers by SKU count
sqlite3 backend/prisma/database.sqlite \
  "SELECT org.name, st.tier_level, st.status, ou.total_skus
   FROM organizations org
   JOIN subscription_tiers st ON org.id = st.organization_id
   JOIN organization_usage ou ON org.id = ou.organization_id
   ORDER BY ou.total_skus DESC
   LIMIT 10;"

# If any show unexpected tiers, verify against Stripe dashboard
```

**Step 5: Clear all subscription caches**

```bash
pm2 restart date-management-app
```

**Step 6: Send proactive communication to affected customers**

If any customers were incorrectly downgraded or locked during the outage:
1. Identify them via audit logs during outage window
2. Send apology email with explanation
3. Offer service credit if appropriate (document in Stripe as discount)

---

### 7. Subscription Metrics & Health Monitoring

**Daily health check (run via cron or manually):**

```bash
# 1. Count orgs by tier
sqlite3 backend/prisma/database.sqlite \
  "SELECT st.tier_level, COUNT(*) as count
   FROM subscription_tiers st
   WHERE st.status = 'active'
   GROUP BY st.tier_level
   ORDER BY count DESC;"

# 2. Count past_due orgs and how long they've been past_due
sqlite3 backend/prisma/database.sqlite \
  "SELECT 
     COUNT(*) as past_due_count,
     COUNT(CASE WHEN past_due_since < datetime('now', '-7 days') THEN 1 END) as over_7_days,
     COUNT(CASE WHEN past_due_since < datetime('now', '-14 days') THEN 1 END) as over_14_days
   FROM subscription_tiers
   WHERE status = 'past_due';"

# 3. Count orgs with creation locks
sqlite3 backend/prisma/database.sqlite \
  "SELECT COUNT(*) as locked_orgs
   FROM organizations
   WHERE is_creation_locked = 1;"

# 4. Check for webhook processing failures in last 24h
sqlite3 backend/prisma/database.sqlite \
  "SELECT COUNT(*) as failed_webhooks
   FROM processed_webhook_events
   WHERE processed_at > datetime('now', '-24 hours')
     AND event_type LIKE '%error%';"
```

**Set up alerts for:**
- More than 5 orgs past_due over 7 days (possible dunning job failure)
- More than 10 orgs with creation locks (possible mass downgrade issue)
- Any webhook processing failures (monitor Sentry for webhook errors)

---

## Escalation Contacts (SaaS)

| Issue | Primary | Backup |
|-------|---------|--------|
| Stripe webhook failures | DevOps | Engineering Lead |
| Dunning job failures | Engineering Lead | CTO |
| Customer payment disputes | Support Lead | Engineering Lead |
| Cross-tenant data leak | CTO | Security Team |
| Service outage > 1 hour | DevOps | Engineering Lead |

---

**Last Updated:** 2026-03-01  
**Version:** 1.0  
**Next Review:** 2026-06-01
````

**Step 3: Verify the runbook is well-formed**

```bash
cd backend && head -n 10 docs/operational-runbooks.md && echo "..." && tail -n 10 docs/operational-runbooks.md
```

Expected: File starts with existing header and ends with the new SaaS sections.

**Step 4: Commit**

```bash
cd backend && git add docs/operational-runbooks.md
git commit -m "docs(ops): add SaaS operational runbook section (16A.G.3) - Stripe sync, webhooks, disputes, tenant isolation, dunning"
```

---

## Task 9: End-to-End Verification

**Files:** No new files — run verification commands

---

**Step 1: Run the full test suite**

```bash
cd backend && npm test -- --forceExit 2>&1 | tail -30
```

Expected: 62+ suites pass, 0 failures

**Step 2: Verify TypeScript compilation**

```bash
cd backend && npx tsc --noEmit 2>&1
```

Expected: 0 errors

**Step 3: Check linting**

```bash
cd backend && npm run lint 2>&1 | tail -10
```

Expected: 0 errors (warnings acceptable)

**Step 4: Verify all new cron jobs are registered**

Check `backend/src/services/scheduler.service.ts` contains both:
- `startDunningJob()` call
- Existing `runTrialExpirationJob()` and `runStripeSyncJob()`

**Step 5: Verify schema migration exists**

```bash
cd backend && ls -la prisma/migrations/ | grep "past_due_since"
```

Expected: One migration file with `past_due_since` in the name

**Step 6: Quick manual smoke test (optional, in dev environment)**

```bash
# Start the app and verify scheduler initializes without errors
cd backend && npm start
# Look for: "Dunning job started (daily at 01:00 UTC)" in logs
# Press Ctrl+C after 10 seconds
```

**Step 7: Final commit with verification note**

```bash
cd backend && git add -A
git commit -m "feat(16A.G): complete operational implementation - dunning auto-downgrade, inventory limit checks, SaaS runbook

- Add pastDueSince field to SubscriptionTier schema
- Record pastDueSince on first invoice.payment_failed
- Implement downgradeExpiredPastDue() with 7-day grace period
- Create daily dunning cron job with email warnings
- Fix downgrade communication to check totalInventoryItems (DECISION 8A.2)
- Add integration tests for downgrade communication
- Write comprehensive SaaS operational runbook
- All tests pass, TypeScript compiles, lint clean

Closes 16A.G.1, 16A.G.2, 16A.G.3"
```

---

## Execution Choice

This plan is ready for implementation. Choose your execution approach:

1. **Subagent-Driven (this session):** I'll execute tasks 1-9 sequentially, reporting after each major milestone
2. **Parallel Session:** Start a fresh session with the `using-superpowers` skill and reference this plan file

Both approaches will result in the same implementation. The subagent-driven approach provides continuous progress updates; the parallel session approach allows for focused execution without conversation overhead.

---

**Files Modified (Summary):**
- `backend/prisma/schema.prisma` + `backend/prisma/production/schema.prisma` — add `pastDueSince` field
- `backend/src/services/webhook.service.ts` — record `pastDueSince`, check inventory limits on downgrade
- `backend/src/services/subscription.service.ts` — add `downgradeExpiredPastDue()` and `getRecentlyDunningDowngraded()`
- `backend/src/services/scheduler.service.ts` — register dunning cron job
- `backend/src/jobs/dunning.job.ts` — new daily dunning job
- `backend/docs/operational-runbooks.md` — append SaaS operational procedures
- Multiple test files — unit and integration tests for new functionality

**Estimated Time:** 2-3 hours including test runs and verification
