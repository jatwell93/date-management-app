import { Router, Response } from 'express';
import { createStorageQuotaController } from '../controllers/storage-quota.controller';
import { AuthRequest } from '../middleware/auth.middleware';

/**
 * Storage Quota Routes
 * Provides user storage usage and quota information
 */

const router = Router();

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

function routeErrorHandler(error: unknown, res: Response, responseError: string): void {
  res.status(500).json({
    error: responseError,
    message: getErrorMessage(error),
  });
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
  const controller = createStorageQuotaController();
  await controller.getStorageQuota(req, res, (error) =>
    routeErrorHandler(error, res, 'Failed to retrieve storage quota'),
  );
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
  const controller = createStorageQuotaController();
  await controller.canUpload(req, res, (error) =>
    routeErrorHandler(error, res, 'Failed to check upload availability'),
  );
});

export default router;
