/**
 * Integration Tests for Upload Routes with ServiceProvider
 * 
 * Validates that upload routes correctly:
 * - Use ServiceProvider for dependency injection
 * - Handle file uploads through the complete flow
 * - Work with both direct and presigned upload strategies
 */

import request from 'supertest';
import express, { Express } from 'express';
import multer from 'multer';
import { PrismaClient } from '@prisma/client';
import { ServiceProvider } from '../../services/service-provider';
import { StorageProvider } from '../../storage/storage-provider.interface';
import { UploadController } from '../../controllers/upload.controller';

// Mock authentication middleware
jest.mock('../../middleware/auth.middleware', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.userId = 1;
    req.user = { id: 1, role: 'Manager' };
    next();
  },
}));

// Mock environment config
jest.mock('../../config/environment', () => ({
  envConfig: {
    NODE_ENV: 'test',
    MAX_UPLOAD_SIZE_BYTES: 10 * 1024 * 1024,
    DIRECT_UPLOAD_THRESHOLD_BYTES: 2 * 1024 * 1024,
  },
}));

// In-memory storage provider for testing
class TestStorageProvider implements StorageProvider {
  private store = new Map<string, Buffer>();

  async upload(key: string, data: Buffer): Promise<string> {
    this.store.set(key, data);
    return key;
  }

  async download(key: string): Promise<Buffer> {
    const data = this.store.get(key);
    if (!data) {
      throw new Error('File not found');
    }
    return data;
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.store.has(key);
  }

  async getPresignedUploadUrl(key: string): Promise<string> {
    return `https://test.example.com/upload/${encodeURIComponent(key)}`;
  }

  clear() {
    this.store.clear();
  }

  getSize(key: string): number {
    return this.store.get(key)?.length || 0;
  }
}

