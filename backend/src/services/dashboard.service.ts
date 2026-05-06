import { DashboardData, ReportRepository } from '../repositories/report.repository';

export class DashboardService {
  constructor(private readonly reportRepository: Pick<ReportRepository, 'getDashboardData'>) {}

  async getDashboardData(): Promise<DashboardData> {
    return this.reportRepository.getDashboardData();
  }
}
