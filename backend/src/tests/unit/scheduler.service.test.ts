const mockSchedule = jest.fn();
const mockStartStripeSyncJob = jest.fn();
const mockStartTrialExpirationJob = jest.fn();
const mockStartDunningJob = jest.fn();
const mockPrepare = jest.fn();
const mockCreateBackup = jest.fn();
const mockBulkUpdateMarkdownStatuses = jest.fn();
const mockAutoCalculateMarkdownStatus = jest.fn();

jest.mock('node-cron', () => ({
  __esModule: true,
  default: {
    schedule: mockSchedule,
  },
}));

jest.mock('../../jobs/stripe-sync.job', () => ({
  startStripeSyncJob: mockStartStripeSyncJob,
}));

jest.mock('../../jobs/trialExpiration.job', () => ({
  startTrialExpirationJob: mockStartTrialExpirationJob,
}));

jest.mock('../../jobs/dunning.job', () => ({
  startDunningJob: mockStartDunningJob,
}));

jest.mock('../../database', () => ({
  getDb: jest.fn(() => ({
    prepare: mockPrepare,
  })),
}));

jest.mock('../../services/database.backup.service', () => ({
  DatabaseBackupService: jest.fn().mockImplementation(() => ({
    createBackup: mockCreateBackup,
  })),
}));

jest.mock('../../services/inventory.service', () => ({
  InventoryService: jest.fn().mockImplementation(() => ({
    bulkUpdateMarkdownStatuses: mockBulkUpdateMarkdownStatuses,
    autoCalculateMarkdownStatus: mockAutoCalculateMarkdownStatus,
  })),
}));

import { InventoryService } from '../../services/inventory.service';
import { SchedulerService } from '../../services/scheduler.service';

describe('SchedulerService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSchedule.mockReturnValue({ stop: jest.fn() });
    mockCreateBackup.mockResolvedValue('backup-path.sqlite');
    mockBulkUpdateMarkdownStatuses.mockResolvedValue(undefined);
    mockAutoCalculateMarkdownStatus.mockResolvedValue(undefined);
  });

  describe('initialize', () => {
    it('registers cron schedules and starts background jobs', () => {
      SchedulerService.initialize();

      expect(mockSchedule).toHaveBeenCalledTimes(2);
      expect(mockSchedule).toHaveBeenNthCalledWith(1, '0 2 * * *', expect.any(Function));
      expect(mockSchedule).toHaveBeenNthCalledWith(2, '0 1 * * *', expect.any(Function));
      expect(mockStartTrialExpirationJob).toHaveBeenCalledTimes(1);
      expect(mockStartDunningJob).toHaveBeenCalledTimes(1);
      expect(mockStartStripeSyncJob).toHaveBeenCalledTimes(1);
    });

    it('wires cron callbacks to markdown and backup operations', async () => {
      const updateSpy = jest
        .spyOn(SchedulerService, 'updateAllInventoryMarkdownStatuses')
        .mockResolvedValue(undefined);
      const backupSpy = jest.spyOn(SchedulerService, 'createDatabaseBackup').mockResolvedValue();

      SchedulerService.initialize();

      await mockSchedule.mock.calls[0][1]();
      await mockSchedule.mock.calls[1][1]();

      expect(updateSpy).toHaveBeenCalledTimes(1);
      expect(backupSpy).toHaveBeenCalledTimes(1);

      updateSpy.mockRestore();
      backupSpy.mockRestore();
    });
  });

  describe('updateAllInventoryMarkdownStatuses', () => {
    it('processes all organizations in bulk mode', async () => {
      mockPrepare.mockImplementation((sql: string) => {
        if (sql.includes('FROM organizations')) {
          return { all: jest.fn(() => [{ id: 'org-1' }, { id: 'org-2' }]) };
        }

        if (sql.includes('FROM inventory_items')) {
          return {
            all: jest.fn((orgId: string) => [
              { id: orgId === 'org-1' ? 1 : 2, expiry_date: '2026-03-10' },
            ]),
          };
        }

        return { all: jest.fn(() => []) };
      });

      await SchedulerService.updateAllInventoryMarkdownStatuses();

      expect(InventoryService).toHaveBeenCalledTimes(2);
      expect(mockBulkUpdateMarkdownStatuses).toHaveBeenCalledTimes(2);
      expect(mockAutoCalculateMarkdownStatus).not.toHaveBeenCalled();
    });

    it('falls back to per-item updates when bulk update fails', async () => {
      mockPrepare.mockImplementation((sql: string) => {
        if (sql.includes('FROM organizations')) {
          return { all: jest.fn(() => [{ id: 'org-1' }]) };
        }

        if (sql.includes('FROM inventory_items')) {
          return {
            all: jest.fn(() => [
              { id: 1, expiry_date: '2026-03-10' },
              { id: 2, expiry_date: '2026-03-11' },
            ]),
          };
        }

        return { all: jest.fn(() => []) };
      });

      mockBulkUpdateMarkdownStatuses.mockRejectedValueOnce(new Error('bulk failure'));

      await SchedulerService.updateAllInventoryMarkdownStatuses();

      expect(mockBulkUpdateMarkdownStatuses).toHaveBeenCalledTimes(1);
      expect(mockAutoCalculateMarkdownStatus).toHaveBeenCalledTimes(2);
      expect(mockAutoCalculateMarkdownStatus).toHaveBeenNthCalledWith(1, 1, '2026-03-10');
      expect(mockAutoCalculateMarkdownStatus).toHaveBeenNthCalledWith(2, 2, '2026-03-11');
    });
  });

  describe('createDatabaseBackup', () => {
    it('creates a backup without throwing', async () => {
      await expect(SchedulerService.createDatabaseBackup()).resolves.toBeUndefined();
      expect(mockCreateBackup).toHaveBeenCalledTimes(1);
    });

    it('handles backup errors gracefully', async () => {
      mockCreateBackup.mockRejectedValueOnce(new Error('backup failed'));
      await expect(SchedulerService.createDatabaseBackup()).resolves.toBeUndefined();
    });
  });
});
