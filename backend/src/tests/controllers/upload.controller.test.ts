/* eslint-disable @typescript-eslint/no-explicit-any */
import request from 'supertest';
import express from 'express';
import { UploadController } from '../../controllers/upload.controller';
import { UploadService } from '../../services/upload.service';
import { authenticateToken } from '../../middleware/auth.middleware';

// Mock dependencies
const mockUploadService = {
  initiateUpload: jest.fn(),
  completeUpload: jest.fn(),
  handleDirectUpload: jest.fn(),
} as unknown as jest.Mocked<UploadService>;

// Mock middleware
jest.mock('../../middleware/auth.middleware', () => ({
  authenticateToken: (req: any, res: any, next: any) => {
    req.user = { id: 1, email: 'test@example.com' };
    req.userId = 1;
    req.organizationId = 'org-123';
    next();
  },
}));

// Mock Multer middleware logic manually for test since we didn't setup multer in test app
// We will manually inject req.file in the request using supertest if possible or mock the route handler
// But simpler: just mock the call to direct() on controller if we were unit testing controller.
// Since this is integration, we need to populate req.file.
// Supertest attach() sends multipart. Without actual multer middleware, req.file won't be populated.
// So we need to add a dummy middleware to populate req.file for testing purposes.
const mockMulterMiddleware = (req: any, res: any, next: any) => {
  if (req.headers['content-type'] && req.headers['content-type'].includes('multipart/form-data')) {
    req.body = req.body || {};
    if (typeof req.headers['x-import-type'] === 'string') {
      req.body.importType = req.headers['x-import-type'];
    }
    req.file = {
      originalname: 'direct.csv',
      mimetype: 'text/csv',
      buffer: Buffer.from('test data'),
    };
  }
  next();
};

const app = express();
app.use(express.json());

// Setup controller and routes for testing
const uploadController = new UploadController(mockUploadService);
const router = express.Router();
router.post('/initiate', authenticateToken, (req, res) => uploadController.initiate(req, res));
router.post('/complete', authenticateToken, (req, res) => uploadController.complete(req, res));
router.post('/direct', authenticateToken, mockMulterMiddleware, (req, res) =>
  uploadController.direct(req, res),
);

app.use('/api/upload', router);

