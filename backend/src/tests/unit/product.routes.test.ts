import express from 'express';
import path from 'path';
import request from 'supertest';

const mockUploadMiddleware = jest.fn();
const mockMulterSingle = jest.fn(() => (req: any, res: any, next: any) => {
  mockUploadMiddleware(req, res, next);
});
let capturedMulterOptions: unknown;
const mockMulter = jest.fn((options: unknown) => {
  capturedMulterOptions = options;
  return {
    single: mockMulterSingle,
  };
});

const mockUnlink = jest.fn();

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

const mockProductService = {
  getAllProducts: jest.fn(),
  getProductByBarcode: jest.fn(),
  getProductBySku: jest.fn(),
  getProductById: jest.fn(),
  createProduct: jest.fn(),
  updateProduct: jest.fn(),
  deleteProduct: jest.fn(),
  processCSVUpload: jest.fn(),
  getExcessProductsView: jest.fn(),
};

const MockProductService = jest.fn().mockImplementation(() => mockProductService);
let mockProductController: any;

jest.mock('multer', () => mockMulter);

jest.mock('fs', () => ({
  __esModule: true,
  default: {
    unlink: (...args: unknown[]) => mockUnlink(...args),
  },
  unlink: (...args: unknown[]) => mockUnlink(...args),
}));

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
  ProductService: MockProductService,
}));

jest.mock('../../database/database-factory', () => ({
  getDefaultDatabaseClient: () => mockPrisma,
}));

jest.mock('../../di/services', () => ({
  createProductController: () => mockProductController,
}));

import productRouter from '../../routes/product.routes';
import { BaseError, NotFoundError } from '../../errors';
import { ProductController } from '../../controllers/product.controller';

