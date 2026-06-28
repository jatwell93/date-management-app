import Stripe from 'stripe';
import { PrismaClient } from '@prisma/client';
import { WebhookService } from '../../services/webhook.service';
import { EmailService } from '../../services/email.service';
import { SubscriptionStatus } from '../../types/subscription';
import { NotFoundError } from '../../errors';

// Auto-mock Sentry so its exports are Vitest-controlled vi.fns shared with the
// SUT (spying on a real `await import('@sentry/node')` namespace fails — ESM
// namespaces are non-configurable).
vi.mock('@sentry/node');

vi.mock('@sendgrid/mail', () => ({
  setApiKey: vi.fn(),
  send: vi.fn(),
}));

vi.mock('../../database/database-factory');

type MockPrisma = {
  [key: string]: any;
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
        findUnique: vi.fn(),
        create: vi.fn(),
      },
      organization: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      subscriptionTier: {
        create: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
        findFirst: vi.fn(),
      },
      organizationUsage: {
        upsert: vi.fn(),
        update: vi.fn(),
        findUnique: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
      trialEvent: {
        create: vi.fn(),
      },
      $transaction: vi.fn((callback) => callback(prisma)),
    };

    emailService = {
      sendTrialReminderEmail: vi.fn(),
      sendDunningEmail: vi.fn(),
      sendDowngradeWarningEmail: vi.fn(),
      sendPaymentFailedEmail: vi.fn(),
    } as unknown as jest.Mocked<EmailService>;

    service = new WebhookService(prisma as unknown as PrismaClient, undefined, emailService);

    mockStripe = {
      customers: {
        retrieve: vi.fn(),
      },
      subscriptions: {
        retrieve: vi.fn(),
      },
    } as unknown as jest.Mocked<Stripe>;

    (service as unknown as { stripe: Stripe }).stripe = mockStripe;

    (mockStripe.customers.retrieve as jest.Mock).mockResolvedValue({
      id: customerId,
      deleted: false,
      metadata: { organizationId },
    });

    (mockStripe.subscriptions.retrieve as jest.Mock).mockResolvedValue({
      id: 'sub_test_123',
      status: 'active',
      items: {
        data: [
          {
            price: {
              metadata: { tier: 'professional' },
              recurring: { interval: 'month' },
            },
          },
        ],
      },
    });

    prisma.organization.findUnique.mockResolvedValue({
      id: organizationId,
      name: 'Test Org',
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
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

    it('rethrows non-unique errors when marking processed', async () => {
      const dbError = new Error('database down');
      prisma.processedWebhookEvent.create.mockRejectedValue(dbError);

      await expect(
        service.markEventProcessed('evt_fail', 'invoice.payment_failed'),
      ).rejects.toThrow('database down');
    });
  });

  describe('handler behaviors', () => {
    it('ignores unhandled event types without throwing', async () => {
      const reportSpy = vi.spyOn(service as any, 'reportWebhookError');
      const event = {
        id: 'evt_unhandled',
        type: 'customer.created',
        data: { object: {} },
      } as unknown as Stripe.Event;

      await expect(service.handleEvent(event)).resolves.toBeUndefined();
      expect(reportSpy).not.toHaveBeenCalled();
    });

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
        id: 1,
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

      expect(prisma.subscriptionTier.update).toHaveBeenCalled();
      expect(prisma.organizationUsage.upsert).toHaveBeenCalled();
      expect(emailService.sendDowngradeWarningEmail).toHaveBeenCalled();
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId,
          action: 'subscription_updated',
        }),
      });
    });

    it('sets isCreationLocked=true on org when downgrading over SKU limit', async () => {
      prisma.subscriptionTier.findFirst.mockResolvedValue({ id: 1, tierLevel: 'professional' });
      prisma.organizationUsage.findUnique.mockResolvedValue({ totalSkus: 9999 });
      prisma.organization.update = vi.fn().mockResolvedValue({
        id: organizationId,
        isCreationLocked: true,
      });

      const subscription = {
        id: 'sub_updated_lock',
        customer: customerId,
        status: 'active',
        items: {
          data: [{ price: { metadata: { tier: 'starter' } } }],
        },
        trial_end: null,
        current_period_end: Math.floor(Date.now() / 1000) + 1000,
      } as unknown as Stripe.Subscription;

      await (service as any).handleSubscriptionUpdated(subscription);

      expect(prisma.organization.update).toHaveBeenCalledWith({
        where: { id: organizationId },
        data: { isCreationLocked: true },
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
          tierLevel: 'free',
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

    it('sets isCreationLocked=true on org when subscription deleted and over Starter limit', async () => {
      prisma.organizationUsage.findUnique.mockResolvedValue({ totalSkus: 9999 });
      prisma.organization.update = vi.fn().mockResolvedValue({
        id: organizationId,
        isCreationLocked: true,
      });

      const subscription = {
        id: 'sub_deleted_lock',
        customer: customerId,
      } as unknown as Stripe.Subscription;

      await (service as any).handleSubscriptionDeleted(subscription);

      expect(prisma.organization.update).toHaveBeenCalledWith({
        where: { id: organizationId },
        data: { isCreationLocked: true },
      });
    });

    it('does NOT lock org when downgrade is within new SKU limit', async () => {
      prisma.subscriptionTier.findFirst.mockResolvedValue({ id: 1, tierLevel: 'professional' });
      prisma.organizationUsage.findUnique.mockResolvedValue({ totalSkus: 100 });
      prisma.organization.update = vi.fn().mockResolvedValue({ id: organizationId });

      const subscription = {
        id: 'sub_within_limit',
        customer: customerId,
        status: 'active',
        items: {
          data: [{ price: { metadata: { tier: 'starter' } } }],
        },
        trial_end: null,
        current_period_end: Math.floor(Date.now() / 1000) + 1000,
      } as unknown as Stripe.Subscription;

      await (service as any).handleSubscriptionUpdated(subscription);

      const lockCalls = (prisma.organization.update as jest.Mock).mock.calls.filter(
        (c) => c[0].data?.isCreationLocked !== undefined,
      );

      expect(lockCalls).toHaveLength(0);
    });

    it('creates subscription record when updated arrives before created', async () => {
      prisma.subscriptionTier.findFirst
        .mockResolvedValueOnce(null) // oldTier lookup
        .mockResolvedValueOnce(null); // transactional existingTier lookup
      prisma.organizationUsage.findUnique.mockResolvedValue({
        totalSkus: 0,
        totalInventoryItems: 0,
      });

      const subscription = {
        id: 'sub_out_of_order',
        customer: customerId,
        status: 'active',
        items: {
          data: [
            { price: { metadata: { tier: 'professional' }, recurring: { interval: 'month' } } },
          ],
        },
        trial_end: null,
      } as unknown as Stripe.Subscription;

      await (service as any).handleSubscriptionUpdated(subscription);

      expect(prisma.subscriptionTier.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId,
          stripeSubscriptionId: 'sub_out_of_order',
          tierLevel: 'professional',
        }),
      });
      expect(prisma.organizationUsage.upsert).toHaveBeenCalled();
    });

    it('handles checkout session completed', async () => {
      const session = {
        id: 'cs_test_123',
        customer: customerId,
        subscription: 'sub_test_123',
      } as unknown as Stripe.Checkout.Session;

      await (service as any).handleCheckoutSessionCompleted(session);

      expect(mockStripe.subscriptions.retrieve).toHaveBeenCalledWith('sub_test_123');
      expect(prisma.subscriptionTier.updateMany).toHaveBeenCalledWith({
        where: {
          organizationId,
          stripeSubscriptionId: 'sub_test_123',
        },
        data: expect.objectContaining({
          tierLevel: 'professional',
          trialEndDate: null,
          status: SubscriptionStatus.ACTIVE,
        }),
      });
      expect(prisma.organizationUsage.upsert).toHaveBeenCalled();
      expect(prisma.organization.update).toHaveBeenCalledWith({
        where: { id: organizationId },
        data: { isCreationLocked: false },
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId,
          action: 'trial_converted',
        }),
      });
    });

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
      expect(emailService.sendDunningEmail).toHaveBeenCalledWith(
        organizationId,
        invoice.hosted_invoice_url,
      );
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

    it('skips payment intent success processing when no trialing subscription exists', async () => {
      prisma.subscriptionTier.findFirst.mockResolvedValue(null);

      const paymentIntent = {
        id: 'pi_no_trial',
        customer: customerId,
        amount: 2500,
      } as unknown as Stripe.PaymentIntent;

      await (service as any).handlePaymentIntentSucceeded(paymentIntent);

      expect(prisma.subscriptionTier.update).not.toHaveBeenCalled();
      expect(prisma.trialEvent.create).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('handles payment intent failure by logging trial event and sending email', async () => {
      const paymentIntent = {
        id: 'pi_failed_123',
        customer: customerId,
        amount: 4900,
        last_payment_error: {
          message: 'Card declined',
          code: 'card_declined',
        },
      } as unknown as Stripe.PaymentIntent;

      await (service as any).handlePaymentIntentFailed(paymentIntent);

      expect(prisma.trialEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId,
          eventType: 'payment_failed',
        }),
      });
      expect((emailService as any).sendPaymentFailedEmail).toHaveBeenCalledWith({
        organizationId,
        paymentIntentId: 'pi_failed_123',
        errorMessage: 'Card declined',
      });
    });

    it('records webhook metrics on successful subscription created', async () => {
      const monitor = (
        await import('../../services/application.monitoring.service')
      ).ApplicationMonitoringService.getInstance();
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
      expect(wm.byEvent['customer.subscription.created'].avgLatencyMs).toBeGreaterThanOrEqual(0);
    });

    it('captures Sentry and records metric when handler errors', async () => {
      const monitor = (
        await import('../../services/application.monitoring.service')
      ).ApplicationMonitoringService.getInstance();
      (monitor as any).metrics.webhook = { total: 0, byEvent: {}, idempotencySkips: 0 };

      prisma.subscriptionTier.create.mockResolvedValue({ id: 1 });
      prisma.organizationUsage.upsert.mockResolvedValue({ id: 1 });
      // Make auditLog.create throw to simulate DB error
      prisma.auditLog.create.mockRejectedValue(new Error('audit failed'));

      const Sentry = await import('@sentry/node');
      vi.mocked(Sentry.captureException).mockImplementation(() => undefined);

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
    it('throws NotFoundError when customer has been deleted', async () => {
      (mockStripe.customers.retrieve as jest.Mock).mockResolvedValue({
        id: customerId,
        deleted: true,
        metadata: { organizationId },
      });

      const Sentry = await import('@sentry/node');
      const sentrySpy = vi.mocked(Sentry.captureException).mockImplementation(() => undefined);

      const subscription = {
        id: 'sub_deleted_customer',
        customer: customerId,
        status: 'active',
        items: { data: [] },
      } as unknown as Stripe.Subscription;

      await expect((service as any).handleSubscriptionCreated(subscription)).rejects.toThrow(
        NotFoundError,
      );
      expect(sentrySpy).toHaveBeenCalled();
    });

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

    it('reports critical failure when organization is missing from metadata lookup', async () => {
      prisma.organization.findUnique.mockResolvedValue(null);
      (mockStripe.customers.retrieve as jest.Mock).mockResolvedValue({
        id: customerId,
        email: 'owner@test.com',
        deleted: false,
        metadata: { organizationId },
      });

      const criticalSpy = vi
        .spyOn(service as any, 'reportCriticalWebhookFailure')
        .mockImplementation(() => undefined);

      const subscription = {
        id: 'sub_missing_org_critical',
        customer: customerId,
        status: 'active',
        items: { data: [] },
      } as unknown as Stripe.Subscription;

      await expect((service as any).handleSubscriptionCreated(subscription)).rejects.toThrow(
        NotFoundError,
      );

      expect(criticalSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Organization ${organizationId} not found`),
        expect.objectContaining({
          eventType: 'validate_metadata',
          details: expect.objectContaining({
            customerId,
            organizationId,
            customerEmail: 'owner@test.com',
          }),
        }),
      );
    });
  });
});
