import { Router, Response } from 'express';
import { StorageQuotaService } from '../services/storage-quota.service';
import { AuthRequest } from '../middleware/auth.middleware';

/**
 * Storage Quota Routes
 * Provides user storage usage and quota information
 */

const router = Router();

// Helper function to get services with organization context
function getStorageQuotaServiceForRequest(req: AuthRequest) {
  return new StorageQuotaService(req.organizationId);
}

/**
 * GET /api/storage-quota/:userId
 * Returns storage quota information for a user
 *
 * Query Parameters:
 * - tier: subscription tier ('free', 'pro', 'enterprise', default 'free')
 *
 * Response:
 * {
 *   used: number (bytes),
 *   limit: number (bytes),
 *   percentageUsed: number (0-100),
 *   tier: string,
 *   displayLimit: string,
 *   warningThreshold: number,
 *   isWarning: boolean
 * }
 */
router.get('/:userId', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const { tier = 'free' } = req.query;

    // Validate userId is numeric
    const userIdNum = parseInt(userId, 10);
    if (Number.isNaN(userIdNum)) {
      res.status(400).json({
        error: 'Invalid user ID',
        message: 'User ID must be a number',
      });
      return;
    }

    if (!req.userId) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'User authentication required',
      });
      return;
    }

    if (req.userId !== userIdNum) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'You can only access your own storage quota',
      });
      return;
    }

    // Validate organization ownership
    if (!req.organizationId) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Organization context required',
      });
      return;
    }

    // Validate tier
    const validTiers = ['free', 'pro', 'enterprise'];
    if (!validTiers.includes(tier as string)) {
      res.status(400).json({
        error: 'Invalid subscription tier',
        message: 'Tier must be: free, pro, or enterprise',
      });
      return;
    }

    // Get storage quota information
    const storageQuotaService = getStorageQuotaServiceForRequest(req);
    const quota = await storageQuotaService.getStorageQuota(tier as 'free' | 'pro' | 'enterprise');

    res.status(200).json(quota);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      error: 'Failed to retrieve storage quota',
      message,
    });
  }
});

/**
 * GET /api/storage-quota/:userId/can-upload
 * Check if user can upload a file of given size
 *
 * Query Parameters:
 * - size: file size in bytes (required)
 * - tier: subscription tier ('free', 'pro', 'enterprise', default 'free')
 *
 * Response:
 * {
 *   canUpload: boolean,
 *   reason?: string (if canUpload is false)
 * }
 */
router.get('/:userId/can-upload', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const { size, tier = 'free' } = req.query;

    // Validate parameters
    const userIdNum = parseInt(userId, 10);
    if (Number.isNaN(userIdNum)) {
      res.status(400).json({
        error: 'Invalid user ID',
        message: 'User ID must be a number',
      });
      return;
    }

    if (!req.userId) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'User authentication required',
      });
      return;
    }

    if (req.userId !== userIdNum) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'You can only check your own storage quota',
      });
      return;
    }

    // Validate organization ownership
    if (!req.organizationId) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Organization context required',
      });
      return;
    }

    if (!size || Number.isNaN(parseInt(size as string, 10))) {
      res.status(400).json({
        error: 'Missing file size',
        message: 'size query parameter is required and must be a number',
      });
      return;
    }

    const fileSizeBytes = parseInt(size as string, 10);
    const validTiers = ['free', 'pro', 'enterprise'];
    if (!validTiers.includes(tier as string)) {
      res.status(400).json({
        error: 'Invalid subscription tier',
        message: 'Tier must be: free, pro, or enterprise',
      });
      return;
    }

    // Check if user can upload
    const storageQuotaService = getStorageQuotaServiceForRequest(req);
    const canUpload = await storageQuotaService.canUploadFile(
      fileSizeBytes,
      tier as 'free' | 'pro' | 'enterprise',
    );

    if (canUpload) {
      res.status(200).json({
        canUpload: true,
      });
    } else {
      const quota = await storageQuotaService.getStorageQuota(
        tier as 'free' | 'pro' | 'enterprise',
      );

      res.status(200).json({
        canUpload: false,
        reason: `Upload would exceed quota. Currently using ${quota.percentageUsed}% of ${quota.displayLimit}`,
        remainingBytes: Math.max(0, quota.limit - quota.used),
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      error: 'Failed to check upload availability',
      message,
    });
  }
});

export default router;
