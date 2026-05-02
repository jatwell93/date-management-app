import { PrismaClient } from '@prisma/client';
import { Logger } from '../utils/logger';
import { getDefaultDatabaseClient } from '../database/database-factory';
import { SubscriptionService } from './subscription.service';
import { AnalyticsRepository } from '../repositories/analytics.repository';
import * as Sentry from '@sentry/node';
import { ALERT_THRESHOLDS, TIER_PRICES, validateAlertThresholds } from '../types/subscription';
import { injectable, singleton, inject } from 'tsyringe';

export interface SaasMetrics {
  trialConversionRate: number;
  avgRevenuePerUser: number; // In cents
  churnRate: number;
  webhookFailureRate: number;
  paymentFailureRate: number | null;
  tierDistribution: Record<string, number>;
  totalActiveSubscriptions: number;
  monthlyRecurringRevenue: number; // In cents
  newTrialsThisMonth: number;
  conversionsThisMonth: number;
  churnsThisMonth: number;
}

export interface DailyMetricsSnapshot {
  date: Date;
  trialConversionRate: number;
  avgRevenuePerUser: number;
  churnRate: number;
  totalTrials: number;
  totalConversions: number;
  totalChurn: number;
  totalRevenueCents: number;
  tierDistribution: Record<string, number>;
}

export interface SaasAlertThresholds {
  trialConversionRateMin: number; // %
  webhookFailureRateMax: number; // %
  paymentFailureRateMax: number; // %
  churnRateMax: number; // %
}

/**
 * SaaS Metrics Service
 * Calculates and tracks business metrics for the SaaS monetization model
 */
@injectable()
@singleton()
export class SaasMetricsService {
  private prisma: PrismaClient;
  private subscriptionService: SubscriptionService;
  private analyticsRepo: AnalyticsRepository;
  private alertThresholds: SaasAlertThresholds;

  constructor(
    @inject(PrismaClient) prismaClient?: PrismaClient,
    subscriptionService?: SubscriptionService,
    @inject(AnalyticsRepository) analyticsRepo?: AnalyticsRepository,
    customThresholds?: Partial<typeof ALERT_THRESHOLDS>,
  ) {
    this.prisma = prismaClient ?? getDefaultDatabaseClient();
    this.subscriptionService = subscriptionService ?? new SubscriptionService(this.prisma);
    this.analyticsRepo = analyticsRepo ?? new AnalyticsRepository(this.prisma);

    // Validate and set alert thresholds
    this.alertThresholds = validateAlertThresholds(customThresholds || {});
  }

  /**
   * Calculate trial conversion rate for the last 30 days
   * Formula: (Conversions / Trials that ended) * 100
   */
  async calculateTrialConversionRate(): Promise<number> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Get trials that ended in the last 30 days
    const endedTrials = await this.prisma.subscriptionTier.findMany({
      where: {
        trialEndDate: {
          lte: new Date(),
          gte: thirtyDaysAgo,
        },
      },
      include: {
        organization: true,
      },
    });

    if (endedTrials.length === 0) return 0;

    // Count how many converted (have active Stripe subscription)
    const conversions = endedTrials.filter(
      (trial) => trial.stripeSubscriptionId && trial.status === 'active',
    ).length;

    const rate = (conversions / endedTrials.length) * 100;
    Logger.debug('Trial conversion rate calculated', {
      totalTrials: endedTrials.length,
      conversions,
      rate: rate.toFixed(2),
    });

