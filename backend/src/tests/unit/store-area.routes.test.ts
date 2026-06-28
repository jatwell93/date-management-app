import express from 'express';
import request from 'supertest';

const mockGetAllStoreAreas = vi.fn();
const mockGetStoreAreaById = vi.fn();
const mockGetStoreAreaByName = vi.fn();
const mockCreateStoreArea = vi.fn();
const mockUpdateStoreArea = vi.fn();
const mockDeleteStoreArea = vi.fn();

const mockStoreAreaServiceCtor = vi.fn().mockImplementation(function (_organizationId?: string) {
  return {
    getAllStoreAreas: (...args: unknown[]) => mockGetAllStoreAreas(...args),
    getStoreAreaById: (...args: unknown[]) => mockGetStoreAreaById(...args),
    getStoreAreaByName: (...args: unknown[]) => mockGetStoreAreaByName(...args),
    createStoreArea: (...args: unknown[]) => mockCreateStoreArea(...args),
    updateStoreArea: (...args: unknown[]) => mockUpdateStoreArea(...args),
    deleteStoreArea: (...args: unknown[]) => mockDeleteStoreArea(...args),
  };
});

vi.mock('../../services/store-area.service', () => ({
  StoreAreaService: function StoreAreaService(...args: unknown[]) {
    return mockStoreAreaServiceCtor(...args);
  },
}));

vi.mock('../../middleware/auth.middleware', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.organizationId = req.get('x-org-id') || 'org-store-area-test';
    next();
  },
}));

vi.mock('../../middleware/validation.middleware', () => ({
  validateDataIntegrity: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../middleware/validateRequest', () => ({
  validateRequest: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../middleware/data-integrity.middleware', () => ({
  validateBusinessRules: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../middleware/rateLimiter', () => ({
  standardLimiter: (_req: any, _res: any, next: any) => next(),
}));

import storeAreaRouter from '../../routes/store-area.routes';

