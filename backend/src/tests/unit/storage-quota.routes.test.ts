import express from 'express';
import request from 'supertest';

const mockGetStorageQuota = jest.fn();
const mockCanUploadFile = jest.fn();

const mockStorageQuotaServiceCtor = jest.fn().mockImplementation((_organizationId?: string) => ({
  getStorageQuota: (...args: unknown[]) => mockGetStorageQuota(...args),
  canUploadFile: (...args: unknown[]) => mockCanUploadFile(...args),
}));

jest.mock('../../services/storage-quota.service', () => ({
  StorageQuotaService: function StorageQuotaService(...args: unknown[]) {
    return mockStorageQuotaServiceCtor(...args);
  },
}));

import storageQuotaRouter from '../../routes/storage-quota.routes';

describe('storage-quota.routes', () => {
  const app = express();

  // Mimic upstream auth middleware context using headers for route-only tests.
  app.use((req: any, _res, next) => {
    const userIdHeader = req.get('x-user-id');
    req.userId = userIdHeader ? Number(userIdHeader) : undefined;
    req.organizationId = req.get('x-org-id') || undefined;
    next();
  });

  app.use('/storage-quota', storageQuotaRouter);

  beforeEach(() => {
    jest.clearAllMocks();

    mockGetStorageQuota.mockResolvedValue({
      used: 500,
      limit: 1000,
      percentageUsed: 50,
      tier: 'free',
      displayLimit: '1 KB',
      warningThreshold: 80,
      isWarning: false,
    });

    mockCanUploadFile.mockResolvedValue(true);
  });

  describe('GET /storage-quota/:userId', () => {
    it('returns 400 when userId param is not numeric', async () => {
      const response = await request(app).get('/storage-quota/not-a-number');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Invalid user ID',
        message: 'User ID must be a number',
      });
      expect(mockStorageQuotaServiceCtor).not.toHaveBeenCalled();
    });

    it('returns 401 when requester is unauthenticated', async () => {
      const response = await request(app).get('/storage-quota/7');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        error: 'Unauthorized',
        message: 'User authentication required',
      });
    });

    it('returns 403 when user accesses another user quota', async () => {
      const response = await request(app).get('/storage-quota/7').set('x-user-id', '8');

      expect(response.status).toBe(403);
      expect(response.body).toEqual({
        error: 'Forbidden',
        message: 'You can only access your own storage quota',
      });
    });

    it('returns 401 when organization context is missing', async () => {
      const response = await request(app).get('/storage-quota/7').set('x-user-id', '7');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        error: 'Unauthorized',
        message: 'Organization context required',
      });
    });

    it('returns 400 when tier query is invalid', async () => {
      const response = await request(app)
        .get('/storage-quota/7')
        .set('x-user-id', '7')
        .set('x-org-id', 'org-1')
        .query({ tier: 'starter' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Invalid subscription tier',
        message: 'Tier must be: free, pro, or enterprise',
      });
    });

    it('returns 200 with quota payload when request is valid', async () => {
      const response = await request(app)
        .get('/storage-quota/7')
        .set('x-user-id', '7')
        .set('x-org-id', 'org-1')
        .query({ tier: 'pro' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        used: 500,
        limit: 1000,
        percentageUsed: 50,
        tier: 'free',
        displayLimit: '1 KB',
        warningThreshold: 80,
        isWarning: false,
      });
      expect(mockStorageQuotaServiceCtor).toHaveBeenCalledWith('org-1');
      expect(mockGetStorageQuota).toHaveBeenCalledWith('pro');
    });

    it('returns 500 when quota service throws', async () => {
      mockGetStorageQuota.mockRejectedValue(new Error('quota backend unavailable'));

      const response = await request(app)
        .get('/storage-quota/7')
        .set('x-user-id', '7')
        .set('x-org-id', 'org-1');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        error: 'Failed to retrieve storage quota',
        message: 'quota backend unavailable',
      });
    });

    it('returns unknown message when quota route catches non-Error throw', async () => {
      mockGetStorageQuota.mockRejectedValue('unexpected non-error');

      const response = await request(app)
        .get('/storage-quota/7')
        .set('x-user-id', '7')
        .set('x-org-id', 'org-1');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        error: 'Failed to retrieve storage quota',
        message: 'Unknown error',
      });
    });
  });

  describe('GET /storage-quota/:userId/can-upload', () => {
    it('returns 400 when can-upload userId param is not numeric', async () => {
      const response = await request(app).get('/storage-quota/not-a-number/can-upload');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Invalid user ID',
        message: 'User ID must be a number',
      });
      expect(mockStorageQuotaServiceCtor).not.toHaveBeenCalled();
    });

    it('returns 401 on can-upload when requester is unauthenticated', async () => {
      const response = await request(app).get('/storage-quota/7/can-upload');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        error: 'Unauthorized',
        message: 'User authentication required',
      });
    });

    it('returns 403 on can-upload when user checks another user quota', async () => {
      const response = await request(app).get('/storage-quota/7/can-upload').set('x-user-id', '9');

      expect(response.status).toBe(403);
      expect(response.body).toEqual({
        error: 'Forbidden',
        message: 'You can only check your own storage quota',
      });
    });

    it('returns 401 on can-upload when organization context is missing', async () => {
      const response = await request(app).get('/storage-quota/7/can-upload').set('x-user-id', '7');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        error: 'Unauthorized',
        message: 'Organization context required',
      });
    });

    it('returns 400 when file size query is missing or invalid', async () => {
      const response = await request(app)
        .get('/storage-quota/7/can-upload')
        .set('x-user-id', '7')
        .set('x-org-id', 'org-1');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Missing file size',
        message: 'size query parameter is required and must be a number',
      });
    });

    it('returns 400 on can-upload when tier query is invalid', async () => {
      const response = await request(app)
        .get('/storage-quota/7/can-upload')
        .set('x-user-id', '7')
        .set('x-org-id', 'org-1')
        .query({ size: '200', tier: 'starter' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Invalid subscription tier',
        message: 'Tier must be: free, pro, or enterprise',
      });
      expect(mockCanUploadFile).not.toHaveBeenCalled();
    });

    it('returns canUpload=false with remainingBytes when upload would exceed quota', async () => {
      mockCanUploadFile.mockResolvedValue(false);
      mockGetStorageQuota.mockResolvedValue({
        used: 900,
        limit: 1000,
        percentageUsed: 90,
        tier: 'free',
        displayLimit: '1 KB',
        warningThreshold: 80,
        isWarning: true,
      });

      const response = await request(app)
        .get('/storage-quota/7/can-upload')
        .set('x-user-id', '7')
        .set('x-org-id', 'org-1')
        .query({ size: '200', tier: 'free' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        canUpload: false,
        reason: 'Upload would exceed quota. Currently using 90% of 1 KB',
        remainingBytes: 100,
      });
      expect(mockCanUploadFile).toHaveBeenCalledWith(200, 'free');
      expect(mockGetStorageQuota).toHaveBeenCalledWith('free');
    });

    it('returns canUpload=true when file is allowed', async () => {
      const response = await request(app)
        .get('/storage-quota/7/can-upload')
        .set('x-user-id', '7')
        .set('x-org-id', 'org-1')
        .query({ size: '50', tier: 'enterprise' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ canUpload: true });
      expect(mockCanUploadFile).toHaveBeenCalledWith(50, 'enterprise');
    });

    it('returns 500 when can-upload flow throws unexpectedly', async () => {
      mockCanUploadFile.mockRejectedValue(new Error('quota decision error'));

      const response = await request(app)
        .get('/storage-quota/7/can-upload')
        .set('x-user-id', '7')
        .set('x-org-id', 'org-1')
        .query({ size: '50', tier: 'free' });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        error: 'Failed to check upload availability',
        message: 'quota decision error',
      });
    });

    it('returns unknown message when can-upload catches non-Error throw', async () => {
      mockCanUploadFile.mockRejectedValue({ reason: 'unstructured failure' });

      const response = await request(app)
        .get('/storage-quota/7/can-upload')
        .set('x-user-id', '7')
        .set('x-org-id', 'org-1')
        .query({ size: '50', tier: 'free' });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        error: 'Failed to check upload availability',
        message: 'Unknown error',
      });
    });
  });
});
