import { Request, Response } from 'express';

const mockCreateBackup = vi.fn();
const mockRestoreFromBackup = vi.fn();
const mockListBackups = vi.fn();

vi.mock('../../services/database.backup.service', () => ({
  DatabaseBackupService: vi.fn().mockImplementation(function () {
    return {
      createBackup: (...args: unknown[]) => mockCreateBackup(...args),
      restoreFromBackup: (...args: unknown[]) => mockRestoreFromBackup(...args),
      listBackups: (...args: unknown[]) => mockListBackups(...args),
    };
  }),
}));

vi.mock('../../utils/logger', () => ({
  Logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  createBackup,
  restoreBackup,
  listBackups,
} from '../../controllers/database.backup.controller';

function createMockResponse(): Response {
  const res = {} as Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe('database.backup.controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with backup metadata when createBackup succeeds', async () => {
    mockCreateBackup.mockResolvedValue('./backups/backup-2026.sqlite');

    const req = {} as Request;
    const res = createMockResponse();

    await createBackup(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Database backup created successfully',
        backupPath: './backups/backup-2026.sqlite',
        timestamp: expect.any(String),
      }),
    );
  });

  it('returns 500 when createBackup throws an error', async () => {
    mockCreateBackup.mockRejectedValue(new Error('disk full'));

    const req = {} as Request;
    const res = createMockResponse();

    await createBackup(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Failed to create database backup',
      message: 'disk full',
    });
  });

  it('returns unknown error message when createBackup throws non-Error value', async () => {
    mockCreateBackup.mockRejectedValue('unknown failure');

    const req = {} as Request;
    const res = createMockResponse();

    await createBackup(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Failed to create database backup',
      message: 'Unknown error occurred',
    });
  });

  it('returns 400 when restore backupPath is missing', async () => {
    const req = { body: {} } as Request;
    const res = createMockResponse();

    await restoreBackup(req, res);

    expect(mockRestoreFromBackup).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Backup path is required',
    });
  });

  it('returns 200 when restoreFromBackup succeeds', async () => {
    mockRestoreFromBackup.mockResolvedValue(true);

    const req = { body: { backupPath: './backups/backup-2026.sqlite' } } as Request;
    const res = createMockResponse();

    await restoreBackup(req, res);

    expect(mockRestoreFromBackup).toHaveBeenCalledWith('./backups/backup-2026.sqlite');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Database restored successfully',
      backupPath: './backups/backup-2026.sqlite',
    });
  });

  it('returns 400 when restoreFromBackup reports failure', async () => {
    mockRestoreFromBackup.mockResolvedValue(false);

    const req = { body: { backupPath: './backups/missing.sqlite' } } as Request;
    const res = createMockResponse();

    await restoreBackup(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Failed to restore database from backup',
    });
  });

  it('returns 500 when restoreFromBackup throws', async () => {
    mockRestoreFromBackup.mockRejectedValue(new Error('permission denied'));

    const req = { body: { backupPath: './backups/backup-2026.sqlite' } } as Request;
    const res = createMockResponse();

    await restoreBackup(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Failed to restore database from backup',
      message: 'permission denied',
    });
  });

  it('returns unknown error message when restoreFromBackup throws non-Error value', async () => {
    mockRestoreFromBackup.mockRejectedValue({ reason: 'mystery' });

    const req = { body: { backupPath: './backups/backup-2026.sqlite' } } as Request;
    const res = createMockResponse();

    await restoreBackup(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Failed to restore database from backup',
      message: 'Unknown error occurred',
    });
  });

  it('returns 200 with backup list and count', async () => {
    mockListBackups.mockResolvedValue(['./backups/backup-1.sqlite', './backups/backup-2.sqlite']);

    const req = {} as Request;
    const res = createMockResponse();

    await listBackups(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      backups: ['./backups/backup-1.sqlite', './backups/backup-2.sqlite'],
      count: 2,
    });
  });

  it('returns 500 when listBackups throws', async () => {
    mockListBackups.mockRejectedValue(new Error('cannot read directory'));

    const req = {} as Request;
    const res = createMockResponse();

    await listBackups(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Failed to list database backups',
      message: 'cannot read directory',
    });
  });

  it('returns unknown error message when listBackups throws non-Error value', async () => {
    mockListBackups.mockRejectedValue(123);

    const req = {} as Request;
    const res = createMockResponse();

    await listBackups(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Failed to list database backups',
      message: 'Unknown error occurred',
    });
  });
});
