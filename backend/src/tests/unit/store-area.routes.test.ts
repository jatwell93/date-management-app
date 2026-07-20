import express from 'express';
import request from 'supertest';

const mockGetAllStoreAreas = vi.fn();
const mockGetStoreAreaById = vi.fn();
const mockGetStoreAreaByName = vi.fn();
const mockCreateStoreArea = vi.fn();
const mockUpdateStoreArea = vi.fn();
const mockDeleteStoreArea = vi.fn();
const mockListCheckCycles = vi.fn();
const mockCreateCheckCycle = vi.fn();
const mockCompleteCheckCycle = vi.fn();
const mockRecordBayCheck = vi.fn();
const mockGetFloorProgress = vi.fn();

const mockStoreAreaServiceCtor = vi.fn().mockImplementation(function (_organizationId?: string) {
  return {
    getAllStoreAreas: (...args: unknown[]) => mockGetAllStoreAreas(...args),
    getStoreAreaById: (...args: unknown[]) => mockGetStoreAreaById(...args),
    getStoreAreaByName: (...args: unknown[]) => mockGetStoreAreaByName(...args),
    createStoreArea: (...args: unknown[]) => mockCreateStoreArea(...args),
    updateStoreArea: (...args: unknown[]) => mockUpdateStoreArea(...args),
    deleteStoreArea: (...args: unknown[]) => mockDeleteStoreArea(...args),
    listCheckCycles: (...args: unknown[]) => mockListCheckCycles(...args),
    createCheckCycle: (...args: unknown[]) => mockCreateCheckCycle(...args),
    completeCheckCycle: (...args: unknown[]) => mockCompleteCheckCycle(...args),
    recordBayCheck: (...args: unknown[]) => mockRecordBayCheck(...args),
    getFloorProgress: (...args: unknown[]) => mockGetFloorProgress(...args),
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
    req.userId = Number(req.get('x-user-id') || 7);
    req.userRole = req.get('x-user-role') || 'admin';
    req.user = { id: req.userId, role: req.userRole };
    next();
  },
}));

vi.mock('../../middleware/requireOrgRole', () => ({
  requireOrgRole:
    (...allowedRoles: string[]) =>
    (req: any, res: any, next: any) => {
      if (!allowedRoles.includes(req.userRole)) {
        return res.status(403).json({ message: 'Access denied: Insufficient permissions' });
      }
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
import { bayCheckCreateSchema, checkCycleCreateSchema } from '../../schemas';

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
    mockListCheckCycles.mockResolvedValue([{ id: 11, name: 'Morning walk', status: 'active' }]);
    mockCreateCheckCycle.mockResolvedValue({ id: 11, name: 'Morning walk', status: 'active' });
    mockCompleteCheckCycle.mockResolvedValue({ id: 11, status: 'completed' });
    mockRecordBayCheck.mockResolvedValue({ id: 22, storeAreaId: 5, userId: 7 });
    mockGetFloorProgress.mockResolvedValue({
      activeCycle: { id: 11, name: 'Morning walk' },
      summary: { totalBays: 1, checkedBays: 1, notCheckedBays: 0, overdueBays: 0 },
      departments: [],
    });
  });

  describe('store walk tracking routes', () => {
    it('lists check cycles from the requester organization context', async () => {
      const response = await request(app).get('/store-areas/check-cycles').set('x-org-id', 'org-1');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([{ id: 11, name: 'Morning walk', status: 'active' }]);
      expect(mockStoreAreaServiceCtor).toHaveBeenCalledWith('org-1');
      expect(mockListCheckCycles).toHaveBeenCalledTimes(1);
    });

    it('creates a check cycle for admin or manager users', async () => {
      const response = await request(app)
        .post('/store-areas/check-cycles')
        .set('x-org-id', 'org-1')
        .set('x-user-role', 'manager')
        .send({ name: 'Morning walk' });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({ id: 11, name: 'Morning walk', status: 'active' });
      expect(mockCreateCheckCycle).toHaveBeenCalledWith({
        name: 'Morning walk',
        startedAt: undefined,
      });
    });

    it('blocks team members from creating check cycles', async () => {
      const response = await request(app)
        .post('/store-areas/check-cycles')
        .set('x-org-id', 'org-1')
        .set('x-user-role', 'team_member')
        .send({ name: 'Morning walk' });

      expect(response.status).toBe(403);
      expect(mockCreateCheckCycle).not.toHaveBeenCalled();
    });

    it('maps duplicate active cycle errors to conflict responses', async () => {
      mockCreateCheckCycle.mockRejectedValue(new Error('Active check cycle already exists'));

      const response = await request(app)
        .post('/store-areas/check-cycles')
        .set('x-org-id', 'org-1')
        .send({ name: 'Morning walk' });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({ message: 'Active check cycle already exists' });
    });

    it('completes an active check cycle by id', async () => {
      const response = await request(app)
        .post('/store-areas/check-cycles/11/complete')
        .set('x-org-id', 'org-1');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ id: 11, status: 'completed' });
      expect(mockCompleteCheckCycle).toHaveBeenCalledWith(11);
    });

    it('records a bay check with authenticated user context', async () => {
      const response = await request(app)
        .post('/store-areas/bay-checks')
        .set('x-org-id', 'org-1')
        .set('x-user-id', '42')
        .send({ storeAreaId: 5, itemsAddedCount: 2 });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({ id: 22, storeAreaId: 5, userId: 7 });
      expect(mockRecordBayCheck).toHaveBeenCalledWith(42, {
        storeAreaId: 5,
        checkedAt: undefined,
        itemsAddedCount: 2,
        notes: undefined,
      });
    });

    it('maps active cycle and leaf validation errors for bay checks', async () => {
      mockRecordBayCheck.mockRejectedValueOnce(new Error('Active check cycle is required'));
      const noCycle = await request(app)
        .post('/store-areas/bay-checks')
        .set('x-org-id', 'org-1')
        .send({ storeAreaId: 5 });

      mockRecordBayCheck.mockRejectedValueOnce(new Error('Bay check must target a leaf bay'));
      const departmentTarget = await request(app)
        .post('/store-areas/bay-checks')
        .set('x-org-id', 'org-1')
        .send({ storeAreaId: 1 });

      expect(noCycle.status).toBe(409);
      expect(departmentTarget.status).toBe(400);
    });

    it('returns floor progress for the requester organization', async () => {
      const response = await request(app)
        .get('/store-areas/floor-progress')
        .set('x-org-id', 'org-1');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        activeCycle: { id: 11, name: 'Morning walk' },
        summary: { totalBays: 1, checkedBays: 1, notCheckedBays: 0, overdueBays: 0 },
        departments: [],
      });
      expect(mockGetFloorProgress).toHaveBeenCalledTimes(1);
    });
  });

  describe('store walk validation schemas', () => {
    it('requires a non-empty check cycle name', () => {
      const result = checkCycleCreateSchema.safeParse({ body: { name: '' } });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe('Check cycle name is required');
      }
    });

    it('requires a positive store area id for bay checks', () => {
      const missing = bayCheckCreateSchema.safeParse({ body: { itemsAddedCount: 1 } });
      const negative = bayCheckCreateSchema.safeParse({ body: { storeAreaId: -1 } });

      expect(missing.success).toBe(false);
      expect(negative.success).toBe(false);
    });
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
