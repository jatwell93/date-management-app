import { DailyReportService } from '../services/daily-report.service';
import { Logger } from '../utils/logger';
import * as Sentry from '@sentry/node';

/**
 * Daily Report Email Job
 * Runs at 00:01 UTC to send the previous day's business report
 */
export class DailyReportEmailJob {
  private dailyReportService: DailyReportService;

  constructor() {
    this.dailyReportService = new DailyReportService();
  }

  /**
   * Execute the daily report email job
   */
  async execute(date?: Date): Promise<void> {
    // Default to yesterday's report
    const reportDate = date || new Date();
    reportDate.setDate(reportDate.getDate() - 1);

    Logger.info('Starting daily report email job', { date: reportDate.toISOString() });

    try {
      // Generate the report
      const report = await this.dailyReportService.generateDailyReport(reportDate);

      // Get recipients from environment or config
      const recipients = this.getReportRecipients();

      if (recipients.length === 0) {
        Logger.warn('No recipients configured for daily report', {
          date: reportDate.toISOString(),
        });
        return;
      }

      // Send the report
      await this.dailyReportService.sendDailyReport(report, recipients);

      Logger.info('Daily report email sent successfully', {
        date: reportDate.toISOString(),
        recipients: recipients.length,
        revenue: report.metrics.monthlyRecurringRevenue,
        conversions: report.summary.conversions,
        churns: report.summary.churns,
      });
    } catch (error) {
      Logger.error('Daily report email job failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        date: reportDate.toISOString(),
      });

      // Send error to Sentry
      Sentry.captureException(error, {
        tags: {
          job: 'daily_report_email',
          component: 'scheduler',
        },
        extra: {
          date: reportDate.toISOString(),
        },
      });

      throw error;
    }
  }

  /**
   * Get report recipients from environment variables
   */
  private getReportRecipients(): string[] {
    const recipientsEnv = process.env.DAILY_REPORT_RECIPIENTS;
    if (!recipientsEnv) {
      Logger.warn('DAILY_REPORT_RECIPIENTS environment variable not set');
      return [];
    }

    // Split by comma and trim whitespace
    return recipientsEnv
      .split(',')
      .map((email) => email.trim())
      .filter((email) => email && email.includes('@'));
  }

  /**
   * Get the cron expression for this job
   * Runs every day at 00:01 UTC (1 minute after midnight)
   */
  static get cronExpression(): string {
    return '1 0 * * *';
  }

  /**
   * Get job configuration
   */
  static getJobConfig() {
    return {
      name: 'daily-report-email',
      schedule: '1 0 * * *', // Direct cron expression
      timezone: 'UTC',
      enabled: true,
      description: 'Send daily business report via email',
    };
  }
}
