import { PrismaClient } from '@prisma/client';
import { Logger } from '../utils/logger';
import { getDefaultDatabaseClient } from '../database/database-factory';
import { SaasMetricsService } from './saas-metrics.service';
import { EmailService } from './email.service';
import { ALERT_THRESHOLDS } from '../types/subscription';

export interface DailyReport {
  date: Date;
  summary: {
    newTrials: number;
    conversions: number;
    churns: number;
    revenueChange: number;
    revenueChangePercent: number;
    trialConversionRate: number;
    churnRate: number;
  };
  metrics: {
    totalActiveSubscriptions: number;
    monthlyRecurringRevenue: number;
    avgRevenuePerUser: number;
    webhookFailureRate: number;
  };
  tierDistribution: Record<string, number>;
  alerts: Array<{
    type: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    message: string;
  }>;
  trends: {
    revenue: 'increasing' | 'decreasing' | 'stable';
    conversions: 'increasing' | 'decreasing' | 'stable';
    churn: 'increasing' | 'decreasing' | 'stable';
  };
}

/**
 * Daily Report Service
 * Generates and sends daily business reports
 */
export class DailyReportService {
  private prisma: PrismaClient;
  private saasMetricsService: SaasMetricsService;
  private emailService: EmailService;

  constructor(
    prismaClient?: PrismaClient,
    saasMetricsService?: SaasMetricsService,
    emailService?: EmailService,
  ) {
    this.prisma = prismaClient ?? getDefaultDatabaseClient();
    this.saasMetricsService = saasMetricsService ?? new SaasMetricsService(this.prisma);
    this.emailService = emailService ?? new EmailService(this.prisma);
  }

  /**
   * Generate a daily report for the given date
   */
  async generateDailyReport(date: Date): Promise<DailyReport> {
    const reportDate = new Date(date);
    reportDate.setHours(0, 0, 0, 0);

    Logger.info('Generating daily report', { date: reportDate.toISOString() });

    try {
      // Get current metrics
      const currentMetrics = await this.saasMetricsService.getSaasMetrics();
      if (!currentMetrics) {
        throw new Error('Failed to retrieve current metrics');
      }

      // Get previous day's metrics for comparison
      const previousDate = new Date(reportDate);
      previousDate.setDate(previousDate.getDate() - 1);

      const previousSnapshot = await this.prisma.metricsSnapshot.findUnique({
        where: { date: previousDate },
      });

      // Get metrics from 7 days ago for trend analysis
      const weekAgoDate = new Date(reportDate);
      weekAgoDate.setDate(weekAgoDate.getDate() - 7);

      const weekAgoSnapshot = await this.prisma.metricsSnapshot.findUnique({
        where: { date: weekAgoDate },
      });

      // Calculate summary
      const summary = {
        newTrials: currentMetrics.newTrialsThisMonth,
        conversions: currentMetrics.conversionsThisMonth,
        churns: currentMetrics.churnsThisMonth,
        revenueChange: 0,
        revenueChangePercent: 0,
        trialConversionRate: currentMetrics.trialConversionRate,
        churnRate: currentMetrics.churnRate,
      };

      // Calculate revenue change
      if (previousSnapshot) {
        const revenueChange =
          currentMetrics.monthlyRecurringRevenue - previousSnapshot.totalRevenueCents / 100;
        summary.revenueChange = revenueChange;
        summary.revenueChangePercent =
          previousSnapshot.totalRevenueCents > 0
            ? (revenueChange / (previousSnapshot.totalRevenueCents / 100)) * 100
            : 0;
      }

      // Determine trends
      const trends = {
        revenue: this.determineTrend(
          currentMetrics.monthlyRecurringRevenue,
          previousSnapshot?.totalRevenueCents
            ? previousSnapshot.totalRevenueCents / 100
            : undefined,
          weekAgoSnapshot?.totalRevenueCents ? weekAgoSnapshot.totalRevenueCents / 100 : undefined,
        ),
        conversions: this.determineTrend(
          currentMetrics.conversionsThisMonth,
          previousSnapshot?.totalConversions,
          weekAgoSnapshot?.totalConversions,
        ),
        churn: this.determineTrend(
          currentMetrics.churnsThisMonth,
          previousSnapshot?.totalChurn,
          weekAgoSnapshot?.totalChurn,
        ),
      };

      // Check for alerts
      const alerts = await this.checkAlerts(currentMetrics);

      const report: DailyReport = {
        date: reportDate,
        summary,
        metrics: {
          totalActiveSubscriptions: currentMetrics.totalActiveSubscriptions,
          monthlyRecurringRevenue: currentMetrics.monthlyRecurringRevenue,
          avgRevenuePerUser: currentMetrics.avgRevenuePerUser,
          webhookFailureRate: currentMetrics.webhookFailureRate,
        },
        tierDistribution: currentMetrics.tierDistribution,
        alerts,
        trends,
      };

      Logger.info('Daily report generated successfully', {
        date: reportDate.toISOString(),
        revenue: report.metrics.monthlyRecurringRevenue,
        conversions: report.summary.conversions,
        churns: report.summary.churns,
      });

      return report;
    } catch (error) {
      Logger.error('Failed to generate daily report', {
        error: error instanceof Error ? error.message : 'Unknown error',
        date: reportDate.toISOString(),
      });
      throw error;
    }
  }

