import express from 'express';
import request from 'supertest';

const mockGetUsers = jest.fn();
const mockGetUserById = jest.fn();
const mockCreateUser = jest.fn();
const mockUpdateUser = jest.fn();
const mockDeleteUser = jest.fn();

const mockUserServiceCtor = jest.fn().mockImplementation((_organizationId?: string) => ({
  getUsers: (...args: unknown[]) => mockGetUsers(...args),
  getUserById: (...args: unknown[]) => mockGetUserById(...args),
  createUser: (...args: unknown[]) => mockCreateUser(...args),
  updateUser: (...args: unknown[]) => mockUpdateUser(...args),
  deleteUser: (...args: unknown[]) => mockDeleteUser(...args),
}));

jest.mock('../../middleware/auth.middleware', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.organizationId = req.get('x-org-id') || undefined;
    next();
  },
  requireManager: (_req: any, _res: any, next: any) => next(),
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

jest.mock('../../middleware/feature-gate.middleware', () => ({
  checkUsageLimit: () => (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../../services/user.service', () => ({
  UserService: function UserService(...args: unknown[]) {
    return mockUserServiceCtor(...args);
  },
}));

import userRouter from '../../routes/user.routes';

describe('user.routes', () => {
  const app = express();

  app.use(express.json());
  app.use('/users', userRouter);

  app.use(
    (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      if (err instanceof Error) {
        return res.status(500).json({ message: 'Internal server error' });
      }
      return res.status(500).json({ message: 'Internal server error' });
    },
  );

  beforeEach(() => {
    jest.clearAllMocks();

    mockGetUsers.mockResolvedValue([
      {
        id: 1,
        organizationId: 'org-1',
        role: 'Manager',
      },
    ]);

    mockGetUserById.mockResolvedValue({
      id: 1,
      organizationId: 'org-1',
      role: 'Manager',
      pin: '1234',
    });

    mockCreateUser.mockResolvedValue({
      id: 2,
      organizationId: 'org-1',
      role: 'member',
    });

    mockUpdateUser.mockResolvedValue(true);
    mockDeleteUser.mockResolvedValue(true);
  });

  describe('GET /users', () => {
    it('returns all users for requester organization', async () => {
      const response = await request(app).get('/users').set('x-org-id', 'org-1');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([
        {
          id: 1,
          organizationId: 'org-1',
          role: 'Manager',
        },
      ]);
      expect(mockUserServiceCtor).toHaveBeenCalledWith('org-1');
      expect(mockGetUsers).toHaveBeenCalledTimes(1);
    });

    it('returns 500 when getUsers fails', async () => {
      mockGetUsers.mockRejectedValue(new Error('users lookup failed'));

      const response = await request(app).get('/users').set('x-org-id', 'org-1');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ message: 'Internal server error' });
    });
  });

  describe('GET /users/:id', () => {
    it('returns 400 when user id param is invalid', async () => {
      const response = await request(app).get('/users/not-a-number').set('x-org-id', 'org-1');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ message: 'Invalid user id' });
      expect(mockGetUserById).not.toHaveBeenCalled();
    });

    it('returns 404 when user is not found', async () => {
      mockGetUserById.mockResolvedValue(null);

      const response = await request(app).get('/users/99').set('x-org-id', 'org-1');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ message: 'User not found' });
    });

    it('returns 403 when user belongs to different organization', async () => {
      mockGetUserById.mockResolvedValue({ id: 9, organizationId: 'org-2' });

      const response = await request(app).get('/users/9').set('x-org-id', 'org-1');

      expect(response.status).toBe(403);
      expect(response.body).toEqual({
        message: 'Access denied: User belongs to different organization',
      });
    });

    it('returns user details for same organization', async () => {
      const response = await request(app).get('/users/1').set('x-org-id', 'org-1');

      expect(response.status).toBe(200);
      expect(response.body).toEqual(
        expect.objectContaining({
          id: 1,
          organizationId: 'org-1',
        }),
      );
      expect(mockGetUserById).toHaveBeenCalledWith(1);
    });

    it('returns 500 when getUserById throws', async () => {
      mockGetUserById.mockRejectedValue(new Error('get user failed'));

      const response = await request(app).get('/users/1').set('x-org-id', 'org-1');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ message: 'Internal server error' });
    });
  });

  describe('POST /users', () => {
    it('returns 400 when pin or role is missing', async () => {
      const response = await request(app)
        .post('/users')
        .set('x-org-id', 'org-1')
        .send({ pin: '1234' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ message: 'PIN and role are required' });
      expect(mockCreateUser).not.toHaveBeenCalled();
    });

    it('returns 401 when organization context is missing', async () => {
      const response = await request(app).post('/users').send({ pin: '1234', role: 'member' });

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ message: 'Access denied: No organization context found' });
      expect(mockCreateUser).not.toHaveBeenCalled();
    });

    it('creates user successfully', async () => {
      const response = await request(app)
        .post('/users')
        .set('x-org-id', 'org-1')
        .send({ pin: '1234', role: 'member' });

      expect(response.status).toBe(201);
      expect(response.body).toEqual(
        expect.objectContaining({
          id: 2,
          organizationId: 'org-1',
          role: 'member',
        }),
      );
      expect(mockCreateUser).toHaveBeenCalledWith({
        pin: '1234',
        role: 'member',
        organizationId: 'org-1',
      });
    });

    it('returns 500 when createUser fails', async () => {
      mockCreateUser.mockRejectedValue(new Error('create user failed'));

      const response = await request(app)
        .post('/users')
        .set('x-org-id', 'org-1')
        .send({ pin: '1234', role: 'member' });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ message: 'Internal server error' });
    });
  });

  describe('PUT /users/:id', () => {
    it('returns 400 when user id param is invalid', async () => {
      const response = await request(app)
        .put('/users/not-a-number')
        .set('x-org-id', 'org-1')
        .send({ role: 'member' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ message: 'Invalid user id' });
      expect(mockGetUserById).not.toHaveBeenCalled();
    });

    it('returns 404 when existing user is not found', async () => {
      mockGetUserById.mockResolvedValue(null);

      const response = await request(app)
        .put('/users/99')
        .set('x-org-id', 'org-1')
        .send({ role: 'member' });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ message: 'User not found' });
      expect(mockUpdateUser).not.toHaveBeenCalled();
    });

    it('returns 403 when existing user belongs to another organization', async () => {
      mockGetUserById.mockResolvedValue({ id: 9, organizationId: 'org-2' });

      const response = await request(app)
        .put('/users/9')
        .set('x-org-id', 'org-1')
        .send({ role: 'member' });

      expect(response.status).toBe(403);
      expect(response.body).toEqual({
        message: 'Access denied: User belongs to different organization',
      });
      expect(mockUpdateUser).not.toHaveBeenCalled();
    });

    it('updates user with partial payload and returns refreshed user', async () => {
      mockGetUserById.mockResolvedValueOnce({ id: 1, organizationId: 'org-1' });
      mockGetUserById.mockResolvedValueOnce({
        id: 1,
        organizationId: 'org-1',
        role: 'member',
      });

      const response = await request(app)
        .put('/users/1')
        .set('x-org-id', 'org-1')
        .send({ role: 'member' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        id: 1,
        organizationId: 'org-1',
        role: 'member',
      });
      expect(mockUpdateUser).toHaveBeenCalledWith(1, { role: 'member' });
    });

    it('updates user with pin+role payload', async () => {
      const response = await request(app)
        .put('/users/1')
        .set('x-org-id', 'org-1')
        .send({ pin: '9876', role: 'Manager' });

      expect(response.status).toBe(200);
      expect(mockUpdateUser).toHaveBeenCalledWith(1, {
        pin: '9876',
        role: 'Manager',
      });
    });

    it('returns 404 when update returns false', async () => {
      mockUpdateUser.mockResolvedValue(false);

      const response = await request(app)
        .put('/users/1')
        .set('x-org-id', 'org-1')
        .send({ role: 'member' });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ message: 'User not found' });
    });

    it('returns 500 when update flow throws', async () => {
      mockUpdateUser.mockRejectedValue(new Error('update user failed'));

      const response = await request(app)
        .put('/users/1')
        .set('x-org-id', 'org-1')
        .send({ role: 'member' });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ message: 'Internal server error' });
    });
  });

  describe('DELETE /users/:id', () => {
    it('returns 400 when user id param is invalid', async () => {
      const response = await request(app).delete('/users/not-a-number').set('x-org-id', 'org-1');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ message: 'Invalid user id' });
      expect(mockGetUserById).not.toHaveBeenCalled();
    });

    it('returns 404 when existing user is not found', async () => {
      mockGetUserById.mockResolvedValue(null);

      const response = await request(app).delete('/users/99').set('x-org-id', 'org-1');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ message: 'User not found' });
      expect(mockDeleteUser).not.toHaveBeenCalled();
    });

    it('returns 403 when deleting user from another organization', async () => {
      mockGetUserById.mockResolvedValue({ id: 9, organizationId: 'org-2' });

      const response = await request(app).delete('/users/9').set('x-org-id', 'org-1');

      expect(response.status).toBe(403);
      expect(response.body).toEqual({
        message: 'Access denied: User belongs to different organization',
      });
      expect(mockDeleteUser).not.toHaveBeenCalled();
    });

    it('returns 404 when delete operation reports no row removed', async () => {
      mockDeleteUser.mockResolvedValue(false);

      const response = await request(app).delete('/users/1').set('x-org-id', 'org-1');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ message: 'User not found' });
    });

    it('deletes user successfully', async () => {
      const response = await request(app).delete('/users/1').set('x-org-id', 'org-1');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ message: 'User deleted successfully' });
      expect(mockDeleteUser).toHaveBeenCalledWith(1);
    });

    it('returns 500 when delete flow throws', async () => {
      mockDeleteUser.mockRejectedValue(new Error('delete user failed'));

      const response = await request(app).delete('/users/1').set('x-org-id', 'org-1');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ message: 'Internal server error' });
    });
  });
});