describe('store-area.routes', () => {
  const app = express();
  app.use(express.json());
  app.use('/store-areas', storeAreaRouter);

  beforeEach(() => {
    vi.clearAllMocks();

    mockGetAllStoreAreas.mockResolvedValue([
      {
        id: 1,
        name: 'Cool Room',
      },
    ]);

    mockGetStoreAreaById.mockResolvedValue({
      id: 1,
      name: 'Cool Room',
      subDepartment: 'Dairy',
    });

    mockGetStoreAreaByName.mockResolvedValue([
      {
        id: 1,
        name: 'Cool Room',
        subDepartment: 'Dairy',
      },
    ]);

    mockCreateStoreArea.mockResolvedValue({
      id: 2,
      name: 'Back Room',
      subDepartment: 'General',
    });

    mockUpdateStoreArea.mockResolvedValue({
      id: 1,
      name: 'Updated Room',
      subDepartment: 'Frozen',
    });

    mockDeleteStoreArea.mockResolvedValue(true);
  });

  describe('GET /store-areas', () => {
    it('returns all store areas for requester organization', async () => {
      const response = await request(app).get('/store-areas').set('x-org-id', 'org-1');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([{ id: 1, name: 'Cool Room' }]);
      expect(mockStoreAreaServiceCtor).toHaveBeenCalledWith('org-1');
      expect(mockGetAllStoreAreas).toHaveBeenCalledTimes(1);
    });

    it('returns error message when get-all throws an Error', async () => {
      mockGetAllStoreAreas.mockRejectedValue(new Error('store area query failed'));

      const response = await request(app).get('/store-areas').set('x-org-id', 'org-1');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ message: 'store area query failed' });
    });
  });

  describe('GET /store-areas/:id', () => {
    it('returns 400 for invalid store area id', async () => {
      const response = await request(app).get('/store-areas/not-a-number').set('x-org-id', 'org-1');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ message: 'Invalid store area id' });
      expect(mockGetStoreAreaById).not.toHaveBeenCalled();
    });

    it('returns 404 when store area is not found', async () => {
      mockGetStoreAreaById.mockResolvedValue(null);

      const response = await request(app).get('/store-areas/12').set('x-org-id', 'org-1');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ message: 'Store area not found' });
    });

    it('returns store area by id on success', async () => {
      const response = await request(app).get('/store-areas/1').set('x-org-id', 'org-1');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ id: 1, name: 'Cool Room', subDepartment: 'Dairy' });
      expect(mockGetStoreAreaById).toHaveBeenCalledWith(1);
    });

    it('returns 500 when get-by-id fails unexpectedly', async () => {
      mockGetStoreAreaById.mockRejectedValue(new Error('get-by-id failed'));

      const response = await request(app).get('/store-areas/1').set('x-org-id', 'org-1');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ message: 'get-by-id failed' });
    });
  });

  describe('GET /store-areas/name/:name', () => {
    it('returns 404 when no store areas exist for name', async () => {
      mockGetStoreAreaByName.mockResolvedValue([]);

      const response = await request(app)
        .get('/store-areas/name/Cool Room')
        .set('x-org-id', 'org-1');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ message: 'Store areas not found' });
    });

    it('returns matching store areas by name', async () => {
      const response = await request(app)
        .get('/store-areas/name/Cool Room')
        .set('x-org-id', 'org-1');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([{ id: 1, name: 'Cool Room', subDepartment: 'Dairy' }]);
      expect(mockGetStoreAreaByName).toHaveBeenCalledWith('Cool Room');
    });

    it('returns 500 when get-by-name fails unexpectedly', async () => {
      mockGetStoreAreaByName.mockRejectedValue(new Error('get-by-name failed'));

      const response = await request(app)
        .get('/store-areas/name/Cool Room')
        .set('x-org-id', 'org-1');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ message: 'get-by-name failed' });
    });
  });

  describe('POST /store-areas', () => {
    it('returns 400 when required name field is missing', async () => {
      const response = await request(app)
        .post('/store-areas')
        .set('x-org-id', 'org-1')
        .send({ subDepartment: 'General' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ message: 'Missing required store area fields' });
      expect(mockCreateStoreArea).not.toHaveBeenCalled();
    });

    it('returns 201 and created store area on success', async () => {
      const response = await request(app)
        .post('/store-areas')
        .set('x-org-id', 'org-1')
        .send({ name: 'Back Room', subDepartment: 'General' });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({ id: 2, name: 'Back Room', subDepartment: 'General' });
      expect(mockCreateStoreArea).toHaveBeenCalledWith({
        name: 'Back Room',
        subDepartment: 'General',
        lastChecked: undefined,
      });
    });

    it('returns fallback message when create throws non-Error value', async () => {
      mockCreateStoreArea.mockRejectedValue({ reason: 'unexpected failure' });

      const response = await request(app)
        .post('/store-areas')
        .set('x-org-id', 'org-1')
        .send({ name: 'Back Room', subDepartment: 'General' });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ message: 'Internal server error' });
    });
  });

  describe('PUT /store-areas/:id', () => {
    it('returns 400 for invalid id', async () => {
      const response = await request(app)
        .put('/store-areas/not-a-number')
        .set('x-org-id', 'org-1')
        .send({ name: 'Updated Room' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ message: 'Invalid store area id' });
      expect(mockUpdateStoreArea).not.toHaveBeenCalled();
    });

    it('returns 404 when store area to update does not exist', async () => {
      mockUpdateStoreArea.mockResolvedValue(null);

      const response = await request(app)
        .put('/store-areas/1')
        .set('x-org-id', 'org-1')
        .send({ name: 'Updated Room' });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ message: 'Store area not found' });
    });

    it('updates store area and returns updated payload', async () => {
      const response = await request(app)
        .put('/store-areas/1')
        .set('x-org-id', 'org-1')
        .send({ name: 'Updated Room', subDepartment: 'Frozen' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        id: 1,
        name: 'Updated Room',
        subDepartment: 'Frozen',
      });
      expect(mockUpdateStoreArea).toHaveBeenCalledWith(1, {
        name: 'Updated Room',
        subDepartment: 'Frozen',
      });
    });

    it('passes lastChecked field when provided in update payload', async () => {
      const response = await request(app)
        .put('/store-areas/1')
        .set('x-org-id', 'org-1')
        .send({ lastChecked: '2026-04-11T10:00:00.000Z' });

      expect(response.status).toBe(200);
      expect(mockUpdateStoreArea).toHaveBeenCalledWith(1, {
        lastChecked: '2026-04-11T10:00:00.000Z',
      });
    });

    it('returns error message when update throws an Error', async () => {
      mockUpdateStoreArea.mockRejectedValue(new Error('update failed'));

      const response = await request(app)
        .put('/store-areas/1')
        .set('x-org-id', 'org-1')
        .send({ name: 'Updated Room' });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ message: 'update failed' });
    });
  });

  describe('DELETE /store-areas/:id', () => {
    it('returns 400 for invalid id', async () => {
      const response = await request(app)
        .delete('/store-areas/not-a-number')
        .set('x-org-id', 'org-1');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ message: 'Invalid store area id' });
      expect(mockDeleteStoreArea).not.toHaveBeenCalled();
    });

    it('returns 404 when store area to delete does not exist', async () => {
      mockDeleteStoreArea.mockResolvedValue(false);

      const response = await request(app).delete('/store-areas/1').set('x-org-id', 'org-1');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ message: 'Store area not found' });
    });

    it('returns success message when deletion succeeds', async () => {
      const response = await request(app).delete('/store-areas/1').set('x-org-id', 'org-1');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ message: 'Store area deleted successfully' });
      expect(mockDeleteStoreArea).toHaveBeenCalledWith(1);
    });

    it('returns fallback message when delete throws non-Error value', async () => {
      mockDeleteStoreArea.mockRejectedValue(123);

      const response = await request(app).delete('/store-areas/1').set('x-org-id', 'org-1');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ message: 'Internal server error' });
    });
  });
});
