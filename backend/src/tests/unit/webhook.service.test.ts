import Stripe from 'stripe';
import { PrismaClient } from '@prisma/client';
import { WebhookService } from '../../services/webhook.service';
import { EmailService } from '../../services/email.service';
import { SubscriptionStatus } from '../../types/subscription';
import { NotFoundError } from '../../errors';

jest.mock('@sendgrid/mail', () => ({
  setApiKey: jest.fn(),
  send: jest.fn(),
}));

jest.mock('../../database/database-factory');

type MockPrisma = Partial<PrismaClient> & {
  processedWebhookEvent: {
    findUnique: jest.Mock;
    create: jest.Mock;
  };
  organization: {
    findUnique: jest.Mock;
  };
  subscriptionTier: {
    create: jest.Mock;
    updateMany: jest.Mock;
    findFirst: jest.Mock;
  };
  organizationUsage: {
    upsert: jest.Mock;
    update: jest.Mock;
    findUnique: jest.Mock;
  };
  auditLog: {
    create: jest.Mock;
  };
  $transaction: jest.Mock;
};

describe('WebhookService', () => {
  let prisma: MockPrisma;
  let emailService: jest.Mocked<EmailService>;
  let service: WebhookService;
  let mockStripe: jest.Mocked<Stripe>;

  const organizationId = 'org-123';
  const customerId = 'cus_test123';

  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_123';

    prisma = {
      processedWebhookEvent: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      organization: {
        findUnique: jest.fn(),
      },
      subscriptionTier: {
        create: jest.fn(),
        updateMany: jest.fn(),
        findFirst: jest.fn(),
      },
      organizationUsage: {
        upsert: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
      },
      auditLog: {
        create: jest.fn(),
      },
      $transaction: jest.fn((callback) => callback(prisma)),
    };

    emailService = {
      sendTrialReminderEmail: jest.fn(),
      sendDunningEmail: jest.fn(),
      sendDowngradeWarningEmail: jest.fn(),
    } as unknown as jest.Mocked<EmailService>;

    service = new WebhookService(prisma as PrismaClient, undefined, emailService);

    mockStripe = {
      customers: {
        retrieve: jest.fn(),
      },
    } as unknown as jest.Mocked<Stripe>;

    (service as unknown as { stripe: Stripe }).stripe = mockStripe;

    (mockStripe.customers.retrieve as jest.Mock).mockResolvedValue({
      id: customerId,
      deleted: false,
      metadata: { organizationId },
    });

    prisma.organization.findUnique.mockResolvedValue({
      id: organizationId,
      name: 'Test Org',
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('idempotency helpers', () => {
    it('returns true when event has not been processed', async () => {
      prisma.processedWebhookEvent.findUnique.mockResolvedValue(null);

      const result = await service.isNewEvent('evt_new');

      expect(result).toBe(true);
      expect(prisma.processedWebhookEvent.findUnique).toHaveBeenCalledWith({
        where: { id: 'evt_new' },
      });
    });

    it('returns false when event has already been processed', async () => {
      prisma.processedWebhookEvent.findUnique.mockResolvedValue({ id: 'evt_existing' });

      const result = await service.isNewEvent('evt_existing');

      expect(result).toBe(false);
    });

    it('swallows unique constraint errors when marking processed', async () => {
      const error = { code: 'P2002' };
      prisma.processedWebhookEvent.create.mockRejectedValue(error);

      await expect(service.markEventProcessed('evt_dup', 'invoice.payment_failed')).resolves.toBe(
        undefined,
      );
    });
  });

  describe('handler behaviors', () => {
    it('handles subscription created', async () => {
      prisma.subscriptionTier.create.mockResolvedValue({ id: 1 });
      prisma.organizationUsage.upsert.mockResolvedValue({ id: 1 });
      prisma.auditLog.create.mockResolvedValue({ id: 1 });

      const subscription = {
        id: 'sub_created',
        customer: customerId,
        status: 'active',
        items: {
          data: [
            {
              price: {
                recurring: { interval: 'month' },
                metadata: { tier: 'starter' },
              },
            },
          ],
        },
        trial_end: null,
      } as unknown as Stripe.Subscription;

      await (service as any).handleSubscriptionCreated(subscription);

      expect(prisma.subscriptionTier.create).toHaveBeenCalled();
      expect(prisma.organizationUsage.upsert).toHaveBeenCalled();
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId,
          action: 'subscription_created',
        }),
      });
    });

    it('handles subscription updated and sends downgrade warning', async () => {
      prisma.subscriptionTier.findFirst.mockResolvedValue({
        tierLevel: 'professional',
      });
      prisma.organizationUsage.findUnique.mockResolvedValue({
        totalSkus: 9999,
      });

      const subscription = {
        id: 'sub_updated',
        customer: customerId,
        status: 'active',
        items: {
          data: [
            {
              price: {
                metadata: { tier: 'starter' },
              },
            },
          ],
        },
        trial_end: null,
        current_period_end: Math.floor(Date.now() / 1000) + 1000,
      } as unknown as Stripe.Subscription;

      await (service as any).handleSubscriptionUpdated(subscription);

      expect(prisma.subscriptionTier.updateMany).toHaveBeenCalled();
      expect(prisma.organizationUsage.update).toHaveBeenCalled();
      expect(emailService.sendDowngradeWarningEmail).toHaveBeenCalled();
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId,
          action: 'subscription_updated',
        }),
      });
    });

    it('handles subscription deleted and applies downgrade warning when over limit', async () => {
      prisma.organizationUsage.findUnique.mockResolvedValue({
        totalSkus: 9999,
      });

      const subscription = {
        id: 'sub_deleted',
        customer: customerId,
      } as unknown as Stripe.Subscription;

      await (service as any).handleSubscriptionDeleted(subscription);

      expect(prisma.subscriptionTier.updateMany).toHaveBeenCalledWith({
        where: { organizationId },
        data: expect.objectContaining({
          status: SubscriptionStatus.CANCELED,
          tierLevel: 'starter',
        }),
      });
      expect(emailService.sendDowngradeWarningEmail).toHaveBeenCalled();
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId,
          action: 'subscription_canceled',
        }),
      });
    });

    it('handles checkout session completed', async () => {
      const session = {
        id: 'cs_test_123',
        customer: customerId,
        subscription: 'sub_test_123',
      } as unknown as Stripe.Checkout.Session;

      await (service as any).handleCheckoutSessionCompleted(session);

      expect(prisma.subscriptionTier.updateMany).toHaveBeenCalledWith({
        where: {
          organizationId,
          stripeSubscriptionId: 'sub_test_123',
        },
        data: expect.objectContaining({
          trialEndDate: null,
          status: SubscriptionStatus.ACTIVE,
        }),
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId,
          action: 'trial_converted',
        }),
      });
    });

    it('handles invoice payment failed', async () => {
      const invoice = {
        id: 'in_test_123',
        customer: customerId,
        amount_due: 5000,
        hosted_invoice_url: 'https://invoice.test',
      } as unknown as Stripe.Invoice;

      await (service as any).handleInvoicePaymentFailed(invoice);

      expect(prisma.subscriptionTier.updateMany).toHaveBeenCalledWith({
        where: { organizationId },
        data: { status: SubscriptionStatus.PAST_DUE },
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId,
          action: 'payment_failed',
        }),
      });
      expect(emailService.sendDunningEmail).toHaveBeenCalledWith(
        organizationId,
        invoice.hosted_invoice_url,
      );
    });

    it('handles trial will end', async () => {
      const trialEndSeconds = Math.floor(Date.now() / 1000) + 3 * 24 * 60 * 60;
      const subscription = {
        id: 'sub_trial',
        customer: customerId,
        trial_end: trialEndSeconds,
      } as unknown as Stripe.Subscription;

      await (service as any).handleTrialWillEnd(subscription);

      expect(emailService.sendTrialReminderEmail).toHaveBeenCalledWith(
        organizationId,
        expect.any(Number),
      );
    });

    it('records webhook metrics on successful subscription created', async () => {
      const monitor = require('../../services/application.monitoring.service').ApplicationMonitoringService.getInstance();
      // reset webhook metrics
      (monitor as any).metrics.webhook = { total: 0, byEvent: {}, idempotencySkips: 0 };

      prisma.subscriptionTier.create.mockResolvedValue({ id: 1 });
      prisma.organizationUsage.upsert.mockResolvedValue({ id: 1 });
      prisma.auditLog.create.mockResolvedValue({ id: 1 });

      const subscription = {
        id: 'sub_created_metrics',
        customer: customerId,
        status: 'active',
        items: {
          data: [
            {
              price: {
                recurring: { interval: 'month' },
                metadata: { tier: 'starter' },
              },
            },
          ],
        },
        trial_end: null,
      } as unknown as Stripe.Subscription;

      await (service as any).handleSubscriptionCreated(subscription);

      const wm = monitor.getWebhookMetrics();
      expect(wm.total).toBeGreaterThanOrEqual(1);
      expect(wm.byEvent['customer.subscription.created'].count).toBe(1);
      expect(wm.byEvent['customer.subscription.created'].avgLatencyMs).toBeGreaterThan(0);
    });

    it('captures Sentry and records metric when handler errors', async () => {
      const monitor = require('../../services/application.monitoring.service').ApplicationMonitoringService.getInstance();
      (monitor as any).metrics.webhook = { total: 0, byEvent: {}, idempotencySkips: 0 };

      prisma.subscriptionTier.create.mockResolvedValue({ id: 1 });
      prisma.organizationUsage.upsert.mockResolvedValue({ id: 1 });
      // Make auditLog.create throw to simulate DB error
      prisma.auditLog.create.mockRejectedValue(new Error('audit failed'));

      const Sentry = require('@sentry/node');
      jest.spyOn(Sentry, 'captureException').mockImplementation(() => undefined);

      const subscription = {
        id: 'sub_created_error',
        customer: customerId,
        status: 'active',
        items: {
          data: [
            {
              price: {
                recurring: { interval: 'month' },
                metadata: { tier: 'starter' },
              },
            },
          ],
        },
        trial_end: null,
      } as unknown as Stripe.Subscription;

      await expect((service as any).handleSubscriptionCreated(subscription)).rejects.toThrow();

      expect(Sentry.captureException).toHaveBeenCalled();
      const wm = monitor.getWebhookMetrics();
      expect(wm.byEvent['customer.subscription.created'].failures).toBe(1);
    });
  });

  describe('metadata validation', () => {
    it('throws error when metadata is missing', async () => {
      (mockStripe.customers.retrieve as jest.Mock).mockResolvedValue({
        id: customerId,
        deleted: false,
        metadata: {},
      });

      const subscription = {
        id: 'sub_missing_meta',
        customer: customerId,
        status: 'active',
        items: { data: [] },
      } as unknown as Stripe.Subscription;

      await expect((service as any).handleSubscriptionCreated(subscription)).rejects.toThrow(
        'Missing organizationId in Stripe customer metadata',
      );
    });

    it('throws NotFoundError when organization is missing', async () => {
      prisma.organization.findUnique.mockResolvedValue(null);

      const subscription = {
        id: 'sub_missing_org',
        customer: customerId,
        status: 'active',
        items: { data: [] },
      } as unknown as Stripe.Subscription;

      await expect((service as any).handleSubscriptionCreated(subscription)).rejects.toThrow(
        NotFoundError,
      );
    });
  });
});
