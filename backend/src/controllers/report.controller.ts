import { Response, NextFunction } from 'express';
import validator from 'validator';
import { inject, injectable } from 'tsyringe';
import { AuthRequest } from '../middleware/auth.middleware';
import { ReportService } from '../services/report.service';
import { ServiceProvider } from '../services/service-provider';

type ReportServiceFactory = (organizationId?: string) => ReportService;

@injectable()
export class ReportController {
  constructor(
    @inject('ReportServiceFactory')
    private reportServiceFactory: ReportServiceFactory,
  ) {}

  private getService(req: AuthRequest): ReportService {
    return this.reportServiceFactory(req.organizationId);
  }

  private async respondWithReport<T>(
    req: AuthRequest,
    res: Response,
    next: NextFunction,
    loadReport: (service: ReportService) => Promise<T>,
  ): Promise<void> {
    try {
      const report = await loadReport(this.getService(req));
      res.json(report);
    } catch (error) {
      next(error);
    }
  }

  async getMonthlyExpiryReport(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    await this.respondWithReport(req, res, next, (service) => service.getMonthlyExpiryReport());
  }

  async getOverallExpiryReport(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    await this.respondWithReport(req, res, next, (service) => service.getOverallExpiryReport());
  }

  async getDetailedExpiryReport(
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    await this.respondWithReport(req, res, next, (service) => service.getDetailedExpiryReport());
  }

  async getMonthlyMarkdownReport(
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    await this.respondWithReport(req, res, next, (service) => service.getMonthlyMarkdownReport());
  }

  async updateAllMarkdownStatuses(
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      await this.getService(req).updateAllMarkdownStatuses();
      res.json({ message: 'All inventory markdown statuses updated successfully.' });
    } catch (error) {
      next(error);
    }
  }

  async getUsageReport(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    await this.respondWithReport(req, res, next, (service) => service.getUsageReport());
  }

  async getDailyUsageReport(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    await this.respondWithReport(req, res, next, (service) => service.getDailyUsageReport());
  }

  async getLossBySkuReport(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    await this.respondWithReport(req, res, next, (service) => service.getLossBySkuReport());
  }

  async getLossByDepartmentReport(
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    await this.respondWithReport(req, res, next, (service) => service.getLossByDepartmentReport());
  }

  async getSellThroughReport(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    await this.respondWithReport(req, res, next, (service) =>
      service.getSellThroughByMarkdownLevel(),
    );
  }

  async getItemsByUserReport(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    const timeFrame = req.query.timeFrame as string | undefined;
    if (timeFrame && !validator.isInt(timeFrame, { min: 1, max: 3650 })) {
      res.status(400).json({ message: 'Invalid timeFrame value' });
      return;
    }

    await this.respondWithReport(req, res, next, (service) =>
      service.getItemsByUserReport(timeFrame),
    );
  }

  async getItemsByDateReport(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    await this.respondWithReport(req, res, next, (service) => service.getItemsByDateReport());
  }

  async getDashboardAnalytics(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    await this.respondWithReport(req, res, next, (service) => service.getDashboardAnalytics());
  }
}

export function createReportController(): ReportController {
  return new ReportController((organizationId?: string) => {
    // Statically imported (was a lazy `require`): Vitest's ESM runner cannot
    // resolve a relative `require()` of `.ts` source, and the static import also
    // lets tests mock service-provider. No cycle: service-provider does not import
    // this controller.
    return new ServiceProvider({ organizationId }).getReportService();
  });
}
