import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { MarkdownConfigService } from '../services/markdown-config.service';
import type { MarkdownMatrixConfig } from '../../../shared/domain/markdown';

export class MarkdownConfigController {
  constructor(private serviceFactory: (orgId?: string) => MarkdownConfigService) {}

  private getService(req: AuthRequest): MarkdownConfigService {
    return this.serviceFactory(req.organizationId);
  }

  async getConfig(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const config = await this.getService(req).getConfig();
      res.json(config);
    } catch (error) {
      next(error);
    }
  }

  async updateConfig(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const matrix = req.body as MarkdownMatrixConfig;
      const config = await this.getService(req).updateConfig(matrix);
      res.json(config);
    } catch (error) {
      next(error);
    }
  }
}

export function createMarkdownConfigController(): MarkdownConfigController {
  return new MarkdownConfigController(
    (organizationId?: string) => new MarkdownConfigService(organizationId),
  );
}
