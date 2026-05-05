import { ApplicationMonitoringService } from '../services/application.monitoring.service';
import { SaasMetricsService } from '../services/saas-metrics.service';
import { Logger } from '../utils/logger';
import * as Sentry from '@sentry/node';
import { ALERT_THRESHOLDS } from '../types/subscription';
import { getDiContainer } from '../di/container';
import { JobLockRepository } from '../repositories/job-lock.repository';

interface DailyMetricsJobDependencies {
  monitoringService?: ApplicationMonitoringService;
  saasMetricsService?: SaasMetricsService;
  jobLockRepository?: JobLockRepository;
}

/**
 * Daily Metrics Job
 * Runs at 23:59 UTC to store daily SaaS metrics snapshots
 * and check for alert conditions
 */
export class DailyMetricsJob {
  private monitoringService: ApplicationMonitoringService;
  private saasMetricsService: SaasMetricsService;
  private jobLockRepository: JobLockRepository;

  constructor(dependencies: DailyMetricsJobDependencies = {}) {
    this.monitoringService =
      dependencies.monitoringService ?? ApplicationMonitoringService.getInstance();
    this.saasMetricsService = dependencies.saasMetricsService ?? new SaasMetricsService();
    this.jobLockRepository =
      dependencies.jobLockRepository ?? getDiContainer().resolve(JobLockRepository);
  }

