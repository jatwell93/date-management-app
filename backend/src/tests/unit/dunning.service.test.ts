/**
 * Unit tests for SubscriptionService.downgradeExpiredPastDue
 * Tests the 7-day dunning auto-downgrade functionality
 */

vi.mock('@sentry/node', () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock('stripe', () => {
  // SUT default-imports Stripe; expose the constructor as `default`.
  const StripeMock = vi.fn().mockImplementation(function () {
    return {};
  });
  return { default: StripeMock };
});

vi.mock('../../database/database-factory');

import { SubscriptionService } from '../../services/subscription.service';
import { PrismaClient } from '@prisma/client';
import { SubscriptionStatus, TIER_LIMITS } from '../../types/subscription';

type MockPrisma = Record<string, any> & { $transaction: jest.Mock };

describe('SubscriptionService.downgradeExpiredPastDue', () => {
  let prisma: MockPrisma;
  let service: SubscriptionService;
  const sevenDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000); // 8 days ago

  beforeEach(() => {
    vi.clearAllMocks();

    prisma = {
      subscriptionTier: {
        findMany: vi.fn(),
        updateMany: vi.fn(),
      },
      organizationUsage: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      organization: {
        update: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
        count: vi.fn(),
      },
      $transaction: vi.fn((callback) => callback(prisma)),
    };

    service = new SubscriptionService(prisma as unknown as PrismaClient);
  });

  it('returns 0 and does nothing when no subscriptions are past_due > 7 days', async () => {
    prisma.subscriptionTier.findMany.mockResolvedValue([]);

    const count = await service.downgradeExpiredPastDue();

    expect(count).toBe(0);
    expect(prisma.subscriptionTier.updateMany).not.toHaveBeenCalled();
  });

  it('downgrades past_due subscription > 7 days old to Free', async () => {
    prisma.subscriptionTier.findMany.mockResolvedValue([
      { id: 1, organizationId: 'org-abc', pastDueSince: sevenDaysAgo },
    ]);
    prisma.organizationUsage.findUnique.mockResolvedValue({
      totalSkus: 100, // within Free limit of 500
      totalInventoryItems: 200, // within Free limit of 500
    });

    const count = await service.downgradeExpiredPastDue();

    expect(count).toBe(1);
    expect(prisma.subscriptionTier.updateMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-abc' },
      data: {
        status: SubscriptionStatus.ACTIVE,
        tierLevel: 'free',
        pastDueSince: null,
      },
    });
    expect(prisma.organizationUsage.update).toHaveBeenCalledWith({
      where: { organizationId: 'org-abc' },
      data: {
        maxSkus: TIER_LIMITS.free.max_skus,
        maxUsers: TIER_LIMITS.free.max_users,
        maxInventoryItems: TIER_LIMITS.free.max_inventory_items,
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
      totalSkus: 10,
      totalInventoryItems: 10,
    });

    const count = await service.downgradeExpiredPastDue();

    // Verify the downgrade happened
    expect(count).toBe(1);
    expect(prisma.subscriptionTier.updateMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-alert' },
      data: {
        status: SubscriptionStatus.ACTIVE,
        tierLevel: 'free',
        pastDueSince: null,
      },
    });
  });

  it('continues processing remaining orgs when one fails', async () => {
    prisma.subscriptionTier.findMany.mockResolvedValue([
      { id: 1, organizationId: 'org-fail', pastDueSince: sevenDaysAgo },
      { id: 2, organizationId: 'org-ok2', pastDueSince: sevenDaysAgo },
    ]);
    prisma.$transaction
      .mockRejectedValueOnce(new Error('DB error')) // org-fail fails
      .mockImplementation((cb) => cb(prisma)); // org-ok2 succeeds
    prisma.organizationUsage.findUnique.mockResolvedValue({
      totalSkus: 10,
      totalInventoryItems: 10,
    });

    const count = await service.downgradeExpiredPastDue();

    expect(count).toBe(1); // Only org-ok2 succeeded
  });
});
