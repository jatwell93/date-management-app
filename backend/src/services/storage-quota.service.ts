import { getDefaultDatabaseClient } from '../database/database-factory';
import { getOrganizationId } from '../utils/auth-bypass';

/**
 * Subscription tier configuration
 * Defines storage limits for each tier
 */
export interface SubscriptionTier {
  name: 'free' | 'pro' | 'enterprise';
  storageBytes: number; // bytes
  displayName: string;
}

export const SUBSCRIPTION_TIERS: Record<string, SubscriptionTier> = {
  free: {
    name: 'free',
    storageBytes: 1 * 1024 * 1024 * 1024, // 1GB
    displayName: 'Free',
  },
  pro: {
    name: 'pro',
    storageBytes: 10 * 1024 * 1024 * 1024, // 10GB
    displayName: 'Pro',
  },
  enterprise: {
    name: 'enterprise',
    storageBytes: 1000 * 1024 * 1024 * 1024, // 1TB (effectively unlimited)
    displayName: 'Enterprise',
  },
};

/**
 * Storage quota information returned to frontend
 */
export interface StorageQuotaInfo {
  used: number; // bytes used
  limit: number; // bytes allowed
  percentageUsed: number; // 0-100
  tier: string; // subscription tier name
  displayLimit: string; // human readable limit (e.g., "1GB")
  warningThreshold: number; // percentage (default 80)
  isWarning: boolean; // true if percentageUsed >= warningThreshold
}

/**
 * Storage Quota Service
 *
 * Tracks storage usage per tenant and enforces quota limits.
 */
const prisma = getDefaultDatabaseClient();

export class StorageQuotaService {
  private organizationId: string;

  constructor(organizationId?: string) {
    this.organizationId = getOrganizationId(organizationId);
  }

  /**
   * Get storage quota information for a tenant/user
   *
   * @param userId - User ID (for future multi-tenant support)
   * @param subscriptionTier - Current subscription tier ('free', 'pro', 'enterprise')
   * @returns StorageQuotaInfo with usage and limits
   */
  async getStorageQuota(
    userId: number,
    subscriptionTier: 'free' | 'pro' | 'enterprise' = 'free',
  ): Promise<StorageQuotaInfo> {
    // Calculate total bytes used by this user
    const usedBytes = await this.calculateUserStorageUsage(userId);

    // Get tier configuration
    const tierConfig = SUBSCRIPTION_TIERS[subscriptionTier];
    if (!tierConfig) {
      throw new Error(`Invalid subscription tier: ${subscriptionTier}`);
    }

    // Calculate percentage
    const percentageUsed = (usedBytes / tierConfig.storageBytes) * 100;

    // Check if warning threshold exceeded
    const warningThreshold = 80; // percent
    const isWarning = percentageUsed >= warningThreshold;

    return {
      used: usedBytes,
      limit: tierConfig.storageBytes,
      percentageUsed: Math.round(percentageUsed * 10) / 10, // Round to 1 decimal
      tier: subscriptionTier,
      displayLimit: this.formatBytes(tierConfig.storageBytes),
      warningThreshold,
      isWarning,
    };
  }

  /**
   * Check if user can upload a file of given size
   * Returns true if upload would not exceed quota
   */
  async canUploadFile(
    userId: number,
    fileSizeBytes: number,
    subscriptionTier: 'free' | 'pro' | 'enterprise' = 'free',
  ): Promise<boolean> {
    const quota = await this.getStorageQuota(userId, subscriptionTier);
    return quota.used + fileSizeBytes <= quota.limit;
  }

  /**
   * Calculate total storage usage for a user
   *
   * TODO: Update to use actual file metadata tracking
   * Current implementation estimates from S3/R2 object listing
   */
  private async calculateUserStorageUsage(userId: number): Promise<number> {
    try {
      const result = await prisma.upload.aggregate({
        where: {
          userId,
          status: 'completed',
        },
        _sum: {
          fileSizeBytes: true,
        },
      });

      return result._sum.fileSizeBytes ?? 0;
    } catch (error) {
      console.error(`Failed to calculate storage usage for user ${userId}:`, error);
      return 0;
    }
  }

  async recordUpload(
    organizationId: string,
    userId: number,
    fileKey: string,
    fileName: string,
    fileSizeBytes: number,
    contentType?: string,
  ): Promise<void> {
    try {
      // Record the upload metadata
      await prisma.upload.create({
        data: {
          organizationId,
          userId,
          fileKey,
          fileName,
          fileSizeBytes,
          contentType,
          status: 'completed',
        },
      });

      // Update organization storage usage
      await prisma.organizationUsage.upsert({
        where: {
          organizationId,
        },
        update: {
          storageUsedBytes: {
            increment: fileSizeBytes,
          },
        },
        create: {
          organizationId,
          storageUsedBytes: fileSizeBytes,
          totalSkus: 0,
          activeUsers: 0,
          maxUsers: 0, // Will be set by subscription tier
          maxSkus: 0, // Will be set by subscription tier
        },
      });
    } catch (error) {
      console.warn('Failed to record upload metadata:', error);
      throw error;
    }
  }

  async markUploadDeleted(organizationId: string, fileKey: string): Promise<void> {
    try {
      // Get the file size before marking as deleted
      const upload = await prisma.upload.findUnique({
        where: { fileKey },
        select: { fileSizeBytes: true },
      });

      if (upload) {
        // Mark upload as deleted
        await prisma.upload.update({
          where: { fileKey },
          data: { status: 'deleted' },
        });

        // Decrement organization storage usage
        await prisma.organizationUsage.update({
          where: {
            organizationId,
          },
          data: {
            storageUsedBytes: {
              decrement: upload.fileSizeBytes,
            },
          },
        });
      }
    } catch (error) {
      console.warn(`Failed to mark upload ${fileKey} as deleted:`, error);
      throw error;
    }
  }

  /**
   * Format bytes to human-readable string
   * Examples: "1.5 MB", "2.3 GB"
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Get human-readable storage usage string
   * Example: "245 MB of 1 GB"
   */
  async getStorageUsageString(
    userId: number,
    subscriptionTier: 'free' | 'pro' | 'enterprise' = 'free',
  ): Promise<string> {
    const quota = await this.getStorageQuota(userId, subscriptionTier);
    return `${this.formatBytes(quota.used)} of ${quota.displayLimit}`;
  }
}