describe('product.routes organization guards', () => {
  beforeAll(() => {
    mockProductController = new ProductController(() => mockProductService as any);
    mockProductController.uploadCsv = async (req: any, res: any, next: any) => {
      try {
        if (!req.file) {
          res.status(400).json({ message: 'No file provided' });
          return;
        }

        const uploadDir = path.dirname(req.file.path);
        const safeFilePath = path.resolve(uploadDir, path.basename(req.file.path));
        if (!safeFilePath.startsWith(uploadDir + path.sep)) {
          res.status(400).json({ message: 'Invalid file path' });
          return;
        }

        const result = await mockProductService.processCSVUpload(
          safeFilePath,
          req.file.originalname,
        );
        const responseObj: {
          success: boolean;
          message: string;
          imported: number;
          updated: number;
          errors?: string[];
        } = {
          success: result.errors.length === 0,
          message:
            result.errors.length > 0
              ? `CSV processed with ${result.errors.length} error(s). See 'errors' field for details.`
              : 'CSV processed successfully',
          imported: result.imported,
          updated: result.updated,
        };

        if (result.errors.length > 0) {
          responseObj.errors = result.errors;
        }

        res.json(responseObj);
      } catch (error) {
        next(error);
      }
    };
  });

  const app = express();
  app.use(express.json());
  app.use('/products', productRouter);

  // Error handling middleware to convert thrown errors to HTTP responses
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof BaseError) {
      return res.status(err.statusCode).json({ message: err.message });
    }
    return res.status(500).json({ message: err?.message ?? 'Internal server error' });
  });

  const baseProduct = {
    id: 42,
    organizationId: 'org-1',
    barcode: '1234567890123',
    sku: 'SKU-42',
    name: 'Sample Product',
    costPrice: 12.34,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    jest.clearAllMocks();

    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    mockPrisma.subscriptionTier.findFirst.mockResolvedValue({ tierLevel: 'professional' });
    mockPrisma.organizationUsage.findUnique.mockResolvedValue({ totalSkus: 2005 });
    mockPrisma.product.findMany.mockResolvedValue([
      {
        id: 1,
        sku: 'SKU-1',
        name: 'Excess Product 1',
        barcode: '1111111111111',
        costPrice: 10.5,
        createdAt: new Date('2026-02-01T00:00:00.000Z'),
        _count: { inventoryItems: 3 },
      },
    ]);
    mockProductService.getAllProducts.mockResolvedValue([]);
    mockProductService.getProductByBarcode.mockResolvedValue(null);
    mockProductService.getProductBySku.mockResolvedValue(null);
    mockProductService.getProductById.mockResolvedValue(null);
    mockProductService.createProduct.mockResolvedValue({ ...baseProduct, id: 100 });
    mockProductService.updateProduct.mockResolvedValue(null);
    mockProductService.deleteProduct.mockResolvedValue(false);
    mockProductService.processCSVUpload.mockResolvedValue({ imported: 1, updated: 0, errors: [] });

    mockUploadMiddleware.mockImplementation((req: any, _res: any, next: any) => {
      const mode = req.get('x-upload-mode');

      if (mode === 'valid') {
        req.file = {
          path: path.resolve('uploads', 'products-upload.csv'),
          originalname: 'products-upload.csv',
        };
      } else if (mode === 'valid-xlsx') {
        req.file = {
          path: path.resolve('uploads', 'products-upload.xlsx'),
          originalname: 'products-upload.xlsx',
        };
      } else if (mode === 'invalid-path') {
        req.file = {
          path: path.join('uploads', 'products-upload.csv'),
          originalname: 'products-upload.csv',
        };
      } else if (mode === 'too-large') {
        const error = new Error('File too large') as Error & { code?: string };
        error.code = 'LIMIT_FILE_SIZE';
        next(error);
        return;
      } else if (mode === 'invalid-type-code') {
        const error = new Error('Multer rejected uploaded file type') as Error & { code?: string };
        error.code = 'INVALID_PRODUCT_UPLOAD_TYPE';
        next(error);
        return;
      }

      next();
    });

    mockUnlink.mockImplementation(
      (_filePath: string, cb: (error: NodeJS.ErrnoException | null) => void) => {
        cb(null);
      },
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns all products for GET /products', async () => {
    mockProductService.getAllProducts.mockResolvedValue([baseProduct]);

    const response = await request(app).get('/products').set('x-org-id', 'org-1');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([baseProduct]);
  });

  it('returns 500 for GET /products when service throws', async () => {
    mockProductService.getAllProducts.mockRejectedValue(new Error('list failed'));

    const response = await request(app).get('/products').set('x-org-id', 'org-1');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ message: 'list failed' });
  });

  it('returns 404 for GET /products/by-barcode/:barcode when product does not exist', async () => {
    const response = await request(app).get('/products/by-barcode/000').set('x-org-id', 'org-1');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: 'Product not found' });
  });

  it('returns product for GET /products/by-barcode/:barcode when found', async () => {
    mockProductService.getProductByBarcode.mockResolvedValue(baseProduct);

    const response = await request(app)
      .get('/products/by-barcode/1234567890123')
      .set('x-org-id', 'org-1');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(baseProduct);
  });

  it('returns 404 for GET /products/by-sku/:sku when product does not exist', async () => {
    const response = await request(app).get('/products/by-sku/SKU-404').set('x-org-id', 'org-1');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: 'Product not found' });
  });

  it('returns product for GET /products/by-sku/:sku when found', async () => {
    mockProductService.getProductBySku.mockResolvedValue(baseProduct);

    const response = await request(app).get('/products/by-sku/SKU-42').set('x-org-id', 'org-1');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(baseProduct);
  });

  it('returns 401 on export-excess when organizationId is missing', async () => {
    const response = await request(app).get('/products/export-excess');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: 'Organization context missing' });
    expect(mockProductService.getExcessProductsView).not.toHaveBeenCalled();
  });

  it('returns 404 on export-excess when subscription is missing', async () => {
    mockProductService.getExcessProductsView.mockRejectedValue(
      new NotFoundError('Subscription not found'),
    );

    const response = await request(app).get('/products/export-excess').set('x-org-id', 'org-1');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: 'Subscription not found' });
  });

  it('returns unlimited response on export-excess for premium tier', async () => {
    mockProductService.getExcessProductsView.mockResolvedValue({
      tier: 'premium',
      maxSkus: null,
      currentSkus: 0,
      excessCount: 0,
      products: [],
    });

    const response = await request(app).get('/products/export-excess').set('x-org-id', 'org-1');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      metadata: {
        organizationId: 'org-1',
        tier: 'premium',
        maxSkus: null,
        currentSkus: 0,
        excessCount: 0,
      },
      products: [],
    });
  });

  it('returns within-limits response on export-excess when no overage exists', async () => {
    mockProductService.getExcessProductsView.mockResolvedValue({
      tier: 'professional',
      maxSkus: 2000,
      currentSkus: 2000,
      excessCount: 0,
      products: [],
    });

    const response = await request(app).get('/products/export-excess').set('x-org-id', 'org-1');

    expect(response.status).toBe(200);
    expect(response.body.metadata.excessCount).toBe(0);
    expect(response.body.products).toEqual([]);
  });

  it('returns JSON excess products payload on export-excess', async () => {
    mockProductService.getExcessProductsView.mockResolvedValue({
      tier: 'professional',
      maxSkus: 2000,
      currentSkus: 2005,
      excessCount: 5,
      products: [
        {
          id: 1,
          sku: 'SKU-1',
          name: 'Excess Product 1',
          barcode: '1111111111111',
          costPrice: 10.5,
          createdAt: '2026-02-01T00:00:00.000Z',
          inventoryCount: 3,
        },
      ],
    });

    const response = await request(app).get('/products/export-excess').set('x-org-id', 'org-1');

    expect(response.status).toBe(200);
    expect(response.body.metadata.organizationId).toBe('org-1');
    expect(response.body.metadata.excessCount).toBeGreaterThan(0);
    expect(response.body.products).toHaveLength(1);
    expect(response.body.products[0].sku).toBe('SKU-1');
  });

  it('returns CSV excess products payload when Accept header requests csv', async () => {
    mockProductService.getExcessProductsView.mockResolvedValue({
      tier: 'professional',
      maxSkus: 2000,
      currentSkus: 2005,
      excessCount: 5,
      products: [
        {
          id: 1,
          sku: 'SKU-1',
          name: 'Excess Product 1',
          barcode: '1111111111111',
          costPrice: 10.5,
          createdAt: '2026-02-01T00:00:00.000Z',
          inventoryCount: 3,
        },
      ],
    });

    const response = await request(app)
      .get('/products/export-excess')
      .set('x-org-id', 'org-1')
      .set('Accept', 'text/csv');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain(
      'attachment; filename="excess-products-org-1.csv"',
    );
    expect(response.text).toContain('id,sku,name,barcode,costPrice,createdAt,inventoryCount');
    expect(response.text).toContain('SKU-1');
  });

  it('returns 500 on export-excess when data retrieval throws', async () => {
    mockProductService.getExcessProductsView.mockRejectedValue(new Error('tier lookup failed'));

    const response = await request(app).get('/products/export-excess').set('x-org-id', 'org-1');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ message: 'tier lookup failed' });
  });

  it('returns 400 for GET /products/:id when id is invalid', async () => {
    const response = await request(app).get('/products/not-a-number').set('x-org-id', 'org-1');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'Invalid product id' });
  });

  it('returns 404 for GET /products/:id when product does not exist', async () => {
    const response = await request(app).get('/products/99').set('x-org-id', 'org-1');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: 'Product not found' });
  });

  it('returns 403 for GET /products/:id when product belongs to another org', async () => {
    mockProductService.getProductById.mockResolvedValue({
      ...baseProduct,
      organizationId: 'org-2',
    });

    const response = await request(app).get('/products/42').set('x-org-id', 'org-1');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      message: 'Access denied: Product belongs to different organization',
    });
  });

  it('returns product for GET /products/:id when requester owns it', async () => {
    mockProductService.getProductById.mockResolvedValue(baseProduct);

    const response = await request(app).get('/products/42').set('x-org-id', 'org-1');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(baseProduct);
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

  it('returns 400 on create product when required fields are missing', async () => {
    const response = await request(app).post('/products').set('x-org-id', 'org-1').send({
      barcode: '1234567890',
      sku: 'SKU-1',
      name: 'Missing Cost',
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'Missing required product fields' });
  });

  it('creates a product on POST /products when payload is valid', async () => {
    const response = await request(app).post('/products').set('x-org-id', 'org-1').send({
      barcode: '1234567890',
      sku: 'SKU-NEW',
      name: 'Created Product',
      costPrice: 15.5,
    });

    expect(response.status).toBe(201);
    expect(response.body.id).toBe(100);
    expect(mockProductService.createProduct).toHaveBeenCalledWith(
      expect.objectContaining({ sku: 'SKU-NEW' }),
    );
  });

  it('returns 500 on create product when service throws', async () => {
    mockProductService.createProduct.mockRejectedValue(new Error('create failed'));

    const response = await request(app).post('/products').set('x-org-id', 'org-1').send({
      barcode: '1234567890',
      sku: 'SKU-NEW',
      name: 'Created Product',
      costPrice: 15.5,
    });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ message: 'create failed' });
  });

  it('returns 400 for PUT /products/:id when id is invalid', async () => {
    const response = await request(app)
      .put('/products/not-a-number')
      .set('x-org-id', 'org-1')
      .send({ name: 'Updated Name' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'Invalid product id' });
  });

  it('returns 404 for PUT /products/:id when product does not exist', async () => {
    const response = await request(app)
      .put('/products/42')
      .set('x-org-id', 'org-1')
      .send({ name: 'Updated Name' });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: 'Product not found' });
  });

  it('returns 403 for PUT /products/:id when product belongs to another org', async () => {
    mockProductService.getProductById.mockResolvedValue({
      ...baseProduct,
      organizationId: 'org-2',
    });

    const response = await request(app)
      .put('/products/42')
      .set('x-org-id', 'org-1')
      .send({ name: 'Updated Name' });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      message: 'Access denied: Product belongs to different organization',
    });
  });

  it('returns 404 for PUT /products/:id when update result is null', async () => {
    mockProductService.getProductById.mockResolvedValue(baseProduct);
    mockProductService.updateProduct.mockResolvedValue(null);

    const response = await request(app)
      .put('/products/42')
      .set('x-org-id', 'org-1')
      .send({ name: 'Updated Name' });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: 'Product not found' });
  });

  it('updates a product on PUT /products/:id when payload is valid', async () => {
    mockProductService.getProductById.mockResolvedValue(baseProduct);
    mockProductService.updateProduct.mockResolvedValue({ ...baseProduct, name: 'Updated Name' });

    const response = await request(app)
      .put('/products/42')
      .set('x-org-id', 'org-1')
      .send({ name: 'Updated Name' });

    expect(response.status).toBe(200);
    expect(response.body.name).toBe('Updated Name');
  });

  it('returns 400 for DELETE /products/:id when id is invalid', async () => {
    const response = await request(app).delete('/products/not-a-number').set('x-org-id', 'org-1');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'Invalid product id' });
  });

  it('returns 404 for DELETE /products/:id when product does not exist', async () => {
    const response = await request(app).delete('/products/42').set('x-org-id', 'org-1');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: 'Product not found' });
  });

  it('returns 403 for DELETE /products/:id when product belongs to another org', async () => {
    mockProductService.getProductById.mockResolvedValue({
      ...baseProduct,
      organizationId: 'org-2',
    });

    const response = await request(app).delete('/products/42').set('x-org-id', 'org-1');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      message: 'Access denied: Product belongs to different organization',
    });
  });

  it('returns 404 for DELETE /products/:id when delete returns false', async () => {
    mockProductService.getProductById.mockResolvedValue(baseProduct);
    mockProductService.deleteProduct.mockResolvedValue(false);

    const response = await request(app).delete('/products/42').set('x-org-id', 'org-1');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: 'Product not found' });
  });

  it('deletes product on DELETE /products/:id when request is valid', async () => {
    mockProductService.getProductById.mockResolvedValue(baseProduct);
    mockProductService.deleteProduct.mockResolvedValue(true);

    const response = await request(app).delete('/products/42').set('x-org-id', 'org-1');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: 'Product deleted successfully' });
  });

  it('returns 400 on upload-csv when no file is provided', async () => {
    const response = await request(app).post('/products/upload-csv').set('x-org-id', 'org-1');

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('No file provided');
  });

  it('configures multer with the default 10MB upload limit', () => {
    expect(capturedMulterOptions).toEqual(
      expect.objectContaining({
        limits: { fileSize: 10 * 1024 * 1024 },
      }),
    );
  });

  it('returns 400 on upload-csv when multer rejects an oversized file', async () => {
    const response = await request(app)
      .post('/products/upload-csv')
      .set('x-org-id', 'org-1')
      .set('x-upload-mode', 'too-large');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      message: 'File too large. Maximum upload size is 10MB.',
    });
    expect(mockProductService.processCSVUpload).not.toHaveBeenCalled();
  });

  it('returns a canonical 400 when multer rejects an invalid file type', async () => {
    const response = await request(app)
      .post('/products/upload-csv')
      .set('x-org-id', 'org-1')
      .set('x-upload-mode', 'invalid-type-code');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      message: 'Invalid file type. Only CSV, XLSX, and XLS files are allowed.',
    });
    expect(mockProductService.processCSVUpload).not.toHaveBeenCalled();
  });

  it('returns 400 on upload-csv when file path fails safety check', async () => {
    const response = await request(app)
      .post('/products/upload-csv')
      .set('x-org-id', 'org-1')
      .set('x-upload-mode', 'invalid-path');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      message: 'Invalid file path',
    });
    expect(mockProductService.processCSVUpload).not.toHaveBeenCalled();
  });

  it('returns successful upload summary when CSV processing succeeds with no row errors', async () => {
    const absolutePath = path.resolve('uploads', 'products-upload.csv');

    const response = await request(app)
      .post('/products/upload-csv')
      .set('x-org-id', 'org-1')
      .set('x-upload-mode', 'valid');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      message: 'CSV processed successfully',
      imported: 1,
      updated: 0,
    });
    expect(mockProductService.processCSVUpload).toHaveBeenCalledWith(
      absolutePath,
      'products-upload.csv',
    );
  });

  it('returns successful upload summary when XLSX processing succeeds within the limit', async () => {
    const absolutePath = path.resolve('uploads', 'products-upload.xlsx');

    const response = await request(app)
      .post('/products/upload-csv')
      .set('x-org-id', 'org-1')
      .set('x-upload-mode', 'valid-xlsx');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      message: 'CSV processed successfully',
      imported: 1,
      updated: 0,
    });
    expect(mockProductService.processCSVUpload).toHaveBeenCalledWith(
      absolutePath,
      'products-upload.xlsx',
    );
  });

  it('returns partial-success upload summary when CSV processor reports row errors', async () => {
    mockProductService.processCSVUpload.mockResolvedValue({
      imported: 2,
      updated: 1,
      errors: ['Row 3: SKU missing'],
    });

    const response = await request(app)
      .post('/products/upload-csv')
      .set('x-org-id', 'org-1')
      .set('x-upload-mode', 'valid');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(false);
    expect(response.body.errors).toEqual(['Row 3: SKU missing']);
  });

  it('returns 500 on upload-csv when processor throws', async () => {
    mockProductService.processCSVUpload.mockRejectedValue(new Error('upload failed'));

    const response = await request(app)
      .post('/products/upload-csv')
      .set('x-org-id', 'org-1')
      .set('x-upload-mode', 'valid');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ message: 'upload failed' });
  });

  it('returns success when uploaded temp file cleanup is not part of route verification', async () => {
    const unlinkError = new Error('permission denied') as NodeJS.ErrnoException;
    mockUnlink.mockImplementationOnce(
      (_filePath: string, cb: (error: NodeJS.ErrnoException | null) => void) => {
        cb(unlinkError);
      },
    );

    const response = await request(app)
      .post('/products/upload-csv')
      .set('x-org-id', 'org-1')
      .set('x-upload-mode', 'valid');

    expect(response.status).toBe(200);
    expect(mockProductService.processCSVUpload).toHaveBeenCalled();
  });

  it('does not delete when finalizer sees invalid upload path', async () => {
    const response = await request(app)
      .post('/products/upload-csv')
      .set('x-org-id', 'org-1')
      .set('x-upload-mode', 'invalid-path');

    expect(response.status).toBe(400);
    expect(mockUnlink).not.toHaveBeenCalled();
  });
});
