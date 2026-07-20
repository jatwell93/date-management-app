import { Response, NextFunction } from 'express';
import { inject, injectable } from 'tsyringe';
import { AuthRequest } from '../middleware/auth.middleware';
import { DashboardService } from '../services/dashboard.service';
import { ServiceProvider } from '../services/service-provider';

type DashboardServiceFactory = (organizationId?: string) => DashboardService;

@injectable()
export class DashboardController {
  constructor(
    @inject('DashboardServiceFactory')
    private dashboardServiceFactory: DashboardServiceFactory,
  ) {}

  private getService(req: AuthRequest): DashboardService {
    return this.dashboardServiceFactory(req.organizationId);
  }

  async getDashboardData(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const dashboardData = await this.getService(req).getDashboardData();
      res.json(dashboardData);
    } catch (error) {
      next(error);
    }
  }
}

export function createDashboardController(): DashboardController {
  return new DashboardController((organizationId?: string) => {
    // Statically imported (was a lazy `require`): Vitest's ESM runner cannot
    // resolve a relative `require()` of `.ts` source, and the static import also
    // lets tests mock service-provider. No cycle: service-provider does not import
    // this controller.
    return new ServiceProvider({ organizationId }).getDashboardService();
  });
}
