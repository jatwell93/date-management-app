/**
 * End-to-End Tests for CSV Upload Flow
 *
 * Validates initiate -> direct upload -> complete flow using in-memory storage.
 */

import request from 'supertest';
import express from 'express';
import multer from 'multer';
import { UploadController } from '../../controllers/upload.controller';
import { UploadService } from '../../services/upload.service';
import { StorageProvider } from '../../storage/storage-provider.interface';

jest.mock('../../config/environment', () => ({
  envConfig: {
    NODE_ENV: 'development',
    MAX_UPLOAD_SIZE_BYTES: 10 * 1024 * 1024,
    DIRECT_UPLOAD_THRESHOLD_BYTES: 2 * 1024 * 1024,
  },
}));

jest.mock('../../middleware/auth.middleware', () => ({
  authenticateToken: (_req: any, _res: any, next: any) => next(),
}));

class InMemoryStorageProvider implements StorageProvider {
  private store = new Map<string, Buffer>();

  async upload(key: string, data: Buffer): Promise<string> {
    this.store.set(key, data);
    return key;
  }

  async download(key: string): Promise<Buffer> {
    const data = this.store.get(key);
    if (!data) {
      throw new Error('NotFound');
    }
    return data;
  }

  async delete(key: string): Promise<void> {
    if (!this.store.has(key)) {
      throw new Error('NotFound');
    }
    this.store.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.store.has(key);
  }

  async getPresignedUploadUrl(key: string): Promise<string> {
    return `https://example.test/presigned/${encodeURIComponent(key)}`;
  }
}

const createTestApp = (storage: StorageProvider, csvParser: { processFile: jest.Mock }) => {
  const app = express();
  app.use(express.json());

  const upload = multer({ storage: multer.memoryStorage() });
  const uploadService = new UploadService(storage, csvParser as any);
  const controller = new UploadController(uploadService);

  app.post('/api/upload/initiate', (req, res) => controller.initiate(req, res));
  app.post('/api/upload/direct', upload.single('file'), (req, res) => controller.direct(req, res));
  app.post('/api/upload/complete', (req, res) => controller.complete(req, res));

  return app;
};

const getEnvConfig = () =>
  require('../../config/environment').envConfig as {
    NODE_ENV: string;
    MAX_UPLOAD_SIZE_BYTES: number;
    DIRECT_UPLOAD_THRESHOLD_BYTES: number;
  };

describe('CSV Upload Flow', () => {
  beforeEach(() => {
    const envConfig = getEnvConfig();
    envConfig.NODE_ENV = 'development';
    envConfig.DIRECT_UPLOAD_THRESHOLD_BYTES = 2 * 1024 * 1024;
  });

  it('supports direct upload flow end-to-end', async () => {
    const storage = new InMemoryStorageProvider();
    const csvParser = { processFile: jest.fn().mockResolvedValue({ imported: 1, errors: [] }) };

    const app = createTestApp(storage, csvParser);

    const initiateRes = await request(app)
      .post('/api/upload/initiate')
      .send({ filename: 'valid-products.csv', fileSize: 1024, contentType: 'text/csv' });

    expect(initiateRes.status).toBe(200);
    expect(initiateRes.body.strategy).toBe('direct');

    const directRes = await request(app)
      .post('/api/upload/direct')
      .attach('file', Buffer.from('SKU,Name,Cost,Barcode\nSKU1,Test,1.00,123\n'), 'upload.csv');

    expect(directRes.status).toBe(200);
    expect(csvParser.processFile).toHaveBeenCalledTimes(1);
  });

  it('supports presigned upload + complete flow', async () => {
    const envConfig = getEnvConfig();
    envConfig.NODE_ENV = 'production';
    envConfig.DIRECT_UPLOAD_THRESHOLD_BYTES = 1024; // Force presigned for 2KB file

    const storage = new InMemoryStorageProvider();
    const csvParser = { processFile: jest.fn().mockResolvedValue({ imported: 1, errors: [] }) };

    const app = createTestApp(storage, csvParser);

    const initiateRes = await request(app)
      .post('/api/upload/initiate')
      .send({ filename: 'valid-products.csv', fileSize: 2048, contentType: 'text/csv' });

    expect(initiateRes.status).toBe(200);
    expect(initiateRes.body.strategy).toBe('presigned');
    expect(initiateRes.body.uploadUrl).toContain('https://example.test/presigned/');

    const key = initiateRes.body.key as string;
    await storage.upload(key, Buffer.from('SKU,Name,Cost,Barcode\nSKU2,Test,2.00,456\n'));

    const completeRes = await request(app)
      .post('/api/upload/complete')
      .send({ key });

    expect(completeRes.status).toBe(200);
    expect(csvParser.processFile).toHaveBeenCalledTimes(1);
  });
});
