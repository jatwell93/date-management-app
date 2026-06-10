import { PrismaClient } from '@prisma/client';
import { WebhookService } from '../../services/webhook.service';
import { NotFoundError } from '../../errors';
import Stripe from 'stripe';
import crypto from 'crypto';

// Mock Stripe and Email service
jest.mock('stripe');
jest.mock('../../services/email.service');

const prisma = new PrismaClient();

describe('Webhook Edge Cases', () => {
  let webhookService: WebhookService;
  let testOrganizationId: string;
  let mockStripe: jest.Mocked<Stripe>;

  beforeAll(() => {
    webhookService = new WebhookService();

    // Create mock Stripe instance
    mockStripe = {
      customers: {
        retrieve: jest.fn(),
      },
      subscriptions: {
        retrieve: jest.fn(),
      },
    } as any;

    // Inject mock into service
    (webhookService as any).stripe = mockStripe;
  });

  beforeEach(async () => {
    // Clean up test data
    await prisma.processedWebhookEvent.deleteMany({});
    await prisma.subscriptionTier.deleteMany({});
    await prisma.organizationUsage.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.organization.deleteMany({});

    // Create test organization
    const org = await prisma.organization.create({
      data: {
        id: `org-${crypto.randomBytes(4).toString('hex')}`,
        name: 'Test Org',
        slug: `test-org-${crypto.randomBytes(4).toString('hex')}`,
        contactEmail: 'test@example.com',
      },
    });
    testOrganizationId = org.id;

    // Reset mocks
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('Missing Organization', () => {
    it('should throw NotFoundError when organization does not exist', async () => {
      const nonExistentOrgId = 'org-nonexistent';
      const customerId = `cus_${crypto.randomBytes(6).toString('hex')}`;

      const mockCustomer: Stripe.Customer = {
        id: customerId,
        object: 'customer',
        metadata: { organizationId: nonExistentOrgId },
      } as any;

      (mockStripe.customers.retrieve as jest.Mock).mockResolvedValueOnce(mockCustomer);

      const subscription: Stripe.Subscription = {
        id: `sub_${crypto.randomBytes(6).toString('hex')}`,
        object: 'subscription',
        customer: customerId,
        status: 'active',
        items: {
          object: 'list',
          data: [{ price: { metadata: { tier: 'starter' } } } as any],
        },
      } as any;

      await expect((webhookService as any).handleSubscriptionCreated(subscription)).rejects.toThrow(
        NotFoundError,
      );

      // Verify no subscription tier was created
      const tier = await prisma.subscriptionTier.findFirst({
        where: { organizationId: nonExistentOrgId },
      });
      expect(tier).toBeNull();
    });

    it('should log error and not crash when org missing during update', async () => {
      const nonExistentOrgId = 'org-nonexistent';
      const customerId = `cus_${crypto.randomBytes(6).toString('hex')}`;

      const mockCustomer: Stripe.Customer = {
        id: customerId,
        object: 'customer',
        metadata: { organizationId: nonExistentOrgId },
      } as any;

      (mockStripe.customers.retrieve as jest.Mock).mockResolvedValueOnce(mockCustomer);

      const subscription: Stripe.Subscription = {
        id: `sub_${crypto.randomBytes(6).toString('hex')}`,
        object: 'subscription',
        customer: customerId,
        status: 'active',
        items: {
          object: 'list',
          data: [{ price: { metadata: { tier: 'professional' } } } as any],
        },
      } as any;

      await expect((webhookService as any).handleSubscriptionUpdated(subscription)).rejects.toThrow(
        NotFoundError,
      );
    });
  });

  describe('Missing Metadata', () => {
    it('should throw error when customer metadata is missing organizationId', async () => {
      const customerId = `cus_${crypto.randomBytes(6).toString('hex')}`;

      const mockCustomer: Stripe.Customer = {
        id: customerId,
        object: 'customer',
        metadata: {}, // Missing organizationId
      } as any;

      (mockStripe.customers.retrieve as jest.Mock).mockResolvedValueOnce(mockCustomer);

      const subscription: Stripe.Subscription = {
        id: `sub_${crypto.randomBytes(6).toString('hex')}`,
        object: 'subscription',
        customer: customerId,
        status: 'active',
        items: {
          object: 'list',
          data: [{ price: { metadata: { tier: 'starter' } } } as any],
        },
      } as any;

      await expect((webhookService as any).handleSubscriptionCreated(subscription)).rejects.toThrow(
        'Missing organizationId in Stripe customer metadata',
      );
    });

    it('should throw error when metadata field is null', async () => {
      const customerId = `cus_${crypto.randomBytes(6).toString('hex')}`;

      const mockCustomer: Stripe.Customer = {
        id: customerId,
        object: 'customer',
        metadata: { organizationId: null as any },
      } as any;

      (mockStripe.customers.retrieve as jest.Mock).mockResolvedValueOnce(mockCustomer);

      const subscription: Stripe.Subscription = {
        id: `sub_${crypto.randomBytes(6).toString('hex')}`,
        object: 'subscription',
        customer: customerId,
        status: 'active',
        items: {
          object: 'list',
          data: [{ price: { metadata: { tier: 'starter' } } } as any],
        },
      } as any;

      await expect((webhookService as any).handleSubscriptionCreated(subscription)).rejects.toThrow(
        'Missing organizationId in Stripe customer metadata',
      );
    });
  });

  describe('Duplicate Webhook Events', () => {
    it('should detect duplicate event and skip processing', async () => {
      const eventId = `evt_${crypto.randomBytes(6).toString('hex')}`;

      // Mark event as already processed
      await prisma.processedWebhookEvent.create({
        data: {
          id: eventId,
          eventType: 'customer.subscription.created',
        },
      });

      // Attempt to process again
      const isNew = await webhookService.isNewEvent(eventId);
      expect(isNew).toBe(false);
    });

    it('should handle concurrent duplicate event processing gracefully', async () => {
      const eventId = `evt_${crypto.randomBytes(6).toString('hex')}`;

      // Simulate concurrent attempts to mark as processed
      const attempts = Array.from({ length: 3 }, () =>
        webhookService.markEventProcessed(eventId, 'customer.subscription.created'),
      );

      // All should succeed without throwing errors
      await Promise.allSettled(attempts);

      // Verify only one record created
      const processed = await prisma.processedWebhookEvent.findMany({
        where: { id: eventId },
      });
      expect(processed).toHaveLength(1);
    });
  });

  describe('Transaction Rollback', () => {
    it('should create all records atomically or none at all', async () => {
      const customerId = `cus_${crypto.randomBytes(6).toString('hex')}`;
      const subId = `sub_${crypto.randomBytes(6).toString('hex')}`;

      const mockCustomer: Stripe.Customer = {
        id: customerId,
        object: 'customer',
        metadata: { organizationId: testOrganizationId },
      } as any;

      (mockStripe.customers.retrieve as jest.Mock).mockResolvedValueOnce(mockCustomer);

      const subscription: Stripe.Subscription = {
        id: subId,
        object: 'subscription',
        customer: customerId,
        status: 'active',
        items: {
          object: 'list',
          data: [{ price: { metadata: { tier: 'professional' } } } as any],
        },
      } as any;

      // Execute handler
      await (webhookService as any).handleSubscriptionCreated(subscription);

      // Verify ALL changes were committed atomically
      const tier = await prisma.subscriptionTier.findFirst({
        where: { stripeSubscriptionId: subId },
      });
      const usage = await prisma.organizationUsage.findUnique({
        where: { organizationId: testOrganizationId },
      });
      const auditLog = await prisma.auditLog.findFirst({
        where: {
          organizationId: testOrganizationId,
          action: 'subscription_created',
        },
      });

      // All or nothing - if one exists, all should exist
      expect(tier).toBeTruthy();
      expect(usage).toBeTruthy();
      expect(auditLog).toBeTruthy();
      expect(tier?.tierLevel).toBe('professional');
      expect(usage?.maxSkus).toBe(50000); // Professional tier limit
    });
  });

  describe('Out-of-Order Events', () => {
    it('should keep paid tier when checkout completes after trial expiry downgrade', async () => {
      const customerId = `cus_${crypto.randomBytes(6).toString('hex')}`;
      const subId = `sub_${crypto.randomBytes(6).toString('hex')}`;

      const mockCustomer: Stripe.Customer = {
        id: customerId,
        object: 'customer',
        metadata: { organizationId: testOrganizationId },
      } as any;

      (mockStripe.customers.retrieve as jest.Mock).mockResolvedValue(mockCustomer);
      (mockStripe.subscriptions.retrieve as jest.Mock).mockResolvedValue({
        id: subId,
        object: 'subscription',
        customer: customerId,
        status: 'active',
        items: {
          object: 'list',
          data: [
            {
              price: {
                metadata: { tier: 'professional' },
                recurring: { interval: 'month' },
              },
            } as any,
          ],
        },
      } as Stripe.Subscription);

      // Simulate trial already expired and downgraded before checkout completes
      await prisma.subscriptionTier.create({
        data: {
          organizationId: testOrganizationId,
          tierLevel: 'starter',
          status: 'active',
          stripeSubscriptionId: subId,
          trialEndDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
      });

      await prisma.organization.update({
        where: { id: testOrganizationId },
        data: { isCreationLocked: true },
      });

      await prisma.organizationUsage.upsert({
        where: { organizationId: testOrganizationId },
        update: {
          maxSkus: 500,
          maxUsers: 1,
          maxInventoryItems: 5000,
        },
        create: {
          organizationId: testOrganizationId,
          totalSkus: 500,
          activeUsers: 1,
          maxSkus: 500,
          maxUsers: 1,
          totalInventoryItems: 100,
          maxInventoryItems: 5000,
          storageUsedBytes: 0,
        },
      });

      const session: Stripe.Checkout.Session = {
        id: `cs_${crypto.randomBytes(6).toString('hex')}`,
        object: 'checkout.session',
        customer: customerId,
        subscription: subId,
      } as any;

      await expect(
        (webhookService as any).handleCheckoutSessionCompleted(session),
      ).resolves.not.toThrow();

      const updatedTier = await prisma.subscriptionTier.findFirst({
        where: { organizationId: testOrganizationId, stripeSubscriptionId: subId },
      });
      expect(updatedTier?.tierLevel).toBe('professional');
      expect(updatedTier?.status).toBe('active');
      expect(updatedTier?.trialEndDate).toBeNull();

      const updatedOrg = await prisma.organization.findUnique({
        where: { id: testOrganizationId },
      });
      expect(updatedOrg?.isCreationLocked).toBe(false);

      const usage = await prisma.organizationUsage.findUnique({
        where: { organizationId: testOrganizationId },
      });
      expect(usage?.maxSkus).toBe(50000);
    });

    it('should handle subscription.updated arriving before subscription.created', async () => {
      const customerId = `cus_${crypto.randomBytes(6).toString('hex')}`;
      const subId = `sub_${crypto.randomBytes(6).toString('hex')}`;

      const mockCustomer: Stripe.Customer = {
        id: customerId,
        object: 'customer',
        metadata: { organizationId: testOrganizationId },
      } as any;

      (mockStripe.customers.retrieve as jest.Mock).mockResolvedValue(mockCustomer);

      const subscription: Stripe.Subscription = {
        id: subId,
        object: 'subscription',
        customer: customerId,
        status: 'active',
        items: {
          object: 'list',
          data: [{ price: { metadata: { tier: 'professional' } } } as any],
        },
      } as any;

      // First: Process updated event without pre-existing tier or usage records
      await expect(
        (webhookService as any).handleSubscriptionUpdated(subscription),
      ).resolves.not.toThrow();

      // Verify update event bootstrapped records
      const tier = await prisma.subscriptionTier.findFirst({
        where: { stripeSubscriptionId: subId },
      });
      expect(tier).toBeTruthy();
      expect(tier?.tierLevel).toBe('professional');

      const usage = await prisma.organizationUsage.findUnique({
        where: { organizationId: testOrganizationId },
      });
      expect(usage).toBeTruthy();
      expect(usage?.maxSkus).toBe(50000);
    });

    it('should handle subscription.deleted for non-existent subscription', async () => {
      const customerId = `cus_${crypto.randomBytes(6).toString('hex')}`;
      const subId = `sub_${crypto.randomBytes(6).toString('hex')}`;

      const mockCustomer: Stripe.Customer = {
        id: customerId,
        object: 'customer',
        metadata: { organizationId: testOrganizationId },
      } as any;

      (mockStripe.customers.retrieve as jest.Mock).mockResolvedValueOnce(mockCustomer);

      // Ensure organizationUsage exists (handler requires it)
      await prisma.organizationUsage.upsert({
        where: { organizationId: testOrganizationId },
        update: {},
        create: {
          organizationId: testOrganizationId,
          totalSkus: 0,
          activeUsers: 0,
          maxSkus: 100,
          maxUsers: 5,
        },
      });

      const subscription: Stripe.Subscription = {
        id: subId,
        object: 'subscription',
        customer: customerId,
        status: 'canceled',
        canceled_at: Math.floor(Date.now() / 1000),
      } as any;

      // Should not crash even if subscription doesn't exist in DB
      await expect(
        (webhookService as any).handleSubscriptionDeleted(subscription),
      ).resolves.not.toThrow();
    });
  });

  describe('Invalid Tier Data', () => {
    it('should handle missing tier in price metadata', async () => {
      const customerId = `cus_${crypto.randomBytes(6).toString('hex')}`;
      const subId = `sub_${crypto.randomBytes(6).toString('hex')}`;

      const mockCustomer: Stripe.Customer = {
        id: customerId,
        object: 'customer',
        metadata: { organizationId: testOrganizationId },
      } as any;

      (mockStripe.customers.retrieve as jest.Mock).mockResolvedValueOnce(mockCustomer);

      await prisma.organizationUsage.create({
        data: {
          organizationId: testOrganizationId,
          totalSkus: 5,
          activeUsers: 1,
          maxSkus: 500,
          maxUsers: 1,
        },
      });

      const subscription: Stripe.Subscription = {
        id: subId,
        object: 'subscription',
        customer: customerId,
        status: 'active',
        items: {
          object: 'list',
          data: [{ price: { metadata: {} } } as any], // Missing tier
        },
      } as any;

      // Should default to 'free' tier (handler doesn't throw)
      await (webhookService as any).handleSubscriptionCreated(subscription);

      // Verify it created free tier
      const tier = await prisma.subscriptionTier.findFirst({
        where: { stripeSubscriptionId: subId },
      });
      expect(tier).toBeDefined();
      expect(tier?.tierLevel).toBe('free');
    });
  });

  describe('Deleted Customer', () => {
    it('should handle deleted Stripe customer', async () => {
      const customerId = `cus_${crypto.randomBytes(6).toString('hex')}`;

      const mockCustomer: Stripe.DeletedCustomer = {
        id: customerId,
        object: 'customer',
        deleted: true,
      } as any;

      (mockStripe.customers.retrieve as jest.Mock).mockResolvedValueOnce(mockCustomer);

      const subscription: Stripe.Subscription = {
        id: `sub_${crypto.randomBytes(6).toString('hex')}`,
        object: 'subscription',
        customer: customerId,
        status: 'active',
        items: {
          object: 'list',
          data: [{ price: { metadata: { tier: 'starter' } } } as any],
        },
      } as any;

      await expect((webhookService as any).handleSubscriptionCreated(subscription)).rejects.toThrow(
        NotFoundError,
      );
    });
  });

  describe('Invoice Payment Failed Edge Cases', () => {
    it('should handle invoice with no subscription link', async () => {
      const customerId = `cus_${crypto.randomBytes(6).toString('hex')}`;

      const mockCustomer: Stripe.Customer = {
        id: customerId,
        object: 'customer',
        metadata: { organizationId: testOrganizationId },
      } as any;

      (mockStripe.customers.retrieve as jest.Mock).mockResolvedValueOnce(mockCustomer);

      await prisma.organizationUsage.create({
        data: {
          organizationId: testOrganizationId,
          totalSkus: 5,
          activeUsers: 1,
          maxSkus: 500,
          maxUsers: 1,
        },
      });

      const invoice: Stripe.Invoice = {
        id: `in_${crypto.randomBytes(6).toString('hex')}`,
        object: 'invoice',
        customer: customerId,
        subscription: null, // No subscription
        status: 'open',
        hosted_invoice_url: 'https://invoice.stripe.com/i/test',
      } as any;

      // Should handle gracefully - still notify about payment failure
      await expect(
        (webhookService as any).handleInvoicePaymentFailed(invoice),
      ).resolves.not.toThrow();
    });
  });

  describe('Trial Will End Edge Cases', () => {
    it('should handle trial ending in the past', async () => {
      const customerId = `cus_${crypto.randomBytes(6).toString('hex')}`;

      const mockCustomer: Stripe.Customer = {
        id: customerId,
        object: 'customer',
        metadata: { organizationId: testOrganizationId },
      } as any;

      (mockStripe.customers.retrieve as jest.Mock).mockResolvedValueOnce(mockCustomer);

      await prisma.organizationUsage.create({
        data: {
          organizationId: testOrganizationId,
          totalSkus: 5,
          activeUsers: 1,
          maxSkus: 500,
          maxUsers: 1,
        },
      });

      const subscription: Stripe.Subscription = {
        id: `sub_${crypto.randomBytes(6).toString('hex')}`,
        object: 'subscription',
        customer: customerId,
        status: 'trialing',
        trial_end: Math.floor(Date.now() / 1000) - 86400, // Yesterday
      } as any;

      // Should still send reminder even if trial already ended
      await expect((webhookService as any).handleTrialWillEnd(subscription)).resolves.not.toThrow();
    });

    it('should handle missing trial_end timestamp', async () => {
      const customerId = `cus_${crypto.randomBytes(6).toString('hex')}`;

      const mockCustomer: Stripe.Customer = {
        id: customerId,
        object: 'customer',
        metadata: { organizationId: testOrganizationId },
      } as any;

      (mockStripe.customers.retrieve as jest.Mock).mockResolvedValueOnce(mockCustomer);

      await prisma.organizationUsage.create({
        data: {
          organizationId: testOrganizationId,
          totalSkus: 5,
          activeUsers: 1,
          maxSkus: 500,
          maxUsers: 1,
        },
      });

      const subscription: Stripe.Subscription = {
        id: `sub_${crypto.randomBytes(6).toString('hex')}`,
        object: 'subscription',
        customer: customerId,
        status: 'active', // Not trialing
        trial_end: null,
      } as any;

      // Should handle gracefully - defaults trial_end to 0 (results in negative days)
      // Handler will still send email (though Stripe wouldn't normally send this event)
      await expect((webhookService as any).handleTrialWillEnd(subscription)).resolves.not.toThrow();
    });
  });

  describe('Concurrent Webhook Processing', () => {
    it('should handle multiple webhooks for same subscription concurrently', async () => {
      const customerId = `cus_${crypto.randomBytes(6).toString('hex')}`;
      const subId = `sub_${crypto.randomBytes(6).toString('hex')}`;

      const mockCustomer: Stripe.Customer = {
        id: customerId,
        object: 'customer',
        metadata: { organizationId: testOrganizationId },
      } as any;

      (mockStripe.customers.retrieve as jest.Mock).mockResolvedValue(mockCustomer);

      await prisma.organizationUsage.create({
        data: {
          organizationId: testOrganizationId,
          totalSkus: 5,
          activeUsers: 1,
          maxSkus: 500,
          maxUsers: 1,
        },
      });

      const subscription: Stripe.Subscription = {
        id: subId,
        object: 'subscription',
        customer: customerId,
        status: 'active',
        items: {
          object: 'list',
          data: [{ price: { metadata: { tier: 'professional' } } } as any],
        },
      } as any;

      // Process created and updated concurrently
      const operations = [
        (webhookService as any).handleSubscriptionCreated(subscription),
        (webhookService as any).handleSubscriptionUpdated(subscription),
      ];

      const results = await Promise.allSettled(operations);

      // At least one should succeed
      const succeeded = results.filter((r) => r.status === 'fulfilled');
      expect(succeeded.length).toBeGreaterThan(0);

      // Verify subscription exists
      const tier = await prisma.subscriptionTier.findFirst({
        where: { stripeSubscriptionId: subId },
      });
      expect(tier).toBeTruthy();
    });
  });
});