  /**
   * Send daily report via email
   */
  async sendDailyReport(report: DailyReport, recipients: string[]): Promise<void> {
    try {
      const htmlContent = this.generateHtmlReport(report);
      const subject = `Daily Business Report - ${report.date.toLocaleDateString()}`;

      // Use bulk email sending for better rate limit handling
      await this.emailService.sendBulkEmail({
        to: recipients,
        subject,
        html: htmlContent,
        templateData: report,
      });

      Logger.info('Daily report sent successfully', {
        date: report.date.toISOString(),
        recipients: recipients.length,
      });
    } catch (error) {
      Logger.error('Failed to send daily report', {
        error: error instanceof Error ? error.message : 'Unknown error',
        date: report.date.toISOString(),
        recipients,
      });
      throw error;
    }
  }

  /**
   * Generate HTML content for the report
   */
  private generateHtmlReport(report: DailyReport): string {
    const revenueChangeClass = report.summary.revenueChange >= 0 ? 'positive' : 'negative';
    const revenueChangeSymbol = report.summary.revenueChange >= 0 ? '+' : '';

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Daily Business Report</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background-color: #f5f5f5; }
          .container { max-width: 800px; margin: 0 auto; background-color: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          .header { border-bottom: 2px solid #e0e0e0; padding-bottom: 20px; margin-bottom: 30px; }
          .header h1 { color: #333; margin: 0; font-size: 28px; }
          .header p { color: #666; margin: 5px 0 0 0; }
          .section { margin-bottom: 30px; }
          .section h2 { color: #333; font-size: 20px; margin-bottom: 15px; }
          .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; }
          .metric { background-color: #f8f9fa; padding: 20px; border-radius: 6px; text-align: center; }
          .metric-value { font-size: 24px; font-weight: bold; color: #333; }
          .metric-label { font-size: 14px; color: #666; margin-top: 5px; }
          .positive { color: #28a745; }
          .negative { color: #dc3545; }
          .alert { padding: 15px; border-radius: 6px; margin-bottom: 10px; }
          .alert-critical { background-color: #f8d7da; border: 1px solid #f5c6cb; color: #721c24; }
          .alert-high { background-color: #fff3cd; border: 1px solid #ffeaa7; color: #856404; }
          .trend { font-weight: bold; text-transform: uppercase; font-size: 12px; padding: 2px 8px; border-radius: 12px; }
          .trend-increasing { background-color: #d4edda; color: #155724; }
          .trend-decreasing { background-color: #f8d7da; color: #721c24; }
          .trend-stable { background-color: #e2e3e5; color: #383d41; }
          table { width: 100%; border-collapse: collapse; margin-top: 15px; }
          th, td { padding: 12px; text-align: left; border-bottom: 1px solid #e0e0e0; }
          th { background-color: #f8f9fa; font-weight: 600; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Daily Business Report</h1>
            <p>${report.date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
          </div>

          <div class="section">
            <h2>📊 Summary</h2>
            <div class="metrics">
              <div class="metric">
                <div class="metric-value">${report.summary.newTrials}</div>
                <div class="metric-label">New Trials</div>
              </div>
              <div class="metric">
                <div class="metric-value">${report.summary.conversions}</div>
                <div class="metric-label">Conversions</div>
              </div>
              <div class="metric">
                <div class="metric-value">${report.summary.churns}</div>
                <div class="metric-label">Churns</div>
              </div>
              <div class="metric">
                <div class="metric-value ${revenueChangeClass}">
                  ${revenueChangeSymbol}$${report.summary.revenueChange.toFixed(2)}
                </div>
                <div class="metric-label">Revenue Change</div>
              </div>
            </div>
          </div>

          <div class="section">
            <h2>💰 Key Metrics</h2>
            <div class="metrics">
              <div class="metric">
                <div class="metric-value">$${report.metrics.monthlyRecurringRevenue.toFixed(2)}</div>
                <div class="metric-label">Monthly Recurring Revenue</div>
              </div>
              <div class="metric">
                <div class="metric-value">${report.metrics.totalActiveSubscriptions}</div>
                <div class="metric-label">Active Subscriptions</div>
              </div>
              <div class="metric">
                <div class="metric-value">${report.summary.trialConversionRate.toFixed(1)}%</div>
                <div class="metric-label">Trial Conversion Rate</div>
              </div>
              <div class="metric">
                <div class="metric-value">${report.summary.churnRate.toFixed(1)}%</div>
                <div class="metric-label">Churn Rate</div>
              </div>
            </div>
          </div>

          <div class="section">
            <h2>📈 Trends</h2>
            <table>
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>Trend</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Revenue</td>
                  <td><span class="trend trend-${report.trends.revenue}">${report.trends.revenue}</span></td>
                </tr>
                <tr>
                  <td>Conversions</td>
                  <td><span class="trend trend-${report.trends.conversions}">${report.trends.conversions}</span></td>
                </tr>
                <tr>
                  <td>Churn</td>
                  <td><span class="trend trend-${report.trends.churn}">${report.trends.churn}</span></td>
                </tr>
              </tbody>
            </table>
          </div>

          ${
            report.alerts.length > 0
              ? `
          <div class="section">
            <h2>🚨 Alerts</h2>
            ${report.alerts
              .map(
                (alert) => `
              <div class="alert alert-${alert.severity}">
                <strong>${alert.type}:</strong> ${alert.message}
              </div>
            `,
              )
              .join('')}
          </div>
          `
              : ''
          }

          <div class="section">
            <h2>🏢 Tier Distribution</h2>
            <table>
              <thead>
                <tr>
                  <th>Tier</th>
                  <th>Count</th>
                </tr>
              </thead>
              <tbody>
                ${Object.entries(report.tierDistribution)
                  .map(
                    ([tier, count]) => `
                  <tr>
                    <td>${tier.charAt(0).toUpperCase() + tier.slice(1)}</td>
                    <td>${count}</td>
                  </tr>
                `,
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Determine trend based on current, previous, and historical values
   */
  private determineTrend(
    current: number,
    previous?: number,
    historical?: number,
  ): 'increasing' | 'decreasing' | 'stable' {
    if (!previous || !historical) return 'stable';

    const recentChange = (current - previous) / previous;
    const historicalChange = (previous - historical) / historical;

    // If change is less than 5%, consider it stable
    if (Math.abs(recentChange) < 0.05) return 'stable';

    // If recent change is significantly different from historical trend
    if (Math.abs(recentChange - historicalChange) > 0.1) {
      return recentChange > 0 ? 'increasing' : 'decreasing';
    }

    // Otherwise, follow the historical trend
    return historicalChange > 0 ? 'increasing' : historicalChange < 0 ? 'decreasing' : 'stable';
  }

  /**
   * Check for alerts based on metrics
   */
  private async checkAlerts(metrics: any): Promise<
    Array<{
      type: string;
      severity: 'low' | 'medium' | 'high' | 'critical';
      message: string;
    }>
  > {
    const alerts = [];

    if (metrics.trialConversionRate < ALERT_THRESHOLDS.trialConversionRateMin) {
      alerts.push({
        type: 'LOW_TRIAL_CONVERSION',
        severity: 'high' as const,
        message: `Trial conversion rate is ${metrics.trialConversionRate.toFixed(2)}% (below ${ALERT_THRESHOLDS.trialConversionRateMin}% threshold)`,
      });
    }

    if (metrics.webhookFailureRate > ALERT_THRESHOLDS.webhookFailureRateMax) {
      alerts.push({
        type: 'HIGH_WEBHOOK_FAILURE',
        severity: 'critical' as const,
        message: `Webhook failure rate is ${metrics.webhookFailureRate.toFixed(2)}% (above ${ALERT_THRESHOLDS.webhookFailureRateMax}% threshold)`,
      });
    }

    if (metrics.churnRate > ALERT_THRESHOLDS.churnRateMax) {
      alerts.push({
        type: 'HIGH_CHURN_RATE',
        severity: 'high' as const,
        message: `Churn rate is ${metrics.churnRate.toFixed(2)}% (above ${ALERT_THRESHOLDS.churnRateMax}% threshold)`,
      });
    }

    if (metrics.paymentFailureRate > ALERT_THRESHOLDS.paymentFailureRateMax) {
      alerts.push({
        type: 'HIGH_PAYMENT_FAILURE',
        severity: 'medium' as const,
        message: `Payment failure rate is ${metrics.paymentFailureRate.toFixed(2)}% (above ${ALERT_THRESHOLDS.paymentFailureRateMax}% threshold)`,
      });
    }

    return alerts;
  }
}
