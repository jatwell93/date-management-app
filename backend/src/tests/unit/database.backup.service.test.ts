const mockFsAccess = vi.fn();
const mockFsMkdir = vi.fn();
const mockFsCopyFile = vi.fn();
const mockFsReaddir = vi.fn();
const mockFsStat = vi.fn();
const mockFsUnlink = vi.fn();

vi.mock('fs', () => ({
  promises: {
    access: (...args: unknown[]) => mockFsAccess(...args),
    mkdir: (...args: unknown[]) => mockFsMkdir(...args),
    copyFile: (...args: unknown[]) => mockFsCopyFile(...args),
    readdir: (...args: unknown[]) => mockFsReaddir(...args),
    stat: (...args: unknown[]) => mockFsStat(...args),
    unlink: (...args: unknown[]) => mockFsUnlink(...args),
  },
}));

vi.mock('../../utils/logger', () => ({
  Logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

import { Logger } from '../../utils/logger';
import { DatabaseBackupService } from '../../services/database.backup.service';

describe('DatabaseBackupService', () => {
  const logger = Logger as unknown as {
    info: jest.Mock;
    error: jest.Mock;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockFsAccess.mockResolvedValue(undefined);
    mockFsMkdir.mockResolvedValue(undefined);
    mockFsCopyFile.mockResolvedValue(undefined);
    mockFsReaddir.mockResolvedValue([]);
    mockFsStat.mockResolvedValue({ mtime: new Date('2026-04-01T00:00:00.000Z') });
    mockFsUnlink.mockResolvedValue(undefined);

    process.env.DATABASE_PATH = './database.sqlite';
  });

  it('creates backup directory when it does not exist', async () => {
    mockFsAccess.mockRejectedValueOnce(new Error('missing directory'));

    const service = new DatabaseBackupService({ backupDirectory: './tmp-backups' });
    const cleanupSpy = vi.spyOn(service, 'cleanupOldBackups').mockResolvedValue(undefined);

    await service.createBackup();

    expect(mockFsMkdir).toHaveBeenCalledWith('./tmp-backups', { recursive: true });
    expect(logger.info).toHaveBeenCalledWith('Created backup directory: ./tmp-backups');
    expect(cleanupSpy).toHaveBeenCalledTimes(1);
  });

  it('creates backup using DATABASE_PATH and returns generated backup path', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-11T08:55:30.111Z'));
    process.env.DATABASE_PATH = './custom-source.sqlite';

    const service = new DatabaseBackupService({ backupDirectory: './backups-test' });
    const cleanupSpy = vi.spyOn(service, 'cleanupOldBackups').mockResolvedValue(undefined);

    const backupPath = await service.createBackup();

    expect(backupPath).toContain('backup-2026-04-11T08-55-30-111Z.sqlite');
    expect(backupPath).toContain('backups-test');
    expect(mockFsCopyFile).toHaveBeenCalledWith('./custom-source.sqlite', backupPath);
    expect(logger.info).toHaveBeenCalledWith(`Database backup created: ${backupPath}`);
    expect(cleanupSpy).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it('logs and rethrows createBackup failures', async () => {
    const service = new DatabaseBackupService();
    const copyError = new Error('copy failed');
    mockFsCopyFile.mockRejectedValue(copyError);

    await expect(service.createBackup()).rejects.toThrow('copy failed');
    expect(logger.error).toHaveBeenCalledWith('Failed to create database backup', {
      error: 'copy failed',
    });
  });

  it('returns false when restore path escapes backup directory', async () => {
    const service = new DatabaseBackupService({ backupDirectory: './safe-backups' });

    const result = await service.restoreFromBackup('../outside.sqlite');

    expect(result).toBe(false);
    expect(logger.error).toHaveBeenCalledWith(
      'Invalid backup path outside backup directory: ../outside.sqlite',
    );
    expect(mockFsCopyFile).not.toHaveBeenCalled();
  });

  it('returns false when backup file does not exist', async () => {
    const service = new DatabaseBackupService({ backupDirectory: '/' });
    mockFsAccess.mockClear();
    mockFsAccess.mockRejectedValueOnce(new Error('missing backup file'));

    const result = await service.restoreFromBackup('missing.sqlite');

    expect(result).toBe(false);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Backup file does not exist'),
    );
    expect(mockFsCopyFile).not.toHaveBeenCalled();
  });

  it('restores database from an existing backup', async () => {
    process.env.DATABASE_PATH = './target.sqlite';
    const service = new DatabaseBackupService({ backupDirectory: '/' });
    mockFsAccess.mockResolvedValue(undefined);

    const result = await service.restoreFromBackup('backup-2026.sqlite');

    expect(result).toBe(true);
    expect(mockFsCopyFile).toHaveBeenCalledWith(
      expect.stringContaining('backup-2026.sqlite'),
      './target.sqlite',
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Database restored from backup:'),
    );
  });

  it('logs and rethrows restore errors', async () => {
    const service = new DatabaseBackupService({ backupDirectory: '/' });
    mockFsAccess.mockResolvedValue(undefined);
    const restoreError = new Error('restore failed');
    mockFsCopyFile.mockRejectedValue(restoreError);

    await expect(service.restoreFromBackup('backup.sqlite')).rejects.toThrow('restore failed');
    expect(logger.error).toHaveBeenCalledWith('Failed to restore database from backup', {
      error: 'restore failed',
      backupPath: 'backup.sqlite',
    });
  });

  it('lists and sorts valid backup files by modified date', async () => {
    const service = new DatabaseBackupService({ backupDirectory: './backups' });
    mockFsReaddir.mockResolvedValue([
      'backup-older.sqlite',
      'notes.txt',
      'backup-newer.sqlite',
      'report.sqlite',
    ]);
    mockFsStat.mockImplementation(async (filePath: string) => {
      if (filePath.includes('backup-newer.sqlite')) {
        return { mtime: new Date('2026-04-11T10:00:00.000Z') };
      }
      return { mtime: new Date('2026-04-01T10:00:00.000Z') };
    });

    const backups = await service.listBackups();

    expect(backups).toHaveLength(2);
    expect(backups[0].replace(/\\/g, '/')).toBe('backups/backup-newer.sqlite');
    expect(backups[1].replace(/\\/g, '/')).toBe('backups/backup-older.sqlite');
    expect(logger.info).toHaveBeenCalledWith('Found 2 backup files');
  });

  it('returns empty array when listBackups fails', async () => {
    const service = new DatabaseBackupService();
    mockFsReaddir.mockRejectedValue(new Error('read failed'));

    const backups = await service.listBackups();

    expect(backups).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith('Failed to list backup files', {
      error: 'read failed',
    });
  });

  it('cleanupOldBackups deletes expired backups and excess retained backups', async () => {
    const service = new DatabaseBackupService({ retentionDays: 30, maxRetainedBackups: 2 });
    const allBackups = [
      './backups/backup-newest.sqlite',
      './backups/backup-mid.sqlite',
      './backups/backup-over-limit.sqlite',
      './backups/backup-old.sqlite',
    ];
    vi.spyOn(service, 'listBackups').mockResolvedValue(allBackups);

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-11T00:00:00.000Z'));

    mockFsStat.mockImplementation(async (path: string) => {
      if (path.endsWith('backup-old.sqlite')) {
        return { mtime: new Date('2026-01-01T00:00:00.000Z') };
      }
      return { mtime: new Date('2026-04-10T00:00:00.000Z') };
    });

    await service.cleanupOldBackups();

    expect(mockFsUnlink).toHaveBeenCalledWith('./backups/backup-old.sqlite');
    expect(mockFsUnlink).toHaveBeenCalledWith('./backups/backup-over-limit.sqlite');

    vi.useRealTimers();
  });

  it('logs and rethrows cleanup errors', async () => {
    const service = new DatabaseBackupService();
    vi.spyOn(service, 'listBackups').mockRejectedValue(new Error('listing failed'));

    await expect(service.cleanupOldBackups()).rejects.toThrow('listing failed');
    expect(logger.error).toHaveBeenCalledWith('Failed to clean up old backups', {
      error: 'listing failed',
    });
  });
});
