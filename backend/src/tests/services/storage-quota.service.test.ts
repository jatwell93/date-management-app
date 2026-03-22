import { StorageQuotaService, SUBSCRIPTION_TIERS } from '../../services/storage-quota.service';

// Mock Prisma
jest.mock('../../database/database-factory', () => {
  const mockPrisma: any = {
    upload: {
      aggregate: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
    },
    organizationUsage: {
      upsert: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn((callback: (client: any) => any) => callback(mockPrisma)),
    $executeRaw: jest.fn(),
  };
  return {
    getDefaultDatabaseClient: jest.fn(() => mockPrisma),
  };
});

import { getDefaultDatabaseClient } from '../../database/database-factory';

describe('StorageQuotaService', () => {
  let service: StorageQuotaService;
  let mockPrisma: any;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new StorageQuotaService('test-org');
    mockPrisma = getDefaultDatabaseClient();
  });

  describe('Quota tier constants', () => {
    it('should define correct storage limits for each tier', () => {
      expect(SUBSCRIPTION_TIERS.free.storageBytes).toBe(1 * 1024 * 1024 * 1024); // 1GB
      expect(SUBSCRIPTION_TIERS.pro.storageBytes).toBe(10 * 1024 * 1024 * 1024); // 10GB
      expect(SUBSCRIPTION_TIERS.enterprise.storageBytes).toBe(1000 * 1024 * 1024 * 1024); // 1TB
    });
  });

  describe('getStorageQuota - Free Tier (1GB)', () => {
    const FREE_TIER_LIMIT = 1 * 1024 * 1024 * 1024; // 1GB
    const userId = 1;

    it('should return no warning when usage is 0%', async () => {
      mockPrisma.upload.aggregate.mockResolvedValue({
        _sum: { fileSizeBytes: 0 },
      });

      const result = await service.getStorageQuota('free');

      expect(result).toMatchObject({
        used: 0,
        limit: FREE_TIER_LIMIT,
        percentageUsed: 0,
        tier: 'free',
        displayLimit: '1 GB',
        warningThreshold: 80,
        isWarning: false,
      });
    });

    it('should return no warning when usage is 50%', async () => {
      const halfGig = 512 * 1024 * 1024; // 512MB
      mockPrisma.upload.aggregate.mockResolvedValue({
        _sum: { fileSizeBytes: halfGig },
      });

      const result = await service.getStorageQuota('free');

      expect(result.used).toBe(halfGig);
      expect(result.percentageUsed).toBeCloseTo(50, 0);
      expect(result.isWarning).toBe(false);
    });

    it('should return no warning when usage is just below 80%', async () => {
      const justBelow = Math.floor(FREE_TIER_LIMIT * 0.79); // 79%
      mockPrisma.upload.aggregate.mockResolvedValue({
        _sum: { fileSizeBytes: justBelow },
      });

      const result = await service.getStorageQuota('free');

      expect(result.percentageUsed).toBeLessThan(80);
      expect(result.isWarning).toBe(false);
    });

    it('should return warning when usage is exactly 80%', async () => {
      // Use Math.ceil to ensure we get at least 80%
      const exactly80 = Math.ceil(FREE_TIER_LIMIT * 0.8); // 80%
      mockPrisma.upload.aggregate.mockResolvedValue({
        _sum: { fileSizeBytes: exactly80 },
      });

      const result = await service.getStorageQuota('free');

      expect(result.percentageUsed).toBeGreaterThanOrEqual(80);
      expect(result.isWarning).toBe(true);
    });

    it('should return warning when usage is 90%', async () => {
      const ninety = Math.floor(FREE_TIER_LIMIT * 0.9); // 90%
      mockPrisma.upload.aggregate.mockResolvedValue({
        _sum: { fileSizeBytes: ninety },
      });

      const result = await service.getStorageQuota('free');

      expect(result.percentageUsed).toBeCloseTo(90, 0);
      expect(result.isWarning).toBe(true);
    });

    it('should return warning when usage is at 100%', async () => {
      mockPrisma.upload.aggregate.mockResolvedValue({
        _sum: { fileSizeBytes: FREE_TIER_LIMIT },
      });

      const result = await service.getStorageQuota('free');

      expect(result.percentageUsed).toBe(100);
      expect(result.used).toBe(result.limit);
      expect(result.isWarning).toBe(true);
    });

    it('should handle over-quota usage (>100%)', async () => {
      const overQuota = Math.floor(FREE_TIER_LIMIT * 1.1); // 110%
      mockPrisma.upload.aggregate.mockResolvedValue({
        _sum: { fileSizeBytes: overQuota },
      });

      const result = await service.getStorageQuota('free');

      expect(result.percentageUsed).toBeGreaterThan(100);
      expect(result.isWarning).toBe(true);
    });
  });

  describe('getStorageQuota - Pro Tier (10GB)', () => {
    const PRO_TIER_LIMIT = 10 * 1024 * 1024 * 1024; // 10GB
    const userId = 2;

    it('should return no warning when usage is 5GB (50%)', async () => {
      const fiveGig = 5 * 1024 * 1024 * 1024;
      mockPrisma.upload.aggregate.mockResolvedValue({
        _sum: { fileSizeBytes: fiveGig },
      });

      const result = await service.getStorageQuota('pro');

      expect(result.used).toBe(fiveGig);
      expect(result.limit).toBe(PRO_TIER_LIMIT);
      expect(result.percentageUsed).toBeCloseTo(50, 0);
      expect(result.tier).toBe('pro');
      expect(result.displayLimit).toBe('10 GB');
      expect(result.isWarning).toBe(false);
    });

    it('should return warning when usage is 8.5GB (85%)', async () => {
      const eightyFivePercent = Math.floor(PRO_TIER_LIMIT * 0.85);
      mockPrisma.upload.aggregate.mockResolvedValue({
        _sum: { fileSizeBytes: eightyFivePercent },
      });

      const result = await service.getStorageQuota('pro');

      expect(result.percentageUsed).toBeCloseTo(85, 0);
      expect(result.isWarning).toBe(true);
    });

    it('should return warning at 80% threshold (8GB)', async () => {
      // Use Math.ceil to ensure we get at least 80%
      const exactly80 = Math.ceil(PRO_TIER_LIMIT * 0.8); // 8GB
      mockPrisma.upload.aggregate.mockResolvedValue({
        _sum: { fileSizeBytes: exactly80 },
      });

      const result = await service.getStorageQuota('pro');

      expect(result.percentageUsed).toBeGreaterThanOrEqual(80);
      expect(result.isWarning).toBe(true);
    });

    it('should handle 9.5GB usage (95%)', async () => {
      const ninePointFiveGig = Math.floor(PRO_TIER_LIMIT * 0.95);
      mockPrisma.upload.aggregate.mockResolvedValue({
        _sum: { fileSizeBytes: ninePointFiveGig },
      });

      const result = await service.getStorageQuota('pro');

      expect(result.percentageUsed).toBeCloseTo(95, 0);
      expect(result.isWarning).toBe(true);
    });
  });

  describe('getStorageQuota - Enterprise Tier (1TB)', () => {
    const ENTERPRISE_LIMIT = 1000 * 1024 * 1024 * 1024; // 1TB
    const userId = 3;

    it('should handle large usage without warning (500GB = 50%)', async () => {
      const fiveHundredGig = 500 * 1024 * 1024 * 1024;
      mockPrisma.upload.aggregate.mockResolvedValue({
        _sum: { fileSizeBytes: fiveHundredGig },
      });

      const result = await service.getStorageQuota('enterprise');

      expect(result.used).toBe(fiveHundredGig);
      expect(result.limit).toBe(ENTERPRISE_LIMIT);
      expect(result.percentageUsed).toBeCloseTo(50, 0);
      expect(result.tier).toBe('enterprise');
      expect(result.displayLimit).toBe('1000 GB');
      expect(result.isWarning).toBe(false);
    });

    it('should return warning at 80% threshold (800GB)', async () => {
      // Use Math.ceil to ensure we get at least 80%
      const exactly80 = Math.ceil(ENTERPRISE_LIMIT * 0.8); // 800GB
      mockPrisma.upload.aggregate.mockResolvedValue({
        _sum: { fileSizeBytes: exactly80 },
      });

      const result = await service.getStorageQuota('enterprise');

      expect(result.percentageUsed).toBeGreaterThanOrEqual(80);
      expect(result.isWarning).toBe(true);
    });

    it('should handle near-limit usage (950GB = 95%)', async () => {
      const nineHundredFiftyGig = Math.floor(ENTERPRISE_LIMIT * 0.95);
      mockPrisma.upload.aggregate.mockResolvedValue({
        _sum: { fileSizeBytes: nineHundredFiftyGig },
      });

      const result = await service.getStorageQuota('enterprise');

      expect(result.percentageUsed).toBeCloseTo(95, 0);
      expect(result.isWarning).toBe(true);
    });
  });

  describe('canUploadFile', () => {
    const userId = 1;

    it('should allow upload when well under quota (Free tier)', async () => {
      const currentUsage = 100 * 1024 * 1024; // 100MB
      const fileSize = 50 * 1024 * 1024; // 50MB
      mockPrisma.upload.aggregate.mockResolvedValue({
        _sum: { fileSizeBytes: currentUsage },
      });

      const canUpload = await service.canUploadFile(fileSize, 'free');

      expect(canUpload).toBe(true);
    });

    it('should reject upload when it would exceed quota (Free tier)', async () => {
      const currentUsage = 900 * 1024 * 1024; // 900MB
      const fileSize = 200 * 1024 * 1024; // 200MB (would exceed 1GB)
      mockPrisma.upload.aggregate.mockResolvedValue({
        _sum: { fileSizeBytes: currentUsage },
      });

      const canUpload = await service.canUploadFile(fileSize, 'free');

      expect(canUpload).toBe(false);
    });

    it('should allow upload exactly at quota limit', async () => {
      const freeLimit = 1 * 1024 * 1024 * 1024;
      const currentUsage = 900 * 1024 * 1024; // 900MB
      const fileSize = freeLimit - currentUsage; // Exactly fills to limit
      mockPrisma.upload.aggregate.mockResolvedValue({
        _sum: { fileSizeBytes: currentUsage },
      });

      const canUpload = await service.canUploadFile(fileSize, 'free');

      expect(canUpload).toBe(true);
    });

    it('should reject upload one byte over quota', async () => {
      const freeLimit = 1 * 1024 * 1024 * 1024;
      const currentUsage = 900 * 1024 * 1024; // 900MB
      const fileSize = freeLimit - currentUsage + 1; // One byte over
      mockPrisma.upload.aggregate.mockResolvedValue({
        _sum: { fileSizeBytes: currentUsage },
      });

      const canUpload = await service.canUploadFile(fileSize, 'free');

      expect(canUpload).toBe(false);
    });

    it('should allow large uploads on Pro tier', async () => {
      const currentUsage = 2 * 1024 * 1024 * 1024; // 2GB
      const fileSize = 5 * 1024 * 1024 * 1024; // 5GB
      mockPrisma.upload.aggregate.mockResolvedValue({
        _sum: { fileSizeBytes: currentUsage },
      });

      const canUpload = await service.canUploadFile(fileSize, 'pro');

      expect(canUpload).toBe(true); // 2GB + 5GB = 7GB < 10GB limit
    });

    it('should allow very large uploads on Enterprise tier', async () => {
      const currentUsage = 100 * 1024 * 1024 * 1024; // 100GB
      const fileSize = 500 * 1024 * 1024 * 1024; // 500GB
      mockPrisma.upload.aggregate.mockResolvedValue({
        _sum: { fileSizeBytes: currentUsage },
      });

      const canUpload = await service.canUploadFile(fileSize, 'enterprise');

      expect(canUpload).toBe(true); // 100GB + 500GB = 600GB < 1TB limit
    });
  });

  describe('recordUpload', () => {
    it('should create upload record with correct data', async () => {
      const organizationId = 'org-123';
      const userId = 1;
      const fileKey = 'uploads/test-file.csv';
      const fileName = 'test-file.csv';
      const fileSizeBytes = 1024 * 1024; // 1MB
      const contentType = 'text/csv';

      mockPrisma.upload.create.mockResolvedValue({
        id: 1,
        userId,
        fileKey,
        fileName,
        fileSizeBytes,
        contentType,
        status: 'processing',
      });

      await service.recordUpload(
        organizationId,
        userId,
        fileKey,
        fileName,
        fileSizeBytes,
        contentType,
      );

      expect(mockPrisma.upload.create).toHaveBeenCalledWith({
        data: {
          organizationId,
          userId,
          fileKey,
          fileName,
          fileSizeBytes,
          contentType,
          status: 'processing',
        },
      });

      expect(mockPrisma.organizationUsage.upsert).toHaveBeenCalledWith({
        where: { organizationId },
        update: {
          storageUsedBytes: { increment: fileSizeBytes },
        },
        create: {
          organizationId,
          storageUsedBytes: fileSizeBytes,
          totalSkus: 0,
          activeUsers: 0,
          maxUsers: 0,
          maxSkus: 0,
        },
      });
    });

    it('should handle recordUpload errors gracefully', async () => {
      mockPrisma.upload.create.mockRejectedValue(new Error('Database error'));

      // Service logs and re-throws the error
      await expect(service.recordUpload('org-123', 1, 'key', 'file.csv', 1000)).rejects.toThrow(
        'Database error',
      );
    });
  });

  describe('markUploadDeleted', () => {
    it('should update upload status to deleted', async () => {
      const organizationId = 'org-123';
      const fileKey = 'uploads/test-file.csv';

      mockPrisma.upload.findUnique.mockResolvedValue({
        id: 1,
        fileKey,
        fileSizeBytes: 1024,
      });

      mockPrisma.upload.update.mockResolvedValue({
        id: 1,
        status: 'deleted',
      });

      await service.markUploadDeleted(organizationId, fileKey);

      expect(mockPrisma.upload.findUnique).toHaveBeenCalledWith({
        where: { fileKey },
        select: { fileSizeBytes: true },
      });
      expect(mockPrisma.upload.update).toHaveBeenCalledWith({
        where: { fileKey },
        data: { status: 'deleted' },
      });

      expect(mockPrisma.organizationUsage.update).toHaveBeenCalledWith({
        where: { organizationId },
        data: {
          storageUsedBytes: { decrement: 1024 },
        },
      });
    });

    it('should handle markUploadDeleted errors gracefully', async () => {
      mockPrisma.upload.findUnique.mockResolvedValue(null);

      // Should not throw - graceful degradation
      await expect(service.markUploadDeleted('org-123', 'missing-key')).resolves.not.toThrow();
    });
  });

  describe('getStorageUsageString', () => {
    it('should format usage string correctly for small usage', async () => {
      const userId = 1;
      const usage = 245 * 1024 * 1024; // 245MB
      mockPrisma.upload.aggregate.mockResolvedValue({
        _sum: { fileSizeBytes: usage },
      });

      const result = await service.getStorageUsageString('free');

      expect(result).toMatch(/^245 MB of 1 GB$/);
    });

    it('should format usage string correctly for large usage', async () => {
      const userId = 2;
      const usage = 7.5 * 1024 * 1024 * 1024; // 7.5GB
      mockPrisma.upload.aggregate.mockResolvedValue({
        _sum: { fileSizeBytes: usage },
      });

      const result = await service.getStorageUsageString('pro');

      expect(result).toMatch(/^7\.5 GB of 10 GB$/);
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle null aggregate result (no uploads)', async () => {
      mockPrisma.upload.aggregate.mockResolvedValue({
        _sum: { fileSizeBytes: null },
      });

      const result = await service.getStorageQuota('free');

      expect(result.used).toBe(0);
      expect(result.percentageUsed).toBe(0);
    });

    it('should throw error for invalid subscription tier', async () => {
      mockPrisma.upload.aggregate.mockResolvedValue({
        _sum: { fileSizeBytes: 0 },
      });

      await expect(service.getStorageQuota('invalid' as any)).rejects.toThrow(
        'Invalid subscription tier: invalid',
      );
    });

    it('should handle database errors in calculateUserStorageUsage', async () => {
      mockPrisma.upload.aggregate.mockRejectedValue(new Error('Connection lost'));

      const result = await service.getStorageQuota('free');

      // Should return 0 usage on error (graceful degradation)
      expect(result.used).toBe(0);
    });

    it('should round percentage to 1 decimal place', async () => {
      const freeLimit = 1 * 1024 * 1024 * 1024;
      const usage = Math.floor(freeLimit * 0.876); // 87.6%
      mockPrisma.upload.aggregate.mockResolvedValue({
        _sum: { fileSizeBytes: usage },
      });

      const result = await service.getStorageQuota('free');

      // Should round to 87.6, not include more decimals
      expect(result.percentageUsed.toString()).toMatch(/^\d+\.\d$/);
    });
  });

  describe('Cross-tier consistency', () => {
    it('80% threshold should consistently trigger warnings across all tiers', async () => {
      const tiers: Array<'free' | 'pro' | 'enterprise'> = ['free', 'pro', 'enterprise'];

      for (const tier of tiers) {
        const limit = SUBSCRIPTION_TIERS[tier].storageBytes;
        // Use Math.ceil to ensure we get at least 80%
        const usage = Math.ceil(limit * 0.8);

        mockPrisma.upload.aggregate.mockResolvedValue({
          _sum: { fileSizeBytes: usage },
        });

        const result = await service.getStorageQuota(tier);

        expect(result.isWarning).toBe(true);
        expect(result.warningThreshold).toBe(80);
      }
    });

    it('79% should not trigger warnings across all tiers', async () => {
      const tiers: Array<'free' | 'pro' | 'enterprise'> = ['free', 'pro', 'enterprise'];

      for (const tier of tiers) {
        const limit = SUBSCRIPTION_TIERS[tier].storageBytes;
        const usage = Math.floor(limit * 0.79);

        mockPrisma.upload.aggregate.mockResolvedValue({
          _sum: { fileSizeBytes: usage },
        });

        const result = await service.getStorageQuota(tier);

        expect(result.isWarning).toBe(false);
      }
    });
  });
});
