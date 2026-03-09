import express from 'express';
import request from 'supertest';

const mockPrisma = {
  subscriptionTier: {
    findFirst: jest.fn(),
  },
  organizationUsage: {
    findUnique: jest.fn(),
  },
  product: {
    findMany: jest.fn(),
  },
};

jest.mock('../../middleware/auth.middleware', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.organizationId = req.get('x-org-id') || undefined;
    req.user = { id: 1, role: 'Manager' };
    next();
  },
}));

jest.mock('../../middleware/feature-gate.middleware', () => ({
  checkUsageLimit: () => (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../../middleware/validation.middleware', () => ({
  validateDataIntegrity: (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../../middleware/validateRequest', () => ({
  validateRequest: () => (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../../middleware/data-integrity.middleware', () => ({
  validateBusinessRules: (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../../middleware/rateLimiter', () => ({
  standardLimiter: (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../../services/product.service', () => ({
  ProductService: jest.fn().mockImplementation(() => ({
    getAllProducts: jest.fn().mockResolvedValue([]),
    getProductByBarcode: jest.fn().mockResolvedValue(null),
    getProductBySku: jest.fn().mockResolvedValue(null),
    getProductById: jest.fn().mockResolvedValue(null),
    createProduct: jest.fn().mockResolvedValue({ id: 1 }),
    updateProduct: jest.fn().mockResolvedValue(null),
    deleteProduct: jest.fn().mockResolvedValue(false),
  })),
}));

jest.mock('../../database/database-factory', () => ({
  getDefaultDatabaseClient: () => mockPrisma,
}));

import productRouter from '../../routes/product.routes';
import { BaseError } from '../../errors';

describe('product.routes organization guards', () => {
  const app = express();
  app.use(express.json());
  app.use('/products', productRouter);

  // Error handling middleware to convert thrown errors to HTTP responses
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof BaseError) {
      return res.status(err.statusCode).json({ message: err.message });
    }
    return res.status(500).json({ message: 'Internal server error' });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 401 on export-excess when organizationId is missing', async () => {
    const response = await request(app).get('/products/export-excess');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: 'Organization context missing' });
    expect(mockPrisma.subscriptionTier.findFirst).not.toHaveBeenCalled();
  });

  it('returns 401 on create product when organizationId is missing', async () => {
    const response = await request(app).post('/products').send({
      barcode: '1234567890',
      sku: 'SKU-1',
      name: 'Test Product',
      costPrice: 12.34,
    });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: 'Organization context missing' });
  });
});