  /**
   * Execute the daily metrics job with distributed locking
   */
  async execute(date?: Date): Promise<void> {
    const jobDate = date || new Date();
    const lockKey = `daily-metrics-${jobDate.toISOString().split('T')[0]}`;

    Logger.info('Starting daily metrics job', { date: jobDate.toISOString(), lockKey });

    try {
      // Acquire lock
      const lockAcquired = await this.acquireLock(lockKey);

      if (!lockAcquired) {
        Logger.warn('Daily metrics job is already running, skipping', { lockKey });
        return;
      }

      try {
        // Store daily metrics snapshot
        await this.monitoringService.storeDailyMetrics(jobDate);
        Logger.info('Daily metrics snapshot stored', { date: jobDate.toISOString() });

        // Check for alerts
        await this.saasMetricsService.checkAlerts();
        Logger.info('Alert checks completed');

        // Log summary of metrics
        const metrics = await this.saasMetricsService.getSaasMetrics();
        if (metrics) {
          Logger.info('Daily SaaS metrics summary', {
            trialConversionRate: metrics.trialConversionRate.toFixed(2) + '%',
            avgRevenuePerUser: '$' + metrics.avgRevenuePerUser.toFixed(2),
            churnRate: metrics.churnRate.toFixed(2) + '%',
            webhookFailureRate: metrics.webhookFailureRate.toFixed(2) + '%',
            totalActiveSubscriptions: metrics.totalActiveSubscriptions,
            monthlyRecurringRevenue: '$' + metrics.monthlyRecurringRevenue.toFixed(2),
          });
        }

        Logger.info('Daily metrics job completed successfully');
      } finally {
        // Release lock
        await this.releaseLock(lockKey);
      }
    } catch (error) {
      Logger.error('Daily metrics job failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        date: jobDate.toISOString(),
      });

      // Send error to Sentry
      Sentry.captureException(error, {
        tags: {
          job: 'daily_metrics',
          component: 'scheduler',
        },
        extra: {
          date: jobDate.toISOString(),
        },
      });

      throw error;
    }
  }

  /**
   * Acquire a distributed lock using the database
   */
  private async acquireLock(lockKey: string, timeoutMinutes: number = 10): Promise<boolean> {
    const acquired = await this.jobLockRepository.acquire(lockKey, timeoutMinutes);

    if (acquired) {
      Logger.debug('Lock acquired', { lockKey });
    } else {
      Logger.debug('Failed to acquire lock', { lockKey });
    }

    return acquired;
  }

  /**
   * Release a distributed lock
   */
  private async releaseLock(lockKey: string): Promise<void> {
    try {
      await this.jobLockRepository.release(lockKey);

      Logger.debug('Lock released', { lockKey });
    } catch (error) {
      Logger.error('Failed to release lock', {
        lockKey,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Get the cron expression for this job
   * Runs every day at 23:59 UTC
   */
  static get cronExpression(): string {
    return '59 23 * * *';
  }

  /**
   * Get job configuration
   */
  static getJobConfig() {
    return {
      name: 'daily-metrics',
      schedule: this.cronExpression,
      timezone: 'UTC',
      enabled: true,
      description: 'Store daily SaaS metrics and check alerts',
    };
  }
}

/**
 * Hourly Webhook Metrics Check
 * Runs every hour to check webhook failure rates
 */
export class HourlyWebhookCheckJob {
  private saasMetricsService: SaasMetricsService;

  constructor() {
    this.saasMetricsService = new SaasMetricsService();
  }

  /**
   * Execute the hourly webhook check
   */
  async execute(): Promise<void> {
    Logger.info('Starting hourly webhook metrics check');

    try {
      // Check 1: Webhook failure rate (existing)
      const webhookFailureRate = await this.saasMetricsService.calculateWebhookFailureRate();

      Logger.info('Webhook metrics check completed', {
        failureRate: webhookFailureRate.toFixed(2) + '%',
        timestamp: new Date().toISOString(),
      });

      if (webhookFailureRate > ALERT_THRESHOLDS.webhookFailureRateMax) {
        Logger.error('High webhook failure rate detected', {
          failureRate: webhookFailureRate.toFixed(2) + '%',
          threshold: `${ALERT_THRESHOLDS.webhookFailureRateMax}%`,
        });

        Sentry.captureMessage(`High webhook failure rate: ${webhookFailureRate.toFixed(2)}%`, {
          level: 'error',
          tags: {
            component: 'webhook_monitoring',
            severity: 'critical',
          },
        });
      }

      // Check 2: Raw error count for the day (NEW — 16A.B.7)
      const dailyErrorCount = await this.saasMetricsService.getDailyWebhookErrorCount();

      if (dailyErrorCount > 1) {
        Logger.error('Webhook handler errors today exceeded threshold', {
          dailyErrorCount,
          threshold: 1,
        });

        Sentry.captureMessage(
          `${dailyErrorCount} webhook handler errors today (threshold: >1/day)`,
          {
            level: 'error',
            tags: {
              component: 'webhook_monitoring',
              alert_type: 'daily_error_count',
            },
            extra: { dailyErrorCount },
          },
        );
      }

      // Check 3: Replay attack detection via processed_webhook_events growth rate (NEW — 16A.B.7)
      const growthRate = await this.saasMetricsService.getProcessedWebhookEventGrowthRate();
      const REPLAY_ATTACK_GROWTH_THRESHOLD = 5.0; // >5x previous hour volume

      if (growthRate > REPLAY_ATTACK_GROWTH_THRESHOLD) {
        Logger.error('Potential replay attack detected: webhook event volume spike', {
          growthRate: `${growthRate.toFixed(2)}x`,
          threshold: `${REPLAY_ATTACK_GROWTH_THRESHOLD}x`,
        });

        Sentry.captureMessage(
          `Potential replay attack: processed_webhook_events grew ${growthRate.toFixed(1)}x in the last hour`,
          {
            level: 'error',
            tags: {
              component: 'webhook_monitoring',
              alert_type: 'replay_attack_suspected',
              severity: 'critical',
            },
            extra: { growthRate },
          },
        );
      }
    } catch (error) {
      Logger.error('Hourly webhook check failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      Sentry.captureException(error, {
        tags: {
          job: 'hourly_webhook_check',
          component: 'scheduler',
        },
      });
    }
  }

  /**
   * Get the cron expression for this job
   * Runs every hour at minute 0
   */
  static get cronExpression(): string {
    return '0 * * * *';
  }

  /**
   * Get job configuration
   */
  static getJobConfig() {
    return {
      name: 'hourly-webhook-check',
      schedule: this.cronExpression,
      timezone: 'UTC',
      enabled: true,
      description: 'Check webhook failure rates hourly',
    };
  }
}
