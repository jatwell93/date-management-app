import { PrismaClient } from '@prisma/client';
import { getDefaultDatabaseClient } from '../database/database-factory';
import { getOrganizationId } from '../utils/auth-bypass';
import { UploadStatus } from '../types/upload.types';

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
export class StorageQuotaService {
  private prisma: PrismaClient;
  private organizationId: string;

  constructor(organizationId?: string, prismaClient?: PrismaClient) {
    if (!organizationId || organizationId.trim() === '') {
      throw new Error('Organization ID is required and cannot be empty');
    }
    // Basic format validation - organization IDs should be UUID-like or alphanumeric strings
    if (!/^[a-zA-Z0-9_-]+$/.test(organizationId)) {
      throw new Error(
        'Organization ID format is invalid. Must contain only alphanumeric characters, hyphens, and underscores',
      );
    }
    if (organizationId.length > 100) {
      throw new Error('Organization ID is too long. Maximum 100 characters allowed');
    }

    this.organizationId = organizationId;
    this.prisma = prismaClient ?? getDefaultDatabaseClient();
  }

  /**
   * Get storage quota information for a tenant/organization
   *
   * @param subscriptionTier - Current subscription tier ('free', 'pro', 'enterprise')
   * @returns StorageQuotaInfo with usage and limits
   */
  async getStorageQuota(
    subscriptionTier: 'free' | 'pro' | 'enterprise' = 'free',
  ): Promise<StorageQuotaInfo> {
    // Calculate total bytes used by this organization
    const usedBytes = await this.calculateOrganizationStorageUsage();

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
   * Check if organization can upload a file of given size
   * Returns true if upload would not exceed quota
   */
  async canUploadFile(
    fileSizeBytes: number,
    subscriptionTier: 'free' | 'pro' | 'enterprise' = 'free',
  ): Promise<boolean> {
    const quota = await this.getStorageQuota(subscriptionTier);
    return quota.used + fileSizeBytes <= quota.limit;
  }

  /**
   * Calculate total storage usage for an organization
   * Updated to use organizationId instead of userId for proper multi-tenant support
   */
  private async calculateOrganizationStorageUsage(): Promise<number> {
    try {
      const result = await this.prisma.upload.aggregate({
        where: {
          organizationId: this.organizationId,
          status: UploadStatus.COMPLETED,
        },
        _sum: {
          fileSizeBytes: true,
        },
      });

      return result._sum.fileSizeBytes ?? 0;
    } catch (error) {
      console.error(
        `Failed to calculate storage usage for organization ${this.organizationId}:`,
        error,
      );
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
      // Use transaction to ensure both operations succeed or fail together
      await this.prisma.$transaction(async (tx) => {
        // Record the upload metadata with COMPLETED status.
        // Note: Status is COMPLETED (not PENDING/UPLOADING) because this records uploads
        // for quota tracking purposes, where storage is immediately counted against the org limit.
        // This differs from CSV processing workflows which may use different status transitions.
        // See: src/types/upload.types.ts for the full upload lifecycle documentation.
        await tx.upload.create({
          data: {
            organizationId,
            userId,
            fileKey,
            fileName,
            fileSizeBytes,
            contentType,
            status: UploadStatus.COMPLETED,
          },
        });

        // Update organization storage usage
        await tx.organizationUsage.upsert({
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
      });
    } catch (error) {
      console.warn('Failed to record upload metadata:', error);
      throw error;
    }
  }

  async markUploadDeleted(organizationId: string, fileKey: string): Promise<void> {
    try {
      // Use transaction to ensure both operations succeed or fail together
      await this.prisma.$transaction(async (tx) => {
        // Get the file size before marking as deleted
        const upload = (await tx.upload.findUnique({
          where: { fileKey },
          select: { fileSizeBytes: true },
        })) as { fileSizeBytes: number } | null;

        if (upload) {
          // Mark upload as deleted
          await tx.upload.update({
            where: { fileKey },
            data: { status: 'deleted' },
          });

          // Decrement organization storage usage
          await tx.organizationUsage.update({
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
      });
    } catch (error) {
      console.error('Failed to mark upload as deleted:', error);
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
    subscriptionTier: 'free' | 'pro' | 'enterprise' = 'free',
  ): Promise<string> {
    const quota = await this.getStorageQuota(subscriptionTier);
    return `${this.formatBytes(quota.used)} of ${quota.displayLimit}`;
  }
}