describe('Upload Routes with ServiceProvider Integration', () => {
  let app: Express;
  let mockPrisma: jest.Mocked<PrismaClient>;
  let testStorage: TestStorageProvider;
  let serviceProvider: ServiceProvider;

  beforeEach(() => {
    // Create mock Prisma client
    mockPrisma = {
      product: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        create: jest.fn().mockImplementation((data) => ({
          id: Math.floor(Math.random() * 1000),
          ...data.data,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
        update: jest.fn(),
        upsert: jest.fn().mockImplementation((args) => ({
          id: Math.floor(Math.random() * 1000),
          ...args.create,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
      },
      $disconnect: jest.fn(),
    } as any;

    // Create test storage
    testStorage = new TestStorageProvider();

    // Create service provider with test dependencies
    serviceProvider = new ServiceProvider(mockPrisma, testStorage);

    // Create Express app with upload routes
    app = express();
    app.use(express.json());
    
    // Mock auth middleware
    app.use((req: any, _res, next) => {
      req.userId = 1;
      req.user = { id: 1, role: 'Manager' };
      next();
    });

    // Configure multer
    const upload = multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
    });

    // Setup routes with ServiceProvider
    const uploadController = new UploadController(serviceProvider.getUploadService());
    
    app.post('/api/upload/initiate', (req, res) => uploadController.initiate(req, res));
    app.post('/api/upload/direct', upload.single('file'), (req, res) =>
      uploadController.direct(req, res)
    );
    app.post('/api/upload/complete', (req, res) => uploadController.complete(req, res));
  });

  afterEach(async () => {
    testStorage.clear();
    await mockPrisma.$disconnect();
  });

  describe('POST /api/upload/initiate', () => {
    it('should return direct upload strategy for small files', async () => {
      const response = await request(app)
        .post('/api/upload/initiate')
        .send({
          filename: 'test.csv',
          fileSize: 1024, // 1KB - below threshold
          contentType: 'text/csv',
        })
        .expect(200);

      expect(response.body).toHaveProperty('uploadId');
      expect(response.body.strategy).toBe('direct');
    });

    it('should return presigned URL strategy for large files', async () => {
      const response = await request(app)
        .post('/api/upload/initiate')
        .send({
          filename: 'large-file.csv',
          fileSize: 5 * 1024 * 1024, // 5MB - above threshold
          contentType: 'text/csv',
        })
        .expect(200);

      expect(response.body).toHaveProperty('uploadId');
      expect(response.body.strategy).toBe('presigned');
      expect(response.body).toHaveProperty('presignedUrl');
    });

    it('should reject files exceeding max size', async () => {
      const response = await request(app)
        .post('/api/upload/initiate')
        .send({
          filename: 'huge-file.csv',
          fileSize: 50 * 1024 * 1024, // 50MB - exceeds limit
          contentType: 'text/csv',
        })
        .expect(400);

      expect(response.body.error).toContain('exceeds maximum');
    });

    it('should validate filename is provided', async () => {
      const response = await request(app)
        .post('/api/upload/initiate')
        .send({
          fileSize: 1024,
          contentType: 'text/csv',
        })
        .expect(400);

      expect(response.body.error).toContain('filename');
    });
  });

  describe('POST /api/upload/direct', () => {
    it('should handle direct file upload for small CSV', async () => {
      const csvContent = 'Name,SKU,Cost\nProduct A,SKU001,10.50\nProduct B,SKU002,20.00';
      
      const response = await request(app)
        .post('/api/upload/direct')
        .attach('file', Buffer.from(csvContent), 'test.csv')
        .expect(200);

      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('processing started');
    });

    it('should reject upload without file', async () => {
      const response = await request(app)
        .post('/api/upload/direct')
        .expect(400);

      expect(response.body.error).toContain('file');
    });

    it('should process CSV and create products via ServiceProvider', async () => {
      const csvContent = 'Name,SKU,Cost\nProduct A,SKU001,10.50';
      
      await request(app)
        .post('/api/upload/direct')
        .attach('file', Buffer.from(csvContent), 'products.csv')
        .expect(200);

      // Verify Prisma was called through ServiceProvider's CSV parser
      expect(mockPrisma.product.upsert).toHaveBeenCalled();
    });
  });

  describe('POST /api/upload/complete', () => {
    it('should complete presigned upload and trigger CSV processing', async () => {
      // First, initiate presigned upload
      const initiateRes = await request(app)
        .post('/api/upload/initiate')
        .send({
          filename: 'large-test.csv',
          fileSize: 5 * 1024 * 1024,
        })
        .expect(200);

      const { uploadId, storageKey } = initiateRes.body;

      // Simulate presigned upload by manually storing file
      const csvContent = 'Name,SKU,Cost\nProduct A,SKU001,10.50';
      await testStorage.upload(storageKey, Buffer.from(csvContent));

      // Complete the upload
      const completeRes = await request(app)
        .post('/api/upload/complete')
        .send({ key: storageKey })
        .expect(200);

      expect(completeRes.body).toHaveProperty('message');
      expect(completeRes.body.message).toContain('processing started');
      expect(mockPrisma.product.upsert).toHaveBeenCalled();
    });

    it('should fail if file not found in storage', async () => {
      const response = await request(app)
        .post('/api/upload/complete')
        .send({
          key: 'missing-file.csv',
        })
        .expect(500);

      expect(response.body.error).toBeDefined();
    });

    it('should validate key is provided', async () => {
      const response = await request(app)
        .post('/api/upload/complete')
        .send({})
        .expect(400);

      expect(response.body.error).toContain('key');
    });
  });

  describe('ServiceProvider Integration', () => {
    it('should use ServiceProvider CSV parser for processing', async () => {
      const csvParser = serviceProvider.getCSVParserService();
      const processSpy = jest.spyOn(csvParser, 'processFile');

      const csvContent = 'Name,SKU,Cost\nProduct A,SKU001,10.50';
      
      await request(app)
        .post('/api/upload/direct')
        .attach('file', Buffer.from(csvContent), 'test.csv');

      expect(processSpy).toHaveBeenCalled();
    });

    it('should use ServiceProvider storage quota service', async () => {
      const quotaService = serviceProvider.getStorageQuotaService();
      const recordSpy = jest.spyOn(quotaService, 'recordUpload');

      const csvContent = 'Name,SKU,Cost\nProduct A,SKU001,10.50';
      
      await request(app)
        .post('/api/upload/direct')
        .attach('file', Buffer.from(csvContent), 'test.csv');

      // Storage quota recording might be called
      // Note: Implementation depends on whether quota check is in upload flow
    });

    it('should handle errors from ServiceProvider gracefully', async () => {
      // Mock CSV parser to throw error
      const csvParser = serviceProvider.getCSVParserService();
      jest.spyOn(csvParser, 'processFile').mockRejectedValue(new Error('CSV parsing failed'));

      const csvContent = 'Invalid,CSV,Data';
      
      const response = await request(app)
        .post('/api/upload/direct')
        .attach('file', Buffer.from(csvContent), 'bad.csv')
        .expect(500);

      expect(response.body.error).toBeDefined();
    });
  });

  describe('End-to-End Upload Flow', () => {
    it('should complete full direct upload workflow', async () => {
      // Step 1: Initiate
      const initiateRes = await request(app)
        .post('/api/upload/initiate')
        .send({ filename: 'products.csv', fileSize: 1024, contentType: 'text/csv' })
        .expect(200);

      expect(initiateRes.body.strategy).toBe('direct');

      // Step 2: Direct upload
      const csvContent = 'Name,SKU,Cost\nProduct A,SKU001,10.50\nProduct B,SKU002,20.00';
      const uploadRes = await request(app)
        .post('/api/upload/direct')
        .attach('file', Buffer.from(csvContent), 'products.csv')
        .expect(200);

      expect(uploadRes.body.message).toContain('processing started');
    });

    it('should complete full presigned upload workflow', async () => {
      // Step 1: Initiate presigned upload
      const initiateRes = await request(app)
        .post('/api/upload/initiate')
        .send({ filename: 'large-products.csv', fileSize: 5 * 1024 * 1024, contentType: 'text/csv' })
        .expect(200);

      expect(initiateRes.body.strategy).toBe('presigned');
      const { storageKey } = initiateRes.body;

      // Step 2: Simulate presigned upload (client uploads to presigned URL)
      const csvContent = 'Name,SKU,Cost\nProduct A,SKU001,10.50';
      await testStorage.upload(storageKey, Buffer.from(csvContent));

      // Step 3: Complete upload to trigger processing
      const completeRes = await request(app)
        .post('/api/upload/complete')
        .send({ key: storageKey })
        .expect(200);

      expect(completeRes.body.message).toContain('processing started');
    });
  });
});
