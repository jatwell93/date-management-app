import { NextFunction, Response } from 'express';
import { ProductController } from '../../controllers/product.controller';
import { InventoryController } from '../../controllers/inventory.controller';
import { SubscriptionController } from '../../controllers/subscription.controller';
import { AuthRequest } from '../../middleware/auth.middleware';
import { ClerkAuthRequest } from '../../middleware/clerk-auth.middleware';
import { AuthenticationError, InternalError, ValidationError } from '../../errors';
import { Logger } from '../../utils/logger';

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
});