describe('UploadRoutes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/upload/initiate', () => {
    it('should return strategy from service', async () => {
      const mockResponse = {
        strategy: 'presigned',
        uploadUrl: 'https://r2.example.com/upload',
        method: 'PUT',
        key: 'uploads/file.csv',
      };
      (mockUploadService.initiateUpload as jest.Mock).mockResolvedValue(mockResponse);

      const res = await request(app)
        .post('/api/upload/initiate')
        .send({ filename: 'file.csv', fileSize: 1024, contentType: 'text/csv' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockResponse);
      expect(mockUploadService.initiateUpload).toHaveBeenCalledWith('file.csv', 1024, 'text/csv');
    });

    it('should forward importType when provided', async () => {
      const mockResponse = {
        strategy: 'direct',
        uploadUrl: '/api/upload/direct',
        method: 'POST',
        key: 'uploads/file.csv',
      };
      (mockUploadService.initiateUpload as jest.Mock).mockResolvedValue(mockResponse);

      const res = await request(app).post('/api/upload/initiate').send({
        filename: 'file.csv',
        fileSize: 1024,
        contentType: 'text/csv',
        importType: 'expiry-list',
      });

      expect(res.status).toBe(200);
      expect(mockUploadService.initiateUpload).toHaveBeenCalledWith(
        'file.csv',
        1024,
        'text/csv',
        'expiry-list',
      );
    });

    it('should return 400 for invalid input', async () => {
      const res = await request(app).post('/api/upload/initiate').send({ filename: 'file.csv' }); // Missing fileSize/contentType

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/upload/complete', () => {
    it('should call service completeUpload', async () => {
      (mockUploadService.completeUpload as jest.Mock).mockResolvedValue(undefined);

      const res = await request(app)
        .post('/api/upload/complete')
        .send({ key: 'uploads/org-123/file.csv' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'Upload completed and processing started' });
      expect(mockUploadService.completeUpload).toHaveBeenCalledWith('uploads/org-123/file.csv', 1);
    });

    it('should forward importType to completeUpload when provided', async () => {
      (mockUploadService.completeUpload as jest.Mock).mockResolvedValue(undefined);

      const res = await request(app)
        .post('/api/upload/complete')
        .send({ key: 'uploads/org-123/file.csv', importType: 'expiry-list' });

      expect(res.status).toBe(200);
      expect(mockUploadService.completeUpload).toHaveBeenCalledWith(
        'uploads/org-123/file.csv',
        1,
        'expiry-list',
      );
    });

    it('should return expiry import summary payload when importType is expiry-list', async () => {
      (mockUploadService.completeUpload as jest.Mock).mockResolvedValue({
        importType: 'expiry-list',
        totalRows: 3,
        importedCount: 2,
        updatedCount: 1,
        skippedCount: 1,
        errorCount: 1,
        rejectedRows: [
          {
            rowNumber: 3,
            rawValues: {
              sku: 'SKU-3',
              itemDescription: 'Bad Date',
              usedByDate: '12/12',
            },
            reason: 'year-missing-or-ambiguous: Date must include a year for day/month format',
            reasonCode: 'year-missing-or-ambiguous',
          },
        ],
      });

      const res = await request(app)
        .post('/api/upload/complete')
        .send({ key: 'uploads/org-123/file.csv', importType: 'expiry-list' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        message: 'Upload completed and processing started',
        importedCount: 2,
        mergedCount: 1,
        rejectedCount: 1,
        rejectedRows: [
          {
            rowNumber: 3,
            rawValues: {
              sku: 'SKU-3',
              itemDescription: 'Bad Date',
              usedByDate: '12/12',
            },
            reason: 'year-missing-or-ambiguous: Date must include a year for day/month format',
            reasonCode: 'year-missing-or-ambiguous',
          },
        ],
      });
    });

    it('should preserve product-catalog response shape when importType is product-catalog', async () => {
      (mockUploadService.completeUpload as jest.Mock).mockResolvedValue({
        importType: 'product-catalog',
        totalRows: 2,
        importedCount: 2,
        updatedCount: 0,
        skippedCount: 0,
        errorCount: 0,
      });

      const res = await request(app)
        .post('/api/upload/complete')
        .send({ key: 'uploads/org-123/file.csv', importType: 'product-catalog' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'Upload completed and processing started' });
      expect(res.body.importedCount).toBeUndefined();
      expect(res.body.rejectedRows).toBeUndefined();
    });

    it('should return 400 if key is missing', async () => {
      const res = await request(app).post('/api/upload/complete').send({});

      expect(res.status).toBe(400);
    });

    it('should return 403 when service rejects cross-organization upload key', async () => {
      (mockUploadService.completeUpload as jest.Mock).mockRejectedValue(
        new Error('Access denied: Upload key does not belong to this organization'),
      );

      const res = await request(app)
        .post('/api/upload/complete')
        .send({ key: 'uploads/org-other/file.csv' });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({
        error: 'Access denied: Upload key does not belong to this organization',
      });
    });
  });

  describe('POST /api/upload/direct', () => {
    it('should call service handleDirectUpload', async () => {
      (mockUploadService.handleDirectUpload as jest.Mock).mockResolvedValue('uploads/key');

      const res = await request(app)
        .post('/api/upload/direct')
        // We set content-type to multipart to trigger our mock middleware
        .set('Content-Type', 'multipart/form-data; boundary=---boundary')
        .send(
          '---boundary\r\nContent-Disposition: form-data; name="file"; filename="direct.csv"\r\n\r\ntest data\r\n---boundary--',
        );

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        message: 'File uploaded and processing started',
        key: 'uploads/key',
      });
      expect(mockUploadService.handleDirectUpload).toHaveBeenCalledWith(
        expect.any(Buffer),
        'direct.csv',
        'text/csv',
        1,
      );
    });

    it('should forward importType from multipart body when present', async () => {
      (mockUploadService.handleDirectUpload as jest.Mock).mockResolvedValue('uploads/key');

      const res = await request(app)
        .post('/api/upload/direct')
        .set('x-import-type', 'expiry-list')
        .set('Content-Type', 'multipart/form-data; boundary=---boundary')
        .send(
          '---boundary\r\nContent-Disposition: form-data; name="file"; filename="direct.csv"\r\n\r\ntest data\r\n---boundary--',
        );

      expect(res.status).toBe(200);
      expect(mockUploadService.handleDirectUpload).toHaveBeenCalledWith(
        expect.any(Buffer),
        'direct.csv',
        'text/csv',
        1,
        'expiry-list',
      );
    });

    it('should return expiry direct-upload summary payload', async () => {
      (mockUploadService.handleDirectUpload as jest.Mock).mockResolvedValue({
        key: 'uploads/key',
        processingResult: {
          importType: 'expiry-list',
          totalRows: 2,
          importedCount: 1,
          updatedCount: 1,
          skippedCount: 0,
          errorCount: 0,
          rejectedRows: [],
        },
      });

      const res = await request(app)
        .post('/api/upload/direct')
        .set('x-import-type', 'expiry-list')
        .set('Content-Type', 'multipart/form-data; boundary=---boundary')
        .send(
          '---boundary\r\nContent-Disposition: form-data; name="file"; filename="direct.csv"\r\n\r\ntest data\r\n---boundary--',
        );

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        message: 'File uploaded and processing started',
        key: 'uploads/key',
        importedCount: 1,
        mergedCount: 1,
        rejectedCount: 0,
        rejectedRows: [],
      });
    });

    it('should preserve product-catalog direct response shape when service returns processing details', async () => {
      (mockUploadService.handleDirectUpload as jest.Mock).mockResolvedValue({
        key: 'uploads/key',
        processingResult: {
          importType: 'product-catalog',
          totalRows: 2,
          importedCount: 2,
          updatedCount: 0,
          skippedCount: 0,
          errorCount: 0,
        },
      });

      const res = await request(app)
        .post('/api/upload/direct')
        .set('x-import-type', 'product-catalog')
        .set('Content-Type', 'multipart/form-data; boundary=---boundary')
        .send(
          '---boundary\r\nContent-Disposition: form-data; name="file"; filename="direct.csv"\r\n\r\ntest data\r\n---boundary--',
        );

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        message: 'File uploaded and processing started',
        key: 'uploads/key',
      });
      expect(res.body.importedCount).toBeUndefined();
      expect(res.body.rejectedRows).toBeUndefined();
    });

    it('should return 400 if no file', async () => {
      // No multipart header, so mock middleware won't add req.file
      const res = await request(app).post('/api/upload/direct').send({});

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'No file uploaded' });
    });
  });
});
