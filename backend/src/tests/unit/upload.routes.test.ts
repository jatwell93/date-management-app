import express from 'express';
import request from 'supertest';

const mockInitiate = vi.fn();
const mockDirect = vi.fn();
const mockComplete = vi.fn();
const mockStatus = vi.fn();
const mockCreateUploadControllerForRequest = vi.fn();

// These mocks are invoked at the SUT's module-load time (the router calls
// checkUsageLimit()/validateRequest() to build middleware), so they must exist
// before the hoisted vi.mock factories run. Vitest auto-hoists bare `vi.fn()`
// consts but NOT chained `.mockImplementation(...)` ones — wrap in vi.hoisted().
const mockCheckUsageLimit = vi.hoisted(() =>
  vi.fn().mockImplementation(() => (_req: any, _res: any, next: any) => next()),
);

const mockValidateRequest = vi.hoisted(() =>
  vi.fn().mockImplementation(() => (_req: any, _res: any, next: any) => next()),
);

vi.mock('../../middleware/auth.middleware', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.organizationId = req.get('x-org-id') || 'org-upload-test';
    const userIdHeader = req.get('x-user-id');
    req.userId = userIdHeader ? Number(userIdHeader) : 101;
    next();
  },
}));

vi.mock('../../middleware/feature-gate.middleware', () => ({
  checkUsageLimit: (...args: unknown[]) => mockCheckUsageLimit(...args),
}));

vi.mock('../../middleware/rateLimiter', () => ({
  uploadLimiter: (_req: any, _res: any, next: any) => next(),
  presignedUrlLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../middleware/validateRequest', () => ({
  validateRequest: (...args: unknown[]) => mockValidateRequest(...args),
}));

vi.mock('../../controllers/upload.controller', () => ({
  createUploadControllerForRequest: (...args: unknown[]) =>
    mockCreateUploadControllerForRequest(...args),
}));

import uploadRouter from '../../routes/upload.routes';

describe('upload.routes', () => {
  const app = express();
  app.use(express.json());
  app.use('/upload', uploadRouter);
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err?.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'File too large' });
    }

    return res.status(500).json({ error: err?.message || 'Internal server error' });
  });

  beforeEach(() => {
    mockInitiate.mockReset();
    mockDirect.mockReset();
    mockComplete.mockReset();
    mockStatus.mockReset();
    mockCreateUploadControllerForRequest.mockReset();
    mockValidateRequest.mockClear();

    mockInitiate.mockImplementation(async (_req: any, res: express.Response) => {
      res.status(200).json({ route: 'initiate' });
    });

    mockDirect.mockImplementation(async (_req: any, res: express.Response) => {
      res.status(200).json({ route: 'direct' });
    });

    mockComplete.mockImplementation(async (_req: any, res: express.Response) => {
      res.status(200).json({ route: 'complete' });
    });

    mockStatus.mockImplementation(async (_req: any, res: express.Response) => {
      res.status(200).json({ route: 'status' });
    });

    mockCreateUploadControllerForRequest.mockReturnValue({
      initiate: (...args: unknown[]) => mockInitiate(...args),
      direct: (...args: unknown[]) => mockDirect(...args),
      complete: (...args: unknown[]) => mockComplete(...args),
      status: (...args: unknown[]) => mockStatus(...args),
    });
  });

  it('registers storage usage guard for upload write endpoints', () => {
    expect(mockCheckUsageLimit).toHaveBeenCalledTimes(3);
    expect(mockCheckUsageLimit).toHaveBeenNthCalledWith(1, 'storage_bytes');
    expect(mockCheckUsageLimit).toHaveBeenNthCalledWith(2, 'storage_bytes');
    expect(mockCheckUsageLimit).toHaveBeenNthCalledWith(3, 'storage_bytes');
  });

  it('delegates POST /upload/initiate to UploadController.initiate with organization context', async () => {
    const response = await request(app)
      .post('/upload/initiate')
      .set('x-org-id', 'org-alpha')
      .set('x-user-id', '77')
      .send({ filename: 'products.csv', fileSize: 5120, contentType: 'text/csv' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ route: 'initiate' });
    expect(mockCreateUploadControllerForRequest).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-alpha' }),
    );
    expect(mockInitiate).toHaveBeenCalledTimes(1);
  });

  it('delegates POST /upload/direct to UploadController.direct for multipart requests', async () => {
    const response = await request(app)
      .post('/upload/direct')
      .set('x-org-id', 'org-alpha')
      .set('x-user-id', '77')
      .field('importType', 'inventory')
      .attach('file', Buffer.from('sku,name,cost,barcode\nABC,Product,12.99,123456'), 'items.csv');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ route: 'direct' });
    expect(mockCreateUploadControllerForRequest).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-alpha' }),
    );
    expect(mockDirect).toHaveBeenCalledTimes(1);
  });

  it('rejects direct uploads larger than 10MB before controller execution', async () => {
    const oversizedBuffer = Buffer.alloc(10 * 1024 * 1024 + 1, 'a');

    const response = await request(app)
      .post('/upload/direct')
      .set('x-org-id', 'org-alpha')
      .set('x-user-id', '77')
      .attach('file', oversizedBuffer, 'too-large.csv');

    expect(response.status).toBe(413);
    expect(response.body).toEqual({ error: 'File too large' });
    expect(mockDirect).not.toHaveBeenCalled();
  });

  it('delegates POST /upload/complete to UploadController.complete', async () => {
    const response = await request(app)
      .post('/upload/complete')
      .set('x-org-id', 'org-alpha')
      .set('x-user-id', '77')
      .send({ key: 'uploads/org-alpha/items.csv' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ route: 'complete' });
    expect(mockCreateUploadControllerForRequest).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-alpha' }),
    );
    expect(mockComplete).toHaveBeenCalledTimes(1);
  });

  it('delegates GET /upload/status/:key to UploadController.status', async () => {
    const encodedKey = encodeURIComponent('uploads/org-alpha/items.csv');

    const response = await request(app)
      .get(`/upload/status/${encodedKey}`)
      .set('x-org-id', 'org-alpha')
      .set('x-user-id', '77');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ route: 'status' });
    expect(mockCreateUploadControllerForRequest).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-alpha' }),
    );
    expect(mockStatus).toHaveBeenCalledTimes(1);
  });
});
