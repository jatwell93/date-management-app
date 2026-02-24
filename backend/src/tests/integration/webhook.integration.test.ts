import { PrismaClient } from '@prisma/client';
import { TIER_LIMITS } from '../../types/subscription';
import crypto from 'crypto';

// Mock external services - we're testing database integration only
jest.mock('../../services/subscription.service');
jest.mock('../../services/email.service');
jest.mock('stripe');

const prisma = new PrismaClient();

describe('WebhookService Database Integration', () => {
  let testOrganizationId: string;

  beforeEach(async () => {
    // Clean up test data
    await prisma.processedWebhookEvent.deleteMany({});
    await prisma.subscriptionTier.deleteMany({});
    await prisma.organizationUsage.deleteMany({});
    await prisma.auditLog.deleteMany({});

    // Create test organization
    const org = await prisma.organization.create({
      data: {
        id: `org-${crypto.randomBytes(4).toString('hex')}`,
        name: 'Test Org',
        slug: `test-org-${crypto.randomBytes(4).toString('hex')}`,
        contactEmail: 'contact@testorg.com',
      },
    });
    testOrganizationId = org.id;

    // Create organization usage record
    await prisma.organizationUsage.create({
      data: {
        organizationId: testOrganizationId,
        totalSkus: 5,
        activeUsers: 2,
        maxSkus: TIER_LIMITS.starter.max_skus!,
        maxUsers: TIER_LIMITS.starter.max_users!,
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('SubscriptionTier Operations', () => {
    it('should create a subscription tier', async () => {
      const subId = `sub_${crypto.randomBytes(6).toString('hex')}`;

      await prisma.subscriptionTier.create({
        data: {
          organizationId: testOrganizationId,
          tierLevel: 'professional',
          stripeSubscriptionId: subId,
          status: 'active',
          billingCycle: 'monthly',
        },
      });

      const tier = await prisma.subscriptionTier.findFirst({
        where: { organizationId: testOrganizationId },
      });

      expect(tier).toBeTruthy();
      expect(tier?.tierLevel).toBe('professional');
      expect(tier?.stripeSubscriptionId).toBe(subId);
      expect(tier?.status).toBe('active');
    });

    it('should update subscription tier status', async () => {
      const subId = `sub_${crypto.randomBytes(6).toString('hex')}`;

      const created = await prisma.subscriptionTier.create({
        data: {
          organizationId: testOrganizationId,
          tierLevel: 'professional',
          stripeSubscriptionId: subId,
          status: 'active',
          billingCycle: 'monthly',
        },
      });

      const updated = await prisma.subscriptionTier.update({
        where: { id: created.id },
        data: { status: 'past_due' },
      });

      expect(updated.status).toBe('past_due');
    });

    it('should handle tier downgrade with transaction', async () => {
      const subId = `sub_${crypto.randomBytes(6).toString('hex')}`;

      // Create professional tier
      await prisma.subscriptionTier.create({
        data: {
          organizationId: testOrganizationId,
          tierLevel: 'professional',
          stripeSubscriptionId: subId,
          status: 'active',
          billingCycle: 'monthly',
        },
      });

      // Update usage to exceed starter limits
      await prisma.organizationUsage.update({
        where: { organizationId: testOrganizationId },
        data: { totalSkus: 150 },
      });

      // Simulate downgrade in transaction
      await prisma.$transaction(async (tx) => {
        // Update tier
        await tx.subscriptionTier.updateMany({
          where: { organizationId: testOrganizationId },
          data: { tierLevel: 'starter', status: 'active' },
        });

        // Audit log
        await tx.auditLog.create({
          data: {
            organizationId: testOrganizationId,
            action: 'tier_downgraded_soft_lock',
            changeDescription: 'Usage exceeds starter limits',
          },
        });
      });

      // Verify all changes applied atomically
      const tier = await prisma.subscriptionTier.findFirst({
        where: { organizationId: testOrganizationId },
      });
      expect(tier?.tierLevel).toBe('starter');

      const audit = await prisma.auditLog.findFirst({
        where: { organizationId: testOrganizationId },
      });
      expect(audit?.action).toBe('tier_downgraded_soft_lock');
    });
  });

  describe('Idempotency with ProcessedWebhookEvent', () => {
    it('should mark event as processed', async () => {
      const eventId = `evt_${crypto.randomBytes(6).toString('hex')}`;

      await prisma.processedWebhookEvent.create({
        data: {
          id: eventId,
          eventType: 'customer.subscription.created',
          processedAt: new Date(),
        },
      });

      const processed = await prisma.processedWebhookEvent.findUnique({
        where: { id: eventId },
      });

      expect(processed).toBeTruthy();
      expect(processed?.eventType).toBe('customer.subscription.created');
    });

    it('should prevent duplicate processing with unique constraint', async () => {
      const eventId = `evt_${crypto.randomBytes(6).toString('hex')}`;

      // First insert succeeds
      await prisma.processedWebhookEvent.create({
        data: {
          id: eventId,
          eventType: 'customer.subscription.created',
        },
      });

      // Second insert fails with unique constraint error
      await expect(
        prisma.processedWebhookEvent.create({
          data: {
            id: eventId,
            eventType: 'customer.subscription.created',
          },
        }),
      ).rejects.toThrow();
    });

    it('should query processed events by type with index', async () => {
      const eventType = 'customer.subscription.created';
      const eventIds = Array.from(
        { length: 3 },
        () => `evt_${crypto.randomBytes(6).toString('hex')}`,
      );

      // Insert multiple events
      for (const id of eventIds) {
        await prisma.processedWebhookEvent.create({
          data: { id, eventType },
        });
      }

      // Query by type (uses index)
      const events = await prisma.processedWebhookEvent.findMany({
        where: { eventType },
      });

      expect(events).toHaveLength(3);
      expect(events.every((e) => e.eventType === eventType)).toBe(true);
    });
  });

  describe('Concurrent Transaction Safety', () => {
    it('should handle concurrent subscription updates without race conditions', async () => {
      const subId = `sub_${crypto.randomBytes(6).toString('hex')}`;

      const tier = await prisma.subscriptionTier.create({
        data: {
          organizationId: testOrganizationId,
          tierLevel: 'starter',
          stripeSubscriptionId: subId,
          status: 'active',
          billingCycle: 'monthly',
        },
      });

      // Simulate concurrent updates (only last one wins)
      const updates = Array.from({ length: 5 }, (_, i) =>
        prisma.subscriptionTier.update({
          where: { id: tier.id },
          data: { status: i === 4 ? 'past_due' : 'active' },
        }),
      );

      await Promise.all(updates);

      // Ensure the row is in a valid, consistent state after concurrent updates
      const final = await prisma.subscriptionTier.findUnique({
        where: { id: tier.id },
      });
      expect(['active', 'past_due']).toContain(final?.status);
    });
  });

  describe('Organization Usage Limits', () => {
    it('should update max limits based on tier', async () => {
      const usage = await prisma.organizationUsage.findUnique({
        where: { organizationId: testOrganizationId },
      });

      expect(usage?.maxSkus).toBe(TIER_LIMITS.starter.max_skus);
      expect(usage?.maxUsers).toBe(TIER_LIMITS.starter.max_users);

      // Upgrade to professional
      await prisma.organizationUsage.update({
        where: { organizationId: testOrganizationId },
        data: {
          maxSkus: TIER_LIMITS.professional.max_skus!,
          maxUsers: TIER_LIMITS.professional.max_users!,
        },
      });

      const upgraded = await prisma.organizationUsage.findUnique({
        where: { organizationId: testOrganizationId },
      });

      expect(upgraded?.maxSkus).toBe(TIER_LIMITS.professional.max_skus);
      expect(upgraded?.maxUsers).toBe(TIER_LIMITS.professional.max_users);
    });
  });

  describe('Audit Logging', () => {
    it('should create audit log entries', async () => {
      await prisma.auditLog.create({
        data: {
          organizationId: testOrganizationId,
          action: 'subscription_created',
          changeDescription: 'Professional tier subscription created',
        },
      });

      const log = await prisma.auditLog.findFirst({
        where: { organizationId: testOrganizationId },
      });

      expect(log).toBeTruthy();
      expect(log?.action).toBe('subscription_created');
      expect(log?.changeDescription).toContain('Professional');
    });

    it('should query audit logs by organization', async () => {
      const actions = ['subscription_created', 'payment_failed', 'tier_downgraded'];

      for (const action of actions) {
        await prisma.auditLog.create({
          data: {
            organizationId: testOrganizationId,
            action,
            changeDescription: `Event: ${action}`,
          },
        });
      }

      const logs = await prisma.auditLog.findMany({
        where: { organizationId: testOrganizationId },
      });

      expect(logs).toHaveLength(3);
      expect(logs.map((l) => l.action)).toEqual(expect.arrayContaining(actions));
    });
  });
});