    return rate;
  }

  /**
   * Calculate average revenue per user (ARPU)
   * Formula: Total MRR / Active Users
   */
  async calculateAvgRevenuePerUser(): Promise<number> {
    // Get total monthly recurring revenue
    const activeSubscriptions = await this.prisma.subscriptionTier.findMany({
      where: {
        status: 'active',
        stripeSubscriptionId: { not: null },
      },
    });

    const totalMRR = activeSubscriptions.reduce((sum, sub) => {
      // Use standardized tier pricing
      const tier = sub.tierLevel as keyof typeof TIER_PRICES;
      return sum + (TIER_PRICES[tier] || 0);
    }, 0);

    // Get active users count
    const activeUsers = await this.prisma.organizationUsage.aggregate({
      _sum: { activeUsers: true },
    });

    const totalActiveUsers = activeUsers._sum.activeUsers || 0;

    if (totalActiveUsers === 0) return 0;

    const arpu = totalMRR / totalActiveUsers / 100; // Convert from cents to dollars
    Logger.debug('ARPU calculated', {
      totalMRR: totalMRR / 100,
      totalActiveUsers,
      arpu: arpu.toFixed(2),
    });

    return arpu;
  }

  /**
   * Calculate churn rate for the last 30 days
   * Formula: (Churned customers / Total customers at start of period) * 100
   * Uses snapshots for more accurate calculation
   */
  async calculateChurnRate(): Promise<number> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    thirtyDaysAgo.setHours(0, 0, 0, 0);

    // Try to get snapshot from 30 days ago for accurate starting point
    const previousSnapshot = await this.prisma.metricsSnapshot.findUnique({
      where: { date: thirtyDaysAgo },
    });

    // Get current active subscriptions
    const currentActive = await this.prisma.subscriptionTier.count({
      where: { status: 'active' },
    });

    // Get new subscriptions (conversions) in the last 30 days
    const newSubscriptions = await this.prisma.subscriptionTier.count({
      where: {
        status: 'active',
        createdAt: { gte: thirtyDaysAgo },
      },
    });

    // Get churned customers in period
    const churnedCustomers = await this.prisma.subscriptionTier.count({
      where: {
        status: 'canceled',
        updatedAt: {
          gte: thirtyDaysAgo,
        },
      },
    });

    let customersAtStart: number;

    if (previousSnapshot) {
      // Use snapshot data for more accuracy
      customersAtStart = previousSnapshot.totalConversions + previousSnapshot.totalChurn;
    } else {
      // Fallback to calculation if no snapshot exists
      customersAtStart = currentActive - newSubscriptions + churnedCustomers;
    }

    // Guard against division by zero and negative values
    if (customersAtStart <= 0) {
      Logger.warn('Unable to calculate churn rate: no customers at start of period', {
        customersAtStart,
        currentActive,
        newSubscriptions,
        churnedCustomers,
      });
      return 0;
    }

    const rate = (churnedCustomers / customersAtStart) * 100;

    Logger.debug('Churn rate calculated', {
      customersAtStart,
      churnedCustomers,
      newSubscriptions,
      currentActive,
      rate: rate.toFixed(2),
      usedSnapshot: !!previousSnapshot,
    });

    return rate;
  }

  /**
   * Calculate webhook failure rate for today
   */
  async calculateWebhookFailureRate(): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const webhookMetrics = await this.prisma.webhookMetrics.findMany({
      where: {
        date: {
          gte: today,
        },
      },
    });

    if (webhookMetrics.length === 0) return 0;

    const totalCount = webhookMetrics.reduce((sum, m) => sum + m.totalCount, 0);
    const failureCount = webhookMetrics.reduce((sum, m) => sum + m.failureCount, 0);

    if (totalCount === 0) return 0;

    const rate = (failureCount / totalCount) * 100;
    Logger.debug('Webhook failure rate calculated', {
      totalCount,
      failureCount,
      rate: rate.toFixed(2),
    });

    return rate;
  }

  /**
   * Get total webhook handler error count for the current calendar day (UTC)
   * Used for the "webhook_handler_error > 1/day" Sentry alert (16A.B.7)
   */
  async getDailyWebhookErrorCount(): Promise<number> {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);

    const result = await this.prisma.webhookMetrics.findMany({
      where: {
        date: { gte: startOfDay },
      },
      select: { failureCount: true },
    });

    return result.reduce((total, row) => total + row.failureCount, 0);
  }

  /**
   * Get the growth rate of processed_webhook_events in the last hour vs. previous hour.
   * A rate > 10x the previous hour may indicate a replay attack (16A.B.7).
   * Returns ratio: currentHourCount / previousHourCount (returns 1.0 if previousHour is 0).
   */
  async getProcessedWebhookEventGrowthRate(): Promise<number> {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

    const [currentHourCount, previousHourCount] = await Promise.all([
      this.prisma.processedWebhookEvent.count({
        where: { processedAt: { gte: oneHourAgo } },
      }),
      this.prisma.processedWebhookEvent.count({
        where: { processedAt: { gte: twoHoursAgo, lt: oneHourAgo } },
      }),
    ]);

    if (previousHourCount === 0) {
      // No baseline — only alert if current hour is abnormally high (>100 events with no history)
      return currentHourCount > 100 ? 10.0 : 1.0;
    }

    return currentHourCount / previousHourCount;
  }

  /**
   * Calculate payment failure rate for the last 30 days
   * NOTE: Requires Stripe Invoice API integration for accurate calculation
   * Returns null if not implemented
   */
  async calculatePaymentFailureRate(): Promise<number | null> {
    // TODO: Implement payment failure rate calculation
    // This would require:
    // 1. Querying Stripe Invoice API for failed payments
    // 2. Storing payment attempt records locally
    // 3. Calculating (failed payments / total payment attempts) * 100

    Logger.warn(
      'Payment failure rate calculation not implemented - requires Stripe Invoice API integration',
      {
        suggestion:
          'Consider storing payment attempt records in local database for accurate tracking',
      },
    );

    // Return null to indicate metric is not available
    // This is better than returning 0 which could be misleading
    return null;
  }

  /**
   * Get tier distribution
   */
  async getTierDistribution(): Promise<Record<string, number>> {
    const distribution = await this.prisma.subscriptionTier.groupBy({
      by: ['tierLevel'],
      _count: true,
    });

    const result: Record<string, number> = {};
    distribution.forEach((d) => {
      result[d.tierLevel] = d._count;
    });

    Logger.debug('Tier distribution calculated', result);
    return result;
  }

  /**
   * Get comprehensive SaaS metrics
   */
  async getSaasMetrics(): Promise<SaasMetrics> {
    const [
      trialConversionRate,
      avgRevenuePerUser,
      churnRate,
      webhookFailureRate,
      paymentFailureRate,
      tierDistribution,
    ] = await Promise.all([
      this.calculateTrialConversionRate(),
      this.calculateAvgRevenuePerUser(),
      this.calculateChurnRate(),
      this.calculateWebhookFailureRate(),
      this.calculatePaymentFailureRate(),
      this.getTierDistribution(),
    ]);

    // Get additional metrics
    const totalActiveSubscriptions = await this.prisma.subscriptionTier.count({
      where: { status: 'active' },
    });

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [newTrials, conversions, churns] = await Promise.all([
      this.prisma.subscriptionTier.count({
        where: {
          trialEndDate: { gte: thirtyDaysAgo },
        },
      }),
      this.prisma.subscriptionTier.count({
        where: {
          stripeSubscriptionId: { not: null },
          createdAt: { gte: thirtyDaysAgo },
        },
      }),
      this.prisma.subscriptionTier.count({
        where: {
          status: 'canceled',
          updatedAt: { gte: thirtyDaysAgo },
        },
      }),
    ]);

    return {
      trialConversionRate,
      avgRevenuePerUser,
      churnRate,
      webhookFailureRate,
      paymentFailureRate,
      tierDistribution,
      totalActiveSubscriptions,
      monthlyRecurringRevenue: avgRevenuePerUser * totalActiveSubscriptions,
      newTrialsThisMonth: newTrials,
      conversionsThisMonth: conversions,
      churnsThisMonth: churns,
    };
  }

  /**
   * Store daily metrics snapshot
   */
  async storeDailyMetrics(date: Date): Promise<void> {
    const metrics = await this.getSaasMetrics();

    const snapshot: DailyMetricsSnapshot = {
      date,
      trialConversionRate: metrics.trialConversionRate,
      avgRevenuePerUser: metrics.avgRevenuePerUser,
      churnRate: metrics.churnRate,
      totalTrials: metrics.newTrialsThisMonth,
      totalConversions: metrics.conversionsThisMonth,
      totalChurn: metrics.churnsThisMonth,
      totalRevenueCents: Math.round(metrics.monthlyRecurringRevenue * 100),
      tierDistribution: metrics.tierDistribution,
    };

    await this.prisma.metricsSnapshot.upsert({
      where: { date },
      update: {
        ...snapshot,
        tierDistribution: JSON.stringify(metrics.tierDistribution),
      },
      create: {
        ...snapshot,
        tierDistribution: JSON.stringify(metrics.tierDistribution),
      },
    });

    Logger.info('Daily metrics snapshot stored', { date: date.toISOString() });
  }

  /**
   * Check for alerts based on metrics
   */
  async checkAlerts(): Promise<void> {
    const metrics = await this.getSaasMetrics();

    // Check trial conversion rate
    if (metrics.trialConversionRate < this.alertThresholds.trialConversionRateMin) {
      await this.sendAlert({
        type: 'LOW_TRIAL_CONVERSION',
        message: `Trial conversion rate is ${metrics.trialConversionRate.toFixed(2)}% (threshold: ${this.alertThresholds.trialConversionRateMin}%)`,
        severity: 'high',
        metrics: { trialConversionRate: metrics.trialConversionRate },
      });
    }

    // Check webhook failure rate
    if (metrics.webhookFailureRate > this.alertThresholds.webhookFailureRateMax) {
      await this.sendAlert({
        type: 'HIGH_WEBHOOK_FAILURE',
        message: `Webhook failure rate is ${metrics.webhookFailureRate.toFixed(2)}% (threshold: ${this.alertThresholds.webhookFailureRateMax}%)`,
        severity: 'critical',
        metrics: { webhookFailureRate: metrics.webhookFailureRate },
      });
    }

    // Check payment failure rate (only if available)
    if (
      metrics.paymentFailureRate !== null &&
      metrics.paymentFailureRate > this.alertThresholds.paymentFailureRateMax
    ) {
      await this.sendAlert({
        type: 'HIGH_PAYMENT_FAILURE',
        message: `Payment failure rate is ${metrics.paymentFailureRate.toFixed(2)}% (threshold: ${this.alertThresholds.paymentFailureRateMax}%)`,
        severity: 'critical',
        metrics: { paymentFailureRate: metrics.paymentFailureRate },
      });
    }

    // Check churn rate
    if (metrics.churnRate > this.alertThresholds.churnRateMax) {
      await this.sendAlert({
        type: 'HIGH_CHURN_RATE',
        message: `Churn rate is ${metrics.churnRate.toFixed(2)}% (threshold: ${this.alertThresholds.churnRateMax}%)`,
        severity: 'high',
        metrics: { churnRate: metrics.churnRate },
      });
    }
  }

  /**
   * Send alert (would integrate with EmailService)
   */
  private async sendAlert(alert: {
    type: string;
    message: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    metrics: Record<string, number>;
  }): Promise<void> {
    // Log the alert
    Logger.warn(`SaaS Alert: ${alert.type}`, {
      message: alert.message,
      severity: alert.severity,
      metrics: alert.metrics,
    });

    // Send to Sentry for critical alerts
    if (alert.severity === 'critical') {
      Sentry.captureMessage(alert.message, {
        level: 'error',
        tags: {
          alertType: alert.type,
          component: 'saas-metrics',
        },
        extra: alert.metrics,
      });
    }

    // TODO: Integrate with EmailService for email alerts
    // This would require injecting EmailService in the constructor
  }

  /**
   * Record webhook metrics
   */
  async recordWebhookMetrics(eventType: string, success: boolean): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    await this.prisma.webhookMetrics.upsert({
      where: {
        eventType_date: {
          eventType,
          date: today,
        },
      },
      update: {
        totalCount: { increment: 1 },
        failureCount: success ? undefined : { increment: 1 },
      },
      create: {
        eventType,
        date: today,
        totalCount: 1,
        failureCount: success ? 0 : 1,
      },
    });
  }
}
