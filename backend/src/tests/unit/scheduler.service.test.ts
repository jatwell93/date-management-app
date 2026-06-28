// These are referenced inside hoisted vi.mock factories, and the SUT invokes the
// mocked node-cron at module-load. Lift them with vi.hoisted() so they exist
// before the factories run (Vitest's auto-hoist of bare vi.fn() consts is
// unreliable when other factories in the file use chained .mockImplementation()).
const {
  mockSchedule,
  mockStartStripeSyncJob,
  mockStartTrialExpirationJob,
  mockStartDunningJob,
  mockPrepare,
  mockCreateBackup,
  mockBulkUpdateMarkdownStatuses,
  mockAutoCalculateMarkdownStatus,
} = vi.hoisted(() => ({
  mockSchedule: vi.fn(),
  mockStartStripeSyncJob: vi.fn(),
  mockStartTrialExpirationJob: vi.fn(),
  mockStartDunningJob: vi.fn(),
  mockPrepare: vi.fn(),
  mockCreateBackup: vi.fn(),
  mockBulkUpdateMarkdownStatuses: vi.fn(),
  mockAutoCalculateMarkdownStatus: vi.fn(),
}));

vi.mock('node-cron', () => ({
  __esModule: true,
  default: {
    schedule: mockSchedule,
  },
}));

vi.mock('../../jobs/stripe-sync.job', () => ({
  startStripeSyncJob: mockStartStripeSyncJob,
}));

vi.mock('../../jobs/trialExpiration.job', () => ({
  startTrialExpirationJob: mockStartTrialExpirationJob,
}));

vi.mock('../../jobs/dunning.job', () => ({
  startDunningJob: mockStartDunningJob,
}));

vi.mock('../../database', () => ({
  getDb: vi.fn(() => ({
    prepare: mockPrepare,
  })),
}));

vi.mock('../../services/database.backup.service', () => ({
  DatabaseBackupService: vi.fn().mockImplementation(function () {
    return {
      createBackup: mockCreateBackup,
    };
  }),
}));

vi.mock('../../services/inventory.service', () => ({
  InventoryService: vi.fn().mockImplementation(function () {
    return {
      bulkUpdateMarkdownStatuses: mockBulkUpdateMarkdownStatuses,
      autoCalculateMarkdownStatus: mockAutoCalculateMarkdownStatus,
    };
  }),
}));

import { InventoryService } from '../../services/inventory.service';
import { SchedulerService } from '../../services/scheduler.service';

describe('SchedulerService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSchedule.mockReturnValue({ stop: vi.fn() });
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
      const updateSpy = vi
        .spyOn(SchedulerService, 'updateAllInventoryMarkdownStatuses')
        .mockResolvedValue(undefined);
      const backupSpy = vi.spyOn(SchedulerService, 'createDatabaseBackup').mockResolvedValue();

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
          return { all: vi.fn(() => [{ id: 'org-1' }, { id: 'org-2' }]) };
        }

        if (sql.includes('FROM inventory_items')) {
          return {
            all: vi.fn((orgId: string) => [
              { id: orgId === 'org-1' ? 1 : 2, expiry_date: '2026-03-10' },
            ]),
          };
        }

        return { all: vi.fn(() => []) };
      });

      await SchedulerService.updateAllInventoryMarkdownStatuses();

      expect(InventoryService).toHaveBeenCalledTimes(2);
      expect(mockBulkUpdateMarkdownStatuses).toHaveBeenCalledTimes(2);
      expect(mockAutoCalculateMarkdownStatus).not.toHaveBeenCalled();
    });

    it('falls back to per-item updates when bulk update fails', async () => {
      mockPrepare.mockImplementation((sql: string) => {
        if (sql.includes('FROM organizations')) {
          return { all: vi.fn(() => [{ id: 'org-1' }]) };
        }

        if (sql.includes('FROM inventory_items')) {
          return {
            all: vi.fn(() => [
              { id: 1, expiry_date: '2026-03-10' },
              { id: 2, expiry_date: '2026-03-11' },
            ]),
          };
        }

        return { all: vi.fn(() => []) };
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
