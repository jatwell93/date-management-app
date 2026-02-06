/**
 * Load Test for Concurrent Uploads
 *
 * Runs 1000 concurrent direct uploads against an in-memory Express app.
 * Opt-in only: set RUN_UPLOAD_LOAD_TESTS=true to execute.
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

  app.post('/api/upload/direct', upload.single('file'), (req, res) => controller.direct(req, res));

  return app;
};

const shouldRun = process.env.RUN_UPLOAD_LOAD_TESTS === 'true';
const describeMaybe = shouldRun ? describe : describe.skip;

describeMaybe('Upload Load Test', () => {
  it('handles 1000 concurrent direct uploads', async () => {
    const storage = new InMemoryStorageProvider();
    const csvParser = { processFile: jest.fn().mockResolvedValue({ imported: 1, errors: [] }) };

    const app = createTestApp(storage, csvParser);

    const fileBuffer = Buffer.from('SKU,Name,Cost,Barcode\nSKU1,Test,1.00,123\n');
    const requests = Array.from({ length: 1000 }, () =>
      request(app)
        .post('/api/upload/direct')
        .attach('file', fileBuffer, 'upload.csv')
        .then((res) => res.status),
    );

    const statuses = await Promise.all(requests);
    const failures = statuses.filter((status) => status !== 200);

    expect(failures.length).toBe(0);
    expect(csvParser.processFile).toHaveBeenCalledTimes(1000);
  }, 120000);
});
