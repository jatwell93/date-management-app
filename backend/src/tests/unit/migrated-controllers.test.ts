import { NextFunction, Response } from 'express';
import { ProductController } from '../../controllers/product.controller';
import { InventoryController } from '../../controllers/inventory.controller';
import { SubscriptionController } from '../../controllers/subscription.controller';
import { WebhookController } from '../../controllers/webhook.controller';
import { StoreAreaController } from '../../controllers/store-area.controller';
import { StorageQuotaController } from '../../controllers/storage-quota.controller';
import { DashboardController } from '../../controllers/dashboard.controller';
import { ExpiredItemController } from '../../controllers/expired-item.controller';
import { ReportController } from '../../controllers/report.controller';
import { HealthController } from '../../controllers/health.controller';
import { AuthRequest } from '../../middleware/auth.middleware';
import { ClerkAuthRequest } from '../../middleware/clerk-auth.middleware';
import {
  AuthenticationError,
  ConflictError,
  InternalError,
  NotFoundError,
  ValidationError,
} from '../../errors';
import { Logger } from '../../utils/logger';
import { ApplicationMonitoringService } from '../../services/application.monitoring.service';

jest.mock('@sentry/node', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));

jest.mock('../../services/webhook.service', () => ({
  WebhookService: class WebhookService {},
}));

jest.mock('../../services/clerk-webhook.service', () => ({
  ClerkWebhookService: class ClerkWebhookService {},
}));

type MockResponse = Response & {
  status: jest.MockedFunction<Response['status']>;
  json: jest.MockedFunction<Response['json']>;
};

function createResponse(): MockResponse {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res as unknown as MockResponse;
}

function createNext(): jest.MockedFunction<NextFunction> {
  return jest.fn() as jest.MockedFunction<NextFunction>;
}

