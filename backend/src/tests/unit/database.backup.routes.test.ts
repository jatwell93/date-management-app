import express from 'express';
import request from 'supertest';

const mockCreateBackup = vi.fn();
const mockRestoreBackup = vi.fn();
const mockListBackups = vi.fn();

// These middleware-factory mocks are invoked at the SUT's module-load (the router
// calls validateRequest()/standardLimiter to build middleware), so they must be
// initialized before the hoisted vi.mock factories run — lift via vi.hoisted().
const { mockValidateRequestFactory, mockStandardLimiter } = vi.hoisted(() => {
  const mockValidateRequestFactory = vi.fn(() => (req: any, res: any, next: any) => {
    if (req.get('x-validation-fail') === 'true') {
      return res.status(400).json({ message: 'Validation failed' });
    }
    next();
  });
  const mockStandardLimiter = vi.fn((_req: any, _res: any, next: any) => next());
  return { mockValidateRequestFactory, mockStandardLimiter };
});

vi.mock('../../controllers/database.backup.controller', () => ({
  createBackup: (...args: unknown[]) => mockCreateBackup(...args),
  restoreBackup: (...args: unknown[]) => mockRestoreBackup(...args),
  listBackups: (...args: unknown[]) => mockListBackups(...args),
}));

vi.mock('../../middleware/auth.middleware', () => ({
  authenticateToken: (req: any, res: any, next: any) => {
    if (req.get('x-auth') !== 'ok') {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    next();
  },
}));

vi.mock('../../middleware/requireOrgRole', () => ({
  requireOrgRole:
    (...allowedRoles: string[]) =>
    (req: any, res: any, next: any) => {
      if (req.get('x-manager') !== 'true') {
        return res.status(403).json({ message: 'Forbidden' });
      }
      next();
    },
}));

vi.mock('../../middleware/validateRequest', () => ({
  validateRequest: (...args: unknown[]) => mockValidateRequestFactory(...args),
}));

vi.mock('../../middleware/rateLimiter', () => ({
  standardLimiter: (...args: unknown[]) => mockStandardLimiter(...args),
}));

import backupRouter from '../../routes/database.backup.routes';

describe('database.backup.routes', () => {
  const app = express();

  app.use(express.json());
  app.use('/database', backupRouter);

  beforeEach(() => {
    vi.clearAllMocks();

    mockCreateBackup.mockImplementation((_req: any, res: any) => {
      res.status(200).json({ message: 'Database backup created successfully' });
    });

    mockRestoreBackup.mockImplementation((_req: any, res: any) => {
      res.status(200).json({ message: 'Database restored successfully' });
    });

    mockListBackups.mockImplementation((_req: any, res: any) => {
      res.status(200).json({ backups: [], count: 0 });
    });
  });

  it('returns 401 for POST /backup when unauthenticated', async () => {
    const response = await request(app).post('/database/backup');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: 'Unauthorized' });
    expect(mockCreateBackup).not.toHaveBeenCalled();
  });

  it('returns 403 for POST /backup when requester is not manager', async () => {
    const response = await request(app).post('/database/backup').set('x-auth', 'ok');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: 'Forbidden' });
    expect(mockCreateBackup).not.toHaveBeenCalled();
  });

  it('calls createBackup for authorized manager on POST /backup', async () => {
    const response = await request(app)
      .post('/database/backup')
      .set('x-auth', 'ok')
      .set('x-manager', 'true');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: 'Database backup created successfully' });
    expect(mockStandardLimiter).toHaveBeenCalledTimes(1);
    expect(mockCreateBackup).toHaveBeenCalledTimes(1);
  });

  it('returns 401 for POST /restore when unauthenticated', async () => {
    const response = await request(app).post('/database/restore').send({ backupPath: '/tmp/a.db' });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: 'Unauthorized' });
    expect(mockRestoreBackup).not.toHaveBeenCalled();
  });

  it('returns 403 for POST /restore when requester is not manager', async () => {
    const response = await request(app)
      .post('/database/restore')
      .set('x-auth', 'ok')
      .send({ backupPath: '/tmp/a.db' });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: 'Forbidden' });
    expect(mockRestoreBackup).not.toHaveBeenCalled();
  });

  it('returns 400 for POST /restore when request validation fails', async () => {
    const response = await request(app)
      .post('/database/restore')
      .set('x-auth', 'ok')
      .set('x-manager', 'true')
      .set('x-validation-fail', 'true')
      .send({ backupPath: '/tmp/a.db' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'Validation failed' });
    expect(mockRestoreBackup).not.toHaveBeenCalled();
  });

  it('calls restoreBackup for authorized manager on valid POST /restore', async () => {
    const response = await request(app)
      .post('/database/restore')
      .set('x-auth', 'ok')
      .set('x-manager', 'true')
      .send({ backupPath: '/tmp/a.db' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: 'Database restored successfully' });
    expect(mockStandardLimiter).toHaveBeenCalledTimes(1);
    expect(mockRestoreBackup).toHaveBeenCalledTimes(1);
  });

  it('returns 401 for GET /backups when unauthenticated', async () => {
    const response = await request(app).get('/database/backups');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: 'Unauthorized' });
    expect(mockListBackups).not.toHaveBeenCalled();
  });

  it('returns 403 for GET /backups when requester is not manager', async () => {
    const response = await request(app).get('/database/backups').set('x-auth', 'ok');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: 'Forbidden' });
    expect(mockListBackups).not.toHaveBeenCalled();
  });

  it('calls listBackups for authorized manager on GET /backups', async () => {
    const response = await request(app)
      .get('/database/backups')
      .set('x-auth', 'ok')
      .set('x-manager', 'true');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ backups: [], count: 0 });
    expect(mockListBackups).toHaveBeenCalledTimes(1);
  });
});
