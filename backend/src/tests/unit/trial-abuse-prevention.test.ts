/**
 * Unit tests for Trial Abuse Prevention (16A.C.3)
 * Tests 90-day trial abuse check in ClerkWebhookService
 */

import { PrismaClient } from '@prisma/client';
import { ClerkWebhookService } from '../../services/clerk-webhook.service';
import { SubscriptionService } from '../../services/subscription.service';
import { ConflictError } from '../../errors';

vi.mock('../../services/subscription.service');
vi.mock('@sentry/node', () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

describe('Trial Abuse Prevention', () => {
  let prisma: PrismaClient;
  let service: ClerkWebhookService;
  let mockSubscriptionService: jest.Mocked<SubscriptionService>;

  beforeAll(async () => {
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: process.env.DATABASE_URL || 'file:./test.db',
        },
      },
    });
    await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON;');
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    vi.clearAllMocks();

    mockSubscriptionService = {
      createTrialSubscription: vi.fn().mockResolvedValue(undefined),
    } as any;

    service = new ClerkWebhookService(prisma, mockSubscriptionService);

    // Clean up test data
    await prisma.trialEvent.deleteMany({});
    await prisma.organizationUsage.deleteMany({});
    await prisma.subscriptionTier.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.organization.deleteMany({});
  });

  describe('90-day trial abuse check', () => {
    it('returns ConflictError when duplicate email is created concurrently during user.created', async () => {
      const email = 'duplicate-race@example.com';

      await prisma.organization.create({
        data: {
          name: 'Existing Org',
          slug: `existing-org-${Date.now()}`,
          contactEmail: email,
        },
      });

      await prisma.user.create({
        data: {
          clerkUserId: `existing_user_${Date.now()}`,
          email,
          username: `existing_${Date.now()}`,
          role: 'Manager',
          organizationId: (
            await prisma.organization.findFirstOrThrow({ where: { contactEmail: email } })
          ).id,
        },
      });

      const event = {
        type: 'user.created',
        data: {
          id: `new_clerk_user_${Date.now()}`,
          primary_email_address_id: 'em_1',
          email_addresses: [{ id: 'em_1', email_address: email }],
          username: `new_user_${Date.now()}`,
          first_name: 'New',
          last_name: 'User',
          organization_memberships: [],
        },
      };

      const result = service.handleEvent(event);
      await expect(result).rejects.toBeInstanceOf(ConflictError);
      await expect(result).rejects.toMatchObject({ message: 'Email already registered' });
    });

    it('should block trial for email used in trial within last 90 days', async () => {
      const email = 'abuser@example.com';

      // Create first org with trialing subscription
      const org1 = await prisma.organization.create({
        data: {
          name: 'First Org',
          slug: 'first-org',
          contactEmail: email,
        },
      });

      await prisma.user.create({
        data: {
          clerkUserId: 'user_abuser_1',
          email,
          username: 'abuser1',
          role: 'Manager',
          organizationId: org1.id,
          createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
        },
      });

      await prisma.subscriptionTier.create({
        data: {
          organizationId: org1.id,
          tierLevel: 'professional',
          status: 'trialing',
          trialStartedAt: new Date(),
          trialEndDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          billingCycle: 'monthly',
        },
      });

      // Create second org for new user (different email to avoid unique constraint)
      const org2 = await prisma.organization.create({
        data: {
          name: 'Second Org',
          slug: 'second-org',
          contactEmail: 'second@example.com',
        },
      });

      // Call ensureTrialSubscription directly with the abuser email
      // This simulates what happens when a user with the same email tries to get a trial
      const ensureTrial = (service as any).ensureTrialSubscription.bind(service);
      await ensureTrial(org2.id, email);

      // Verify trial was NOT created for second org
      expect(mockSubscriptionService.createTrialSubscription).not.toHaveBeenCalled();

      // Verify Sentry was notified
      const Sentry = await import('@sentry/node');
      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        'Trial abuse attempt blocked',
        expect.objectContaining({ level: 'warning' }),
      );
    });

    it('should allow trial for email not used in last 90 days', async () => {
      const email = 'olduser@example.com';

      // Create org with old trial (more than 90 days ago)
      const org1 = await prisma.organization.create({
        data: {
          name: 'Old Org',
          slug: 'old-org',
          contactEmail: email,
        },
      });

      await prisma.user.create({
        data: {
          clerkUserId: 'user_old_1',
          email,
          username: 'olduser1',
          role: 'Manager',
          organizationId: org1.id,
          createdAt: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000), // 120 days ago
        },
      });

      await prisma.subscriptionTier.create({
        data: {
          organizationId: org1.id,
          tierLevel: 'starter',
          status: 'active', // No longer trialing
          billingCycle: 'monthly',
        },
      });

      // Create new org
      const org2 = await prisma.organization.create({
        data: {
          name: 'New Org',
          slug: 'new-org',
          contactEmail: 'new@example.com',
        },
      });

      // Call ensureTrialSubscription directly
      const ensureTrial = (service as any).ensureTrialSubscription.bind(service);
      await ensureTrial(org2.id, email);

      // Verify trial WAS created (user is allowed after 90 days)
      expect(mockSubscriptionService.createTrialSubscription).toHaveBeenCalled();
    });

    it('should allow trial for completely new email', async () => {
      const email = 'brandnew@example.com';

      // Create org
      const org = await prisma.organization.create({
        data: {
          name: 'Brand New Org',
          slug: 'brand-new-org',
          contactEmail: email,
        },
      });

      // Call ensureTrialSubscription directly
      const ensureTrial = (service as any).ensureTrialSubscription.bind(service);
      await ensureTrial(org.id, email);

      // Verify trial was created
      expect(mockSubscriptionService.createTrialSubscription).toHaveBeenCalled();
    });

    it('should allow trial for email with past trial that already expired', async () => {
      const email = 'expiredtrial@example.com';

      // Create org with expired trial (status is now 'active' with starter tier)
      const org1 = await prisma.organization.create({
        data: {
          name: 'Expired Org',
          slug: 'expired-org',
          contactEmail: email,
        },
      });

      await prisma.user.create({
        data: {
          clerkUserId: 'user_expired_1',
          email,
          username: 'expireduser',
          role: 'Manager',
          organizationId: org1.id,
          createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        },
      });

      await prisma.subscriptionTier.create({
        data: {
          organizationId: org1.id,
          tierLevel: 'starter',
          status: 'active', // Expired trial - no longer trialing
          billingCycle: 'monthly',
        },
      });

      // Create new org
      const org2 = await prisma.organization.create({
        data: {
          name: 'New Org After Expiry',
          slug: 'new-org-after-expiry',
          contactEmail: 'newafter@example.com',
        },
      });

      // Call ensureTrialSubscription directly
      const ensureTrial = (service as any).ensureTrialSubscription.bind(service);
      await ensureTrial(org2.id, email);

      // Trial should be allowed since previous trial is no longer active
      expect(mockSubscriptionService.createTrialSubscription).toHaveBeenCalled();
    });
  });
});