describe('migrated controllers', () => {
  describe('ProductController', () => {
    const product = {
      id: 1,
      barcode: '1234567890123',
      sku: 'SKU-1',
      name: 'Milk',
      costPrice: 2.5,
      organizationId: 'org-1',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };

    it('creates a product through the organization-scoped service', async () => {
      const createProduct = jest.fn().mockResolvedValue(product);
      const serviceFactory = jest.fn().mockReturnValue({ createProduct });
      const controller = new ProductController(serviceFactory, {} as never, {} as never);
      const req = {
        organizationId: 'org-1',
        body: {
          barcode: product.barcode,
          sku: product.sku,
          name: product.name,
          costPrice: product.costPrice,
        },
      } as AuthRequest;
      const res = createResponse();
      const next = createNext();

      await controller.createProduct(req, res, next);

      expect(serviceFactory).toHaveBeenCalledWith('org-1');
      expect(createProduct).toHaveBeenCalledWith({
        barcode: product.barcode,
        sku: product.sku,
        name: product.name,
        costPrice: product.costPrice,
      });
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(product);
      expect(next).not.toHaveBeenCalled();
    });

    it('returns a validation response when required product fields are missing', async () => {
      const serviceFactory = jest.fn();
      const controller = new ProductController(serviceFactory, {} as never, {} as never);
      const req = { organizationId: 'org-1', body: { sku: 'SKU-1' } } as AuthRequest;
      const res = createResponse();
      const next = createNext();

      await controller.createProduct(req, res, next);

      expect(serviceFactory).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ message: 'Missing required product fields' });
      expect(next).not.toHaveBeenCalled();
    });

    it('passes unexpected service failures to error middleware', async () => {
      const error = new Error('database unavailable');
      const controller = new ProductController(
        jest.fn().mockReturnValue({
          getAllProducts: jest.fn().mockRejectedValue(error),
        }),
        {} as never,
        {} as never,
      );
      const req = { organizationId: 'org-1' } as AuthRequest;
      const res = createResponse();
      const next = createNext();

      await controller.getAllProducts(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
      expect(res.json).not.toHaveBeenCalled();
    });
  });

  describe('InventoryController', () => {
    it('returns inventory rows for a valid barcode lookup', async () => {
      const inventoryItems = [{ id: 11, organizationId: 'org-1' }];
      const inventoryService = {
        getInventoryItemsByProductId: jest.fn().mockResolvedValue(inventoryItems),
      };
      const productService = {
        getProductByBarcode: jest.fn().mockResolvedValue({ id: 7 }),
      };
      const controller = new InventoryController(
        jest.fn().mockReturnValue(inventoryService),
        jest.fn().mockReturnValue(productService),
      );
      const req = {
        organizationId: 'org-1',
        params: { barcode: '1234567890123' },
      } as unknown as AuthRequest;
      const res = createResponse();
      const next = createNext();

      await controller.getInventoryItemsByBarcode(req, res, next);

      expect(productService.getProductByBarcode).toHaveBeenCalledWith('1234567890123');
      expect(inventoryService.getInventoryItemsByProductId).toHaveBeenCalledWith(7);
      expect(res.json).toHaveBeenCalledWith(inventoryItems);
      expect(next).not.toHaveBeenCalled();
    });

    it('forwards validation failures to centralized error middleware', async () => {
      const controller = new InventoryController(jest.fn(), jest.fn());
      const req = {
        organizationId: 'org-1',
        params: { barcode: 'bad' },
      } as unknown as AuthRequest;
      const res = createResponse();
      const next = createNext();

      await controller.getInventoryItemsByBarcode(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
      expect(res.json).not.toHaveBeenCalled();
    });

    it('forwards missing organization context to centralized error middleware', async () => {
      const controller = new InventoryController(jest.fn(), jest.fn());
      const req = { params: { id: '1' } } as unknown as AuthRequest;
      const res = createResponse();
      const next = createNext();

      await controller.getInventoryItemById(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(AuthenticationError));
      expect(res.json).not.toHaveBeenCalled();
    });
  });

  describe('SubscriptionController', () => {
    let loggerErrorSpy: jest.SpyInstance;

    beforeEach(() => {
      loggerErrorSpy = jest.spyOn(Logger, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
      loggerErrorSpy.mockRestore();
    });

    function createController(
      overrides: {
        userRepository?: Record<string, jest.Mock>;
        subscriptionService?: Record<string, jest.Mock>;
        subscriptionRepository?: Record<string, jest.Mock>;
        stripe?: {
          customers: { create: jest.Mock };
          checkout: { sessions: { create: jest.Mock } };
          billingPortal: { sessions: { create: jest.Mock } };
        };
      } = {},
    ): SubscriptionController {
      const stripe =
        overrides.stripe ??
        ({
          customers: { create: jest.fn() },
          checkout: { sessions: { create: jest.fn() } },
          billingPortal: { sessions: { create: jest.fn() } },
        } as const);

      return new SubscriptionController(
        overrides.subscriptionService as never,
        overrides.userRepository as never,
        overrides.subscriptionRepository as never,
        () => stripe as never,
      );
    }

    it('returns trial status with tier limits for the authenticated Clerk user', async () => {
      const trialEndDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
      const controller = createController({
        userRepository: {
          findByClerkUserIdWithOrganizationSubscriptions: jest.fn().mockResolvedValue({
            organization: {
              subscriptionTiers: [
                {
                  status: 'TRIALING',
                  tierLevel: 'professional',
                  trialEndDate,
                  trialStartedAt: new Date('2026-01-01T00:00:00.000Z'),
                  trialConvertedAt: null,
                  billingCycle: null,
                },
              ],
            },
          }),
        },
      });
      const req = { userId: 'clerk-user-1' } as ClerkAuthRequest;
      const res = createResponse();

      await controller.getTrialStatus(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          isInTrial: true,
          isTrialExpired: false,
          tierLimits: expect.objectContaining({ maxUsers: 10 }),
        }),
      );
    });

    it('throws validation errors for missing checkout session fields', async () => {
      const controller = createController();
      const req = { userId: 'clerk-user-1', body: { priceId: 'price_123' } } as ClerkAuthRequest;
      const res = createResponse();

      await expect(controller.createCheckoutSession(req, res)).rejects.toThrow(ValidationError);
      expect(res.json).not.toHaveBeenCalled();
    });

    it('wraps unexpected repository failures with an internal error', async () => {
      const controller = createController({
        userRepository: {
          findByClerkUserIdWithOrganizationSubscriptions: jest
            .fn()
            .mockRejectedValue(new Error('repository failed')),
        },
      });
      const req = { userId: 'clerk-user-1' } as ClerkAuthRequest;
      const res = createResponse();

      await expect(controller.getTrialStatus(req, res)).rejects.toThrow(InternalError);
      expect(res.json).not.toHaveBeenCalled();
    });
  });

  describe('WebhookController', () => {
    const monitor = {
      recordWebhookEvent: jest.fn(),
    };

    let loggerInfoSpy: jest.SpyInstance;
    let loggerWarnSpy: jest.SpyInstance;
    let loggerErrorSpy: jest.SpyInstance;
    let monitorSpy: jest.SpyInstance;

    beforeEach(() => {
      loggerInfoSpy = jest.spyOn(Logger, 'info').mockImplementation(() => undefined);
      loggerWarnSpy = jest.spyOn(Logger, 'warn').mockImplementation(() => undefined);
      loggerErrorSpy = jest.spyOn(Logger, 'error').mockImplementation(() => undefined);
      monitorSpy = jest
        .spyOn(ApplicationMonitoringService, 'getInstance')
        .mockReturnValue(monitor as unknown as ApplicationMonitoringService);
      monitor.recordWebhookEvent.mockClear();
    });

    afterEach(() => {
      loggerInfoSpy.mockRestore();
      loggerWarnSpy.mockRestore();
      loggerErrorSpy.mockRestore();
      monitorSpy.mockRestore();
    });

    function createController(
      overrides: {
        webhookService?: Record<string, jest.Mock>;
        clerkWebhookService?: Record<string, jest.Mock>;
      } = {},
    ): WebhookController {
      const webhookService = overrides.webhookService ?? {
        verifySignature: jest.fn().mockReturnValue({
          id: 'evt_test_1',
          type: 'customer.subscription.updated',
          data: { object: {} },
        }),
        isNewEvent: jest.fn().mockResolvedValue(true),
        handleEvent: jest.fn().mockResolvedValue(undefined),
        markEventProcessed: jest.fn().mockResolvedValue(undefined),
      };
      const clerkWebhookService = overrides.clerkWebhookService ?? {
        verifySignature: jest.fn().mockReturnValue({
          type: 'user.created',
          data: {},
        }),
        isNewEvent: jest.fn().mockResolvedValue(true),
        handleEvent: jest.fn().mockResolvedValue(undefined),
        markEventProcessed: jest.fn().mockResolvedValue(undefined),
      };

      return new WebhookController(webhookService as never, clerkWebhookService as never);
    }

    it('rejects Stripe webhooks that are missing the signature header', async () => {
      const webhookService = {
        verifySignature: jest.fn(),
        isNewEvent: jest.fn(),
        handleEvent: jest.fn(),
        markEventProcessed: jest.fn(),
      };
      const controller = createController({ webhookService });
      const req = { headers: {}, body: Buffer.from('{}') };
      const res = createResponse();
      const next = createNext();

      await controller.handleStripeWebhook(req as never, res, next);

      expect(webhookService.verifySignature).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Missing stripe-signature header' });
      expect(next).not.toHaveBeenCalled();
    });

    it('processes new Stripe webhooks and records success telemetry', async () => {
      const webhookService = {
        verifySignature: jest.fn().mockReturnValue({
          id: 'evt_success',
          type: 'customer.subscription.updated',
          data: { object: {} },
        }),
        isNewEvent: jest.fn().mockResolvedValue(true),
        handleEvent: jest.fn().mockResolvedValue(undefined),
        markEventProcessed: jest.fn().mockResolvedValue(undefined),
      };
      const controller = createController({ webhookService });
      const req = {
        headers: { 'stripe-signature': 'sig_success' },
        body: Buffer.from('{}'),
      };
      const res = createResponse();
      const next = createNext();

      await controller.handleStripeWebhook(req as never, res, next);

      expect(webhookService.verifySignature).toHaveBeenCalledWith(req.body, 'sig_success');
      expect(webhookService.handleEvent).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'evt_success' }),
      );
      expect(webhookService.markEventProcessed).toHaveBeenCalledWith(
        'evt_success',
        'customer.subscription.updated',
      );
      expect(monitor.recordWebhookEvent).toHaveBeenCalledWith(
        'customer.subscription.updated',
        expect.any(Number),
        'success',
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ received: true });
      expect(next).not.toHaveBeenCalled();
    });

    it('acknowledges non-recoverable Stripe processing errors to stop retry storms', async () => {
      const webhookService = {
        verifySignature: jest.fn().mockReturnValue({
          id: 'evt_not_found',
          type: 'customer.subscription.updated',
          data: { object: {} },
        }),
        isNewEvent: jest.fn().mockResolvedValue(true),
        handleEvent: jest.fn().mockRejectedValue(new NotFoundError('organization not found')),
        markEventProcessed: jest.fn(),
      };
      const controller = createController({ webhookService });
      const req = {
        headers: { 'stripe-signature': 'sig_not_found' },
        body: Buffer.from('{}'),
      };
      const res = createResponse();
      const next = createNext();

      await controller.handleStripeWebhook(req as never, res, next);

      expect(monitor.recordWebhookEvent).toHaveBeenCalledWith(
        'customer.subscription.updated',
        expect.any(Number),
        'error',
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ received: true });
      expect(next).not.toHaveBeenCalled();
    });

    it('rejects Clerk webhooks that are missing required Svix headers', async () => {
      const clerkWebhookService = {
        verifySignature: jest.fn(),
        isNewEvent: jest.fn(),
        handleEvent: jest.fn(),
        markEventProcessed: jest.fn(),
      };
      const controller = createController({ clerkWebhookService });
      const req = { headers: {}, body: Buffer.from('{}') };
      const res = createResponse();
      const next = createNext();

      await controller.handleClerkWebhook(req as never, res, next);

      expect(clerkWebhookService.verifySignature).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Missing required Svix headers' });
      expect(next).not.toHaveBeenCalled();
    });

    it('processes new Clerk webhooks with Svix idempotency keys', async () => {
      const clerkWebhookService = {
        verifySignature: jest.fn().mockReturnValue({
          type: 'user.created',
          data: {},
        }),
        isNewEvent: jest.fn().mockResolvedValue(true),
        handleEvent: jest.fn().mockResolvedValue(undefined),
        markEventProcessed: jest.fn().mockResolvedValue(undefined),
      };
      const controller = createController({ clerkWebhookService });
      const req = {
        headers: {
          'svix-id': 'msg_success',
          'svix-timestamp': '1777777777',
          'svix-signature': 'v1,test',
        },
        body: Buffer.from('{}'),
      };
      const res = createResponse();
      const next = createNext();

      await controller.handleClerkWebhook(req as never, res, next);

      expect(clerkWebhookService.verifySignature).toHaveBeenCalledWith(req.body, {
        'svix-id': 'msg_success',
        'svix-timestamp': '1777777777',
        'svix-signature': 'v1,test',
      });
      expect(clerkWebhookService.handleEvent).toHaveBeenCalledWith({
        type: 'user.created',
        data: {},
      });
      expect(clerkWebhookService.markEventProcessed).toHaveBeenCalledWith(
        'msg_success',
        'user.created',
      );
      expect(monitor.recordWebhookEvent).toHaveBeenCalledWith(
        'user.created',
        expect.any(Number),
        'success',
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ received: true });
      expect(next).not.toHaveBeenCalled();
    });

    it('returns Clerk conflict errors without hiding duplicate-account details', async () => {
      const clerkWebhookService = {
        verifySignature: jest.fn().mockReturnValue({
          type: 'user.created',
          data: {},
        }),
        isNewEvent: jest.fn().mockResolvedValue(true),
        handleEvent: jest.fn().mockRejectedValue(new ConflictError('Email already registered')),
        markEventProcessed: jest.fn(),
      };
      const controller = createController({ clerkWebhookService });
      const req = {
        headers: {
          'svix-id': 'msg_conflict',
          'svix-timestamp': '1777777777',
          'svix-signature': 'v1,test',
        },
        body: Buffer.from('{}'),
      };
      const res = createResponse();
      const next = createNext();

      await controller.handleClerkWebhook(req as never, res, next);

      expect(monitor.recordWebhookEvent).toHaveBeenCalledWith(
        'user.created',
        expect.any(Number),
        'error',
      );
      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({ error: 'Email already registered' });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('StoreAreaController', () => {
    it('creates a store area through the organization-scoped service', async () => {
      const createdArea = {
        id: 2,
        name: 'Back Room',
        subDepartment: 'General',
      };
      const createStoreArea = jest.fn().mockResolvedValue(createdArea);
      const serviceFactory = jest.fn().mockReturnValue({ createStoreArea });
      const controller = new StoreAreaController(serviceFactory);
      const req = {
        organizationId: 'org-1',
        body: {
          name: 'Back Room',
          subDepartment: 'General',
          lastChecked: '2026-05-07T00:00:00.000Z',
        },
      } as AuthRequest;
      const res = createResponse();
      const next = createNext();

      await controller.createStoreArea(req, res, next);

      expect(serviceFactory).toHaveBeenCalledWith('org-1');
      expect(createStoreArea).toHaveBeenCalledWith({
        name: 'Back Room',
        subDepartment: 'General',
        lastChecked: '2026-05-07T00:00:00.000Z',
      });
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(createdArea);
      expect(next).not.toHaveBeenCalled();
    });

    it('returns validation responses for invalid store area ids', async () => {
      const serviceFactory = jest.fn();
      const controller = new StoreAreaController(serviceFactory);
      const req = {
        organizationId: 'org-1',
        params: { id: 'not-a-number' },
      } as unknown as AuthRequest;
      const res = createResponse();
      const next = createNext();

      await controller.getStoreAreaById(req, res, next);

      expect(serviceFactory).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ message: 'Invalid store area id' });
      expect(next).not.toHaveBeenCalled();
    });

    it('returns not-found responses when the service has no matching store area', async () => {
      const service = {
        getStoreAreaById: jest.fn().mockResolvedValue(null),
      };
      const controller = new StoreAreaController(jest.fn().mockReturnValue(service));
      const req = {
        organizationId: 'org-1',
        params: { id: '12' },
      } as unknown as AuthRequest;
      const res = createResponse();
      const next = createNext();

      await controller.getStoreAreaById(req, res, next);

      expect(service.getStoreAreaById).toHaveBeenCalledWith(12);
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ message: 'Store area not found' });
      expect(next).not.toHaveBeenCalled();
    });

    it('passes unexpected service failures to error middleware', async () => {
      const error = new Error('store area database unavailable');
      const controller = new StoreAreaController(
        jest.fn().mockReturnValue({
          getAllStoreAreas: jest.fn().mockRejectedValue(error),
        }),
      );
      const req = { organizationId: 'org-1' } as AuthRequest;
      const res = createResponse();
      const next = createNext();

      await controller.getAllStoreAreas(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
      expect(res.json).not.toHaveBeenCalled();
    });
  });

  describe('StorageQuotaController', () => {
    it('returns quota information through the organization-scoped service', async () => {
      const quota = {
        used: 500,
        limit: 1000,
        percentageUsed: 50,
        tier: 'pro',
        displayLimit: '1 KB',
        warningThreshold: 80,
        isWarning: false,
      };
      const getStorageQuota = jest.fn().mockResolvedValue(quota);
      const serviceFactory = jest.fn().mockReturnValue({ getStorageQuota });
      const controller = new StorageQuotaController(serviceFactory);
      const req = {
        params: { userId: '7' },
        query: { tier: 'pro' },
        userId: 7,
        organizationId: 'org-1',
      } as unknown as AuthRequest;
      const res = createResponse();
      const next = createNext();

      await controller.getStorageQuota(req, res, next);

      expect(serviceFactory).toHaveBeenCalledWith('org-1');
      expect(getStorageQuota).toHaveBeenCalledWith('pro');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(quota);
      expect(next).not.toHaveBeenCalled();
    });

    it('returns validation responses before creating a storage quota service', async () => {
      const serviceFactory = jest.fn();
      const controller = new StorageQuotaController(serviceFactory);
      const req = {
        params: { userId: 'not-a-number' },
        query: {},
        userId: 7,
        organizationId: 'org-1',
      } as unknown as AuthRequest;
      const res = createResponse();
      const next = createNext();

      await controller.getStorageQuota(req, res, next);

      expect(serviceFactory).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Invalid user ID',
        message: 'User ID must be a number',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('returns a denied upload response with remaining quota details', async () => {
      const canUploadFile = jest.fn().mockResolvedValue(false);
      const getStorageQuota = jest.fn().mockResolvedValue({
        used: 900,
        limit: 1000,
        percentageUsed: 90,
        tier: 'free',
        displayLimit: '1 KB',
        warningThreshold: 80,
        isWarning: true,
      });
      const controller = new StorageQuotaController(
        jest.fn().mockReturnValue({ canUploadFile, getStorageQuota }),
      );
      const req = {
        params: { userId: '7' },
        query: { size: '200', tier: 'free' },
        userId: 7,
        organizationId: 'org-1',
      } as unknown as AuthRequest;
      const res = createResponse();
      const next = createNext();

      await controller.canUpload(req, res, next);

      expect(canUploadFile).toHaveBeenCalledWith(200, 'free');
      expect(getStorageQuota).toHaveBeenCalledWith('free');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        canUpload: false,
        reason: 'Upload would exceed quota. Currently using 90% of 1 KB',
        remainingBytes: 100,
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('passes unexpected storage quota failures to error middleware', async () => {
      const error = new Error('quota backend unavailable');
      const controller = new StorageQuotaController(
        jest.fn().mockReturnValue({
          getStorageQuota: jest.fn().mockRejectedValue(error),
        }),
      );
      const req = {
        params: { userId: '7' },
        query: {},
        userId: 7,
        organizationId: 'org-1',
      } as unknown as AuthRequest;
      const res = createResponse();
      const next = createNext();

      await controller.getStorageQuota(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });
  });

  describe('DashboardController', () => {
    it('returns dashboard data through the organization-scoped service', async () => {
      const dashboardData = {
        totalProducts: 12,
        totalInventoryItems: 34,
        totalValue: 567.89,
      };
      const getDashboardData = jest.fn().mockResolvedValue(dashboardData);
      const serviceFactory = jest.fn().mockReturnValue({ getDashboardData });
      const controller = new DashboardController(serviceFactory);
      const req = { organizationId: 'org-1' } as AuthRequest;
      const res = createResponse();
      const next = createNext();

      await controller.getDashboardData(req, res, next);

      expect(serviceFactory).toHaveBeenCalledWith('org-1');
      expect(getDashboardData).toHaveBeenCalledWith();
      expect(res.json).toHaveBeenCalledWith(dashboardData);
      expect(next).not.toHaveBeenCalled();
    });

    it('passes unexpected dashboard failures to error middleware', async () => {
      const error = new Error('dashboard backend unavailable');
      const controller = new DashboardController(
        jest.fn().mockReturnValue({
          getDashboardData: jest.fn().mockRejectedValue(error),
        }),
      );
      const req = { organizationId: 'org-1' } as AuthRequest;
      const res = createResponse();
      const next = createNext();

      await controller.getDashboardData(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
      expect(res.json).not.toHaveBeenCalled();
    });
  });

  describe('ExpiredItemController', () => {
    it('returns expired items through the expired item service', async () => {
      const expiredItems = [
        {
          id: 1,
          sku: 'SKU-1',
          productName: 'Milk',
          locationName: 'Cool Room',
        },
      ];
      const getAllExpiredItems = jest.fn().mockResolvedValue(expiredItems);
      const serviceFactory = jest.fn().mockReturnValue({ getAllExpiredItems });
      const controller = new ExpiredItemController(serviceFactory);
      const req = { organizationId: 'org-1' } as AuthRequest;
      const res = createResponse();
      const next = createNext();

      await controller.getAllExpiredItems(req, res, next);

      expect(serviceFactory).toHaveBeenCalledWith('org-1');
      expect(getAllExpiredItems).toHaveBeenCalledWith();
      expect(res.json).toHaveBeenCalledWith(expiredItems);
      expect(next).not.toHaveBeenCalled();
    });

    it('returns validation responses before processing expired items', async () => {
      const serviceFactory = jest.fn();
      const controller = new ExpiredItemController(serviceFactory);
      const req = {
        organizationId: 'org-1',
        userId: 7,
        body: { action: 'expired', unitsDiscarded: 2 },
      } as AuthRequest;
      const res = createResponse();
      const next = createNext();

      await controller.processExpiredItem(req, res, next);

      expect(serviceFactory).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Missing or invalid required field: inventoryItemId',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('maps not-found processing failures to the existing response shape', async () => {
      const error = new Error('Inventory item with ID 1 not found');
      const processExpiredItem = jest.fn().mockRejectedValue(error);
      const controller = new ExpiredItemController(
        jest.fn().mockReturnValue({ processExpiredItem }),
      );
      const req = {
        organizationId: 'org-1',
        userId: 7,
        body: { inventoryItemId: 1, action: 'sold_through' },
      } as AuthRequest;
      const res = createResponse();
      const next = createNext();

      await controller.processExpiredItem(req, res, next);

      expect(processExpiredItem).toHaveBeenCalledWith(1, 7, 'sold_through', undefined);
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ message: 'Inventory item with ID 1 not found' });
      expect(next).not.toHaveBeenCalled();
    });

    it('returns expired loss reports from both service aggregations', async () => {
      const getFinancialLossesBySKU = jest
        .fn()
        .mockResolvedValue([{ sku: 'SKU-1', productName: 'Milk', totalLoss: 15 }]);
      const getFinancialLossesByStoreArea = jest
        .fn()
        .mockResolvedValue([{ locationName: 'Cool Room', totalLoss: 15 }]);
      const controller = new ExpiredItemController(
        jest.fn().mockReturnValue({ getFinancialLossesBySKU, getFinancialLossesByStoreArea }),
      );
      const req = { organizationId: 'org-1' } as AuthRequest;
      const res = createResponse();
      const next = createNext();

      await controller.getExpiredLossReports(req, res, next);

      expect(getFinancialLossesBySKU).toHaveBeenCalledWith();
      expect(getFinancialLossesByStoreArea).toHaveBeenCalledWith();
      expect(res.json).toHaveBeenCalledWith({
        lossesBySKU: [{ sku: 'SKU-1', productName: 'Milk', totalLoss: 15 }],
        lossesByStoreArea: [{ locationName: 'Cool Room', totalLoss: 15 }],
      });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('ReportController', () => {
    it('returns monthly expiry reports through the organization-scoped service', async () => {
      const report = [{ month: '2026-05', count: 3 }];
      const getMonthlyExpiryReport = jest.fn().mockResolvedValue(report);
      const serviceFactory = jest.fn().mockReturnValue({ getMonthlyExpiryReport });
      const controller = new ReportController(serviceFactory);
      const req = { organizationId: 'org-1' } as AuthRequest;
      const res = createResponse();
      const next = createNext();

      await controller.getMonthlyExpiryReport(req, res, next);

      expect(serviceFactory).toHaveBeenCalledWith('org-1');
      expect(getMonthlyExpiryReport).toHaveBeenCalledWith();
      expect(res.json).toHaveBeenCalledWith(report);
      expect(next).not.toHaveBeenCalled();
    });

    it('returns the existing update-statuses success response', async () => {
      const updateAllMarkdownStatuses = jest.fn().mockResolvedValue(undefined);
      const controller = new ReportController(
        jest.fn().mockReturnValue({ updateAllMarkdownStatuses }),
      );
      const req = { organizationId: 'org-1' } as AuthRequest;
      const res = createResponse();
      const next = createNext();

      await controller.updateAllMarkdownStatuses(req, res, next);

      expect(updateAllMarkdownStatuses).toHaveBeenCalledWith();
      expect(res.json).toHaveBeenCalledWith({
        message: 'All inventory markdown statuses updated successfully.',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('returns validation responses before loading items-by-user reports', async () => {
      const serviceFactory = jest.fn();
      const controller = new ReportController(serviceFactory);
      const req = {
        organizationId: 'org-1',
        query: { timeFrame: '0' },
      } as unknown as AuthRequest;
      const res = createResponse();
      const next = createNext();

      await controller.getItemsByUserReport(req, res, next);

      expect(serviceFactory).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ message: 'Invalid timeFrame value' });
      expect(next).not.toHaveBeenCalled();
    });

    it('passes valid items-by-user timeframes to the report service', async () => {
      const report = [{ userId: 7, count: 4 }];
      const getItemsByUserReport = jest.fn().mockResolvedValue(report);
      const controller = new ReportController(jest.fn().mockReturnValue({ getItemsByUserReport }));
      const req = {
        organizationId: 'org-1',
        query: { timeFrame: '30' },
      } as unknown as AuthRequest;
      const res = createResponse();
      const next = createNext();

      await controller.getItemsByUserReport(req, res, next);

      expect(getItemsByUserReport).toHaveBeenCalledWith('30');
      expect(res.json).toHaveBeenCalledWith(report);
      expect(next).not.toHaveBeenCalled();
    });

    it('passes unexpected report failures to error middleware', async () => {
      const error = new Error('report backend unavailable');
      const controller = new ReportController(
        jest.fn().mockReturnValue({
          getOverallExpiryReport: jest.fn().mockRejectedValue(error),
        }),
      );
      const req = { organizationId: 'org-1' } as AuthRequest;
      const res = createResponse();
      const next = createNext();

      await controller.getOverallExpiryReport(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
      expect(res.json).not.toHaveBeenCalled();
    });
  });

  describe('HealthController', () => {
    const validTierResult = {
      valid: true,
      missingFeatures: [],
      errors: [],
      warnings: [],
      flagCounts: {
        starter: 8,
        professional: 8,
        premium: 8,
        concierge: 8,
      },
    };

    function createController(
      overrides: Partial<ConstructorParameters<typeof HealthController>[0]> = {},
    ) {
      const db = {
        prepare: jest.fn().mockImplementation((sql: string) => ({
          get: () => (sql.includes('ready') ? { ready: 1 } : { alive: 1 }),
        })),
        pragma: jest.fn().mockReturnValue(1),
      };
      const dependencies = {
        getDb: jest.fn().mockReturnValue(db),
        releaseDb: jest.fn(),
        getDatabaseMetrics: jest.fn().mockReturnValue({ queryCount: 12 }),
        validateTierFeatureFlags: jest.fn().mockResolvedValue(validTierResult),
        getSubscriptionRepository: jest.fn().mockReturnValue({}),
        now: jest.fn().mockReturnValue(new Date('2026-05-08T00:00:00.000Z')),
        getProcessMetrics: jest.fn().mockReturnValue({
          uptime: 123,
          memory: { rss: 1, heapTotal: 2, heapUsed: 3, external: 4 },
          cpu: { user: 5, system: 6 },
          process: {
            pid: 99,
            version: 'v22.0.0',
            platform: 'test',
            arch: 'x64',
          },
        }),
        ...overrides,
      };

      return {
        controller: new HealthController(dependencies),
        dependencies,
        db,
      };
    }

    it('returns healthy status when tier flags are valid and database responds', async () => {
      const { controller, dependencies, db } = createController();
      await controller.initializeTierFlagValidation();
      const req = {} as AuthRequest;
      const res = createResponse();

      await controller.getHealth(req, res);

      expect(dependencies.getDb).toHaveBeenCalledWith();
      expect(dependencies.releaseDb).toHaveBeenCalledWith(db);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        status: 'healthy',
        timestamp: '2026-05-08T00:00:00.000Z',
        services: {
          database: 'healthy',
          api: 'healthy',
          tierFeatureFlags: 'configured',
        },
        tierFlags: {
          validatedAt: '2026-05-08T00:00:00.000Z',
          flagCounts: validTierResult.flagCounts,
          warnings: [],
        },
      });
    });

    it('returns not ready before tier flag validation succeeds', async () => {
      const { controller, dependencies } = createController();
      const req = {} as AuthRequest;
      const res = createResponse();

      await controller.getReady(req, res);

      expect(dependencies.getDb).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({
        status: 'not ready',
        timestamp: '2026-05-08T00:00:00.000Z',
        error: 'Tier feature flags not properly configured',
      });
    });

    it('returns database metrics errors with the existing response shape', async () => {
      const { controller } = createController({
        getDatabaseMetrics: jest.fn(() => {
          throw new Error('metrics unavailable');
        }),
      });
      const req = {} as AuthRequest;
      const res = createResponse();

      controller.getDatabaseMetrics(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        status: 'error',
        timestamp: '2026-05-08T00:00:00.000Z',
        error: 'Failed to retrieve database metrics: metrics unavailable',
      });
    });
  });
});
