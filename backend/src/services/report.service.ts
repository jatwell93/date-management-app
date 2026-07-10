import { type DB } from '../database';
import {
  ReportRepository,
  MonthlyExpiryReport,
  MonthlyMarkdownReport,
  UsageReport,
  DailyUsageReportItem,
  DetailedExpiryReportItem,
  LossBySkuReportItem,
  LossByDepartmentReportItem,
  SellThroughByLevelItem,
  ItemsByUserReportItem,
  ItemsByDateReportItem,
  StoreWalkAuditCycle,
  DashboardAnalytics,
} from '../repositories/report.repository';
import { SchedulerService } from './scheduler.service';

/**
 * Report Service with Dependency Injection
 * Generates various reports for inventory management and analytics
 *
 * Task 8.4 & 8.6: Refactored to use DI pattern with repository
 */
export class ReportService {
  private repository: ReportRepository;

  /**
   * Constructor with dependency injection
   * @param db Database instance (injected)
   * @param organizationId Organization scope for all queries
   */
  constructor(
    private db: DB,
    organizationId: string,
  ) {
    this.repository = new ReportRepository(db, organizationId);
  }
  async getMonthlyExpiryReport(): Promise<MonthlyExpiryReport[]> {
    return this.repository.getMonthlyExpiryReport();
  }

  async getOverallExpiryReport(): Promise<MonthlyExpiryReport> {
    return this.repository.getOverallExpiryReport();
  }

  async getDetailedExpiryReport(): Promise<DetailedExpiryReportItem[]> {
    return this.repository.getDetailedExpiryReport();
  }

  async getActiveExpiryEntries(): Promise<DetailedExpiryReportItem[]> {
    return this.repository.getActiveExpiryEntries();
  }

  async getMonthlyMarkdownReport(): Promise<MonthlyMarkdownReport[]> {
    return this.repository.getMonthlyMarkdownReport();
  }

  async getUsageReport(): Promise<UsageReport[]> {
    return this.repository.getUsageReport();
  }

  async getDailyUsageReport(): Promise<DailyUsageReportItem[]> {
    return this.repository.getDailyUsageReport();
  }

  async getDashboardAnalytics(): Promise<DashboardAnalytics> {
    return this.repository.getDashboardAnalytics();
  }

  async updateAllMarkdownStatuses(): Promise<void> {
    return SchedulerService.updateAllInventoryMarkdownStatuses();
  }

  async getLossBySkuReport(): Promise<LossBySkuReportItem[]> {
    return this.repository.getLossBySkuReport();
  }

  async getLossByDepartmentReport(): Promise<LossByDepartmentReportItem[]> {
    return this.repository.getLossByDepartmentReport();
  }

  async getSellThroughByMarkdownLevel(): Promise<SellThroughByLevelItem[]> {
    return this.repository.getSellThroughByMarkdownLevel();
  }

  async getItemsByUserReport(timeFrame?: string): Promise<ItemsByUserReportItem[]> {
    return this.repository.getItemsByUserReport(timeFrame);
  }

  async getItemsByDateReport(): Promise<ItemsByDateReportItem[]> {
    return this.repository.getItemsByDateReport();
  }

  async getStoreWalkAuditReport(): Promise<StoreWalkAuditCycle[]> {
    return this.repository.getStoreWalkAuditReport();
  }
}

// Re-export interfaces for convenience
export type {
  MonthlyExpiryReport,
  MonthlyMarkdownReport,
  UsageReport,
  DailyUsageReportItem,
  LossBySkuReportItem,
  LossByDepartmentReportItem,
  ItemsByUserReportItem,
  ItemsByDateReportItem,
  StoreWalkAuditCycle,
  DashboardAnalytics,
};
