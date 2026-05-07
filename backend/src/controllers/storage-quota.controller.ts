import { Response, NextFunction } from 'express';
import { inject, injectable } from 'tsyringe';
import { AuthRequest } from '../middleware/auth.middleware';
import { StorageQuotaService } from '../services/storage-quota.service';

type SubscriptionTierName = 'free' | 'pro' | 'enterprise';
type StorageQuotaServiceFactory = (organizationId?: string) => StorageQuotaService;

const VALID_TIERS: SubscriptionTierName[] = ['free', 'pro', 'enterprise'];

@injectable()
export class StorageQuotaController {
  constructor(
    @inject('StorageQuotaServiceFactory')
    private storageQuotaServiceFactory: StorageQuotaServiceFactory,
  ) {}

  private getService(req: AuthRequest): StorageQuotaService {
    return this.storageQuotaServiceFactory(req.organizationId);
  }

  private parseUserId(req: AuthRequest, res: Response): number | undefined {
    const userId = Number.parseInt(req.params.userId, 10);
    if (Number.isNaN(userId)) {
      res.status(400).json({
        error: 'Invalid user ID',
        message: 'User ID must be a number',
      });
      return undefined;
    }

    return userId;
  }

  private validateAccess(req: AuthRequest, res: Response, actionMessage: string): boolean {
    const userId = this.parseUserId(req, res);
    if (userId === undefined) return false;

    if (!req.userId) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'User authentication required',
      });
      return false;
    }

    if (req.userId !== userId) {
      res.status(403).json({
        error: 'Forbidden',
        message: actionMessage,
      });
      return false;
    }

    if (!req.organizationId) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Organization context required',
      });
      return false;
    }

    return true;
  }

  private parseTier(req: AuthRequest, res: Response): SubscriptionTierName | undefined {
    const tier = (req.query.tier ?? 'free') as string;
    if (!VALID_TIERS.includes(tier as SubscriptionTierName)) {
      res.status(400).json({
        error: 'Invalid subscription tier',
        message: 'Tier must be: free, pro, or enterprise',
      });
      return undefined;
    }

    return tier as SubscriptionTierName;
  }

  private parseFileSize(req: AuthRequest, res: Response): number | undefined {
    const { size } = req.query;
    if (!size || Number.isNaN(Number.parseInt(size as string, 10))) {
      res.status(400).json({
        error: 'Missing file size',
        message: 'size query parameter is required and must be a number',
      });
      return undefined;
    }

    return Number.parseInt(size as string, 10);
  }

  async getStorageQuota(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!this.validateAccess(req, res, 'You can only access your own storage quota')) return;

      const tier = this.parseTier(req, res);
      if (!tier) return;

      const quota = await this.getService(req).getStorageQuota(tier);
      res.status(200).json(quota);
    } catch (error) {
      next(error);
    }
  }

  async canUpload(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!this.validateAccess(req, res, 'You can only check your own storage quota')) return;

      const fileSizeBytes = this.parseFileSize(req, res);
      if (fileSizeBytes === undefined) return;

      const tier = this.parseTier(req, res);
      if (!tier) return;

      const service = this.getService(req);
      const canUpload = await service.canUploadFile(fileSizeBytes, tier);

      if (canUpload) {
        res.status(200).json({ canUpload: true });
        return;
      }

      const quota = await service.getStorageQuota(tier);
      res.status(200).json({
        canUpload: false,
        reason: `Upload would exceed quota. Currently using ${quota.percentageUsed}% of ${quota.displayLimit}`,
        remainingBytes: Math.max(0, quota.limit - quota.used),
      });
    } catch (error) {
      next(error);
    }
  }
}

export function createStorageQuotaController(): StorageQuotaController {
  return new StorageQuotaController(
    (organizationId?: string) => new StorageQuotaService(organizationId),
  );
}
