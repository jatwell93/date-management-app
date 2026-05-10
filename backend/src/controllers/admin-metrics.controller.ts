import { Response, NextFunction } from 'express';
import { injectable } from 'tsyringe';
import { AuthRequest } from '../middleware/auth.middleware';
import { ApplicationMonitoringService } from '../services/application.monitoring.service';
import { SaasMetricsService } from '../services/saas-metrics.service';
import { Logger } from '../utils/logger';
import { TIER_PRICES, TierLevel, ALERT_THRESHOLDS } from '../types/subscription';
import { getDiContainer } from '../di/container';
import { SubscriptionRepository } from '../repositories/subscription.repository';
import { AnalyticsRepository } from '../repositories/analytics.repository';

interface TierMetricsSummary {
  tier: string;
  total: number;
  active: number;
  trial: number;
  canceled: number;
  monthlyRevenue: number;
}

@injectable()
export class AdminMetricsController {
  private monitoringService: ApplicationMonitoringService;
  private saasMetricsService: SaasMetricsService;

  constructor() {
    this.monitoringService = ApplicationMonitoringService.getInstance();
    this.saasMetricsService = new SaasMetricsService();
  }

  private getSubscriptionRepository(): SubscriptionRepository {
    return getDiContainer().resolve(SubscriptionRepository);
  }

  private getAnalyticsRepository(): AnalyticsRepository {
    return getDiContainer().resolve(AnalyticsRepository);
  }

  async getDashboard(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const [saasMetrics, applicationMetrics] = await Promise.all([
        this.saasMetricsService.getSaasMetrics(),
        this.monitoringService.getMetrics(),
      ]);

      const dashboard = {
        // SaaS Business Metrics
        business: {
          trialConversionRate: saasMetrics?.trialConversionRate || 0,
          avgRevenuePerUser: (saasMetrics?.avgRevenuePerUser || 0) / 100,
          churnRate: saasMetrics?.churnRate || 0,
          monthlyRecurringRevenue: (saasMetrics?.monthlyRecurringRevenue || 0) / 100,
          totalActiveSubscriptions: saasMetrics?.totalActiveSubscriptions || 0,
          newTrialsThisMonth: saasMetrics?.newTrialsThisMonth || 0,
          conversionsThisMonth: saasMetrics?.conversionsThisMonth || 0,
          churnsThisMonth: saasMetrics?.churnsThisMonth || 0,
        },

        // Tier Distribution
        tiers: saasMetrics?.tierDistribution || {},

        // System Performance Metrics
        performance: {
          totalRequests: applicationMetrics.performance.totalRequests,
          avgResponseTime: applicationMetrics.performance.avgResponseTime,
          errorRate: applicationMetrics.errors.errorRate,
          uptime: applicationMetrics.health.uptime,
        },

        // Webhook Metrics
        webhooks: {
          failureRate: saasMetrics?.webhookFailureRate || 0,
          totalProcessed: applicationMetrics.webhook.total,
          idempotencySkips: applicationMetrics.webhook.idempotencySkips,
        },

        // User Journey Metrics
        userJourneys: applicationMetrics.userJourneys,

        // Metadata
        metadata: {
          lastUpdated: applicationMetrics.timestamp,
          organizationId: req.organizationId,
          requestedBy: req.userId,
        },
      };

      Logger.info('Dashboard metrics retrieved', {
        organizationId: req.organizationId,
        userId: req.userId,
      });

      res.json(dashboard);
    } catch (error) {
      Logger.error('Failed to retrieve dashboard metrics', {
        error: error instanceof Error ? error.message : 'Unknown error',
        organizationId: req.organizationId,
        userId: req.userId,
      });

      res.status(500).json({
        message: 'Failed to retrieve dashboard metrics',
      });
    }
  }

  async getSubscriptionTiers(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const tierCounts =
        await this.getSubscriptionRepository().groupSubscriptionCountsByTierAndStatus();

      // Calculate revenue by tier
      const tierMetrics = tierCounts.reduce(
        (acc, tier) => {
          const key = tier.tierLevel.toLowerCase();
          // Map legacy tiers to standard pricing if needed
          let price = 0;
          if (key in TIER_PRICES) {
            price = TIER_PRICES[key as TierLevel];
          } else if (key === 'pro') {
            price = TIER_PRICES.professional;
          } else if (key === 'enterprise') {
            price = TIER_PRICES.concierge;
          }

          if (!acc[key]) {
            acc[key] = {
              tier: tier.tierLevel,
              total: 0,
              active: 0,
              trial: 0,
              canceled: 0,
              monthlyRevenue: 0,
            };
          }

          acc[key].total += tier._count;
          if (tier.status === 'active') {
            acc[key].active += tier._count;
            acc[key].monthlyRevenue += tier._count * price;
          } else if (tier.status === 'trial') {
            acc[key].trial += tier._count;
          } else if (tier.status === 'canceled') {
            acc[key].canceled += tier._count;
          }

          return acc;
        },
        {} as Record<string, TierMetricsSummary>,
      );

      // Convert revenue to dollars
      Object.values(tierMetrics).forEach((tier) => {
        tier.monthlyRevenue = tier.monthlyRevenue / 100;
      });

      res.json({
        tiers: tierMetrics,
        totalRevenue: Object.values(tierMetrics).reduce(
          (sum: number, tier) => sum + tier.monthlyRevenue,
          0,
        ),
        totalSubscriptions: Object.values(tierMetrics).reduce(
          (sum: number, tier) => sum + tier.total,
          0,
        ),
        lastUpdated: new Date(),
      });
    } catch (error) {
      Logger.error('Failed to retrieve subscription tier metrics', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      res.status(500).json({
        message: 'Failed to retrieve subscription tier metrics',
      });
    }
  }

  async getRevenueProjections(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      // Get last 90 days of metrics snapshots
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      const snapshots =
        await this.getAnalyticsRepository().findMetricsSnapshotsSince(ninetyDaysAgo);

      if (snapshots.length < 30) {
        res.json({
          projections: {
            next30Days: 0,
            next90Days: 0,
            next180Days: 0,
          },
          trend: 'insufficient_data',
          confidence: 'low',
          message: 'Need at least 30 days of data for projections',
        });
        return;
      }

      // Calculate growth rates
      const recentRevenue =
        snapshots.slice(-7).reduce((sum, s) => sum + s.totalRevenueCents, 0) / 7 / 100;
      const previousRevenue =
        snapshots.slice(-14, -7).reduce((sum, s) => sum + s.totalRevenueCents, 0) / 7 / 100;

      const weeklyGrowthRate =
        previousRevenue > 0 ? (recentRevenue - previousRevenue) / previousRevenue : 0;
      const monthlyGrowthRate = Math.pow(1 + weeklyGrowthRate, 4) - 1;

      const currentMonthlyRevenue = snapshots[snapshots.length - 1]?.totalRevenueCents / 100 || 0;

      // Calculate projections
      const projections = {
        next30Days: currentMonthlyRevenue * (1 + monthlyGrowthRate),
        next90Days: currentMonthlyRevenue * Math.pow(1 + monthlyGrowthRate, 3),
        next180Days: currentMonthlyRevenue * Math.pow(1 + monthlyGrowthRate, 6),
      };

      // Determine trend
      let trend = 'stable';
      if (monthlyGrowthRate > 0.05) trend = 'growing';
      else if (monthlyGrowthRate < -0.05) trend = 'declining';

      // Determine confidence based on data consistency
      const revenueVariance = this.calculateVariance(
        snapshots.map((s) => s.totalRevenueCents / 100),
      );
      const avgRevenue =
        snapshots.reduce((sum, s) => sum + s.totalRevenueCents / 100, 0) / snapshots.length;
      const coefficientOfVariation =
        avgRevenue > 0 ? revenueVariance / (avgRevenue * avgRevenue) : 0;

      let confidence = 'high';
      if (coefficientOfVariation > 0.3) confidence = 'low';
      else if (coefficientOfVariation > 0.15) confidence = 'medium';

      res.json({
        projections,
        trend,
        confidence,
        metrics: {
          currentMonthlyRevenue,
          monthlyGrowthRate: Math.round(monthlyGrowthRate * 10000) / 100,
          dataPoints: snapshots.length,
        },
        lastUpdated: new Date(),
      });
    } catch (error) {
      Logger.error('Failed to generate revenue projections', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      res.status(500).json({
        message: 'Failed to generate revenue projections',
      });
    }
  }

  async getHistorical(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const daysParam = parseInt(req.query.days as string) || 30;
      const days = Math.min(Math.max(daysParam, 7), 365);

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const snapshots = await this.getAnalyticsRepository().findMetricsSnapshotsSince(startDate);

      // Transform data for frontend consumption
      const historical = snapshots.map((snapshot) => {
        // Parse tier distribution safely (handle malformed JSON in DB)
        let tierDistributionData: Record<string, unknown>;
        try {
          tierDistributionData = JSON.parse(snapshot.tierDistribution || '{}');
        } catch (parseError) {
          Logger.warn('Failed to parse snapshot.tierDistribution', { parseError });
          tierDistributionData = {};
        }

        return {
          date: snapshot.date,
          trialConversionRate: snapshot.trialConversionRate,
          avgRevenuePerUser: snapshot.avgRevenuePerUser,
          churnRate: snapshot.churnRate,
          totalRevenue: snapshot.totalRevenueCents / 100,
          tierDistribution: tierDistributionData,
          totalTrials: snapshot.totalTrials,
          totalConversions: snapshot.totalConversions,
          totalChurn: snapshot.totalChurn,
        };
      });

      res.json({
        data: historical,
        period: {
          start: startDate,
          end: new Date(),
          days: days,
        },
        lastUpdated: new Date(),
      });
    } catch (error) {
      Logger.error('Failed to retrieve historical metrics', {
        error: error instanceof Error ? error.message : 'Unknown error',
        days: req.query.days,
      });

      res.status(500).json({
        message: 'Failed to retrieve historical metrics',
      });
    }
  }

  async getAlerts(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const metrics = await this.saasMetricsService.getSaasMetrics();

      if (!metrics) {
        res.json({
          alerts: [],
          status: 'no_data',
          lastChecked: new Date(),
        });
        return;
      }

      const alerts = [];

      // Check trial conversion rate
      if (metrics.trialConversionRate < ALERT_THRESHOLDS.trialConversionRateMin) {
        alerts.push({
          type: 'LOW_TRIAL_CONVERSION',
          severity: 'high',
          message: `Trial conversion rate is ${metrics.trialConversionRate.toFixed(2)}% (threshold: ${ALERT_THRESHOLDS.trialConversionRateMin}%)`,
          value: metrics.trialConversionRate,
          threshold: ALERT_THRESHOLDS.trialConversionRateMin,
          trend: 'declining',
        });
      }

      // Check webhook failure rate
      if (metrics.webhookFailureRate > ALERT_THRESHOLDS.webhookFailureRateMax) {
        alerts.push({
          type: 'HIGH_WEBHOOK_FAILURE',
          severity: 'critical',
          message: `Webhook failure rate is ${metrics.webhookFailureRate.toFixed(2)}% (threshold: ${ALERT_THRESHOLDS.webhookFailureRateMax}%)`,
          value: metrics.webhookFailureRate,
          threshold: ALERT_THRESHOLDS.webhookFailureRateMax,
          trend: 'increasing',
        });
      }

      // Check churn rate
      if (metrics.churnRate > ALERT_THRESHOLDS.churnRateMax) {
        alerts.push({
          type: 'HIGH_CHURN_RATE',
          severity: 'high',
          message: `Churn rate is ${metrics.churnRate.toFixed(2)}% (threshold: ${ALERT_THRESHOLDS.churnRateMax}%)`,
          value: metrics.churnRate,
          threshold: ALERT_THRESHOLDS.churnRateMax,
          trend: 'increasing',
        });
      }

      // Check payment failure rate
      const paymentFailureRate = metrics.paymentFailureRate ?? 0;
      if (paymentFailureRate > ALERT_THRESHOLDS.paymentFailureRateMax) {
        alerts.push({
          type: 'HIGH_PAYMENT_FAILURE',
          severity: 'medium',
          message: `Payment failure rate is ${paymentFailureRate.toFixed(2)}% (threshold: ${ALERT_THRESHOLDS.paymentFailureRateMax}%)`,
          value: paymentFailureRate,
          threshold: ALERT_THRESHOLDS.paymentFailureRateMax,
          trend: 'stable',
        });
      }

      res.json({
        alerts,
        status:
          alerts.length === 0
            ? 'healthy'
            : alerts.some((a) => a.severity === 'critical')
              ? 'critical'
              : 'warning',
        lastChecked: new Date(),
        metrics: {
          trialConversionRate: metrics.trialConversionRate,
          webhookFailureRate: metrics.webhookFailureRate,
          churnRate: metrics.churnRate,
          paymentFailureRate: metrics.paymentFailureRate,
        },
      });
    } catch (error) {
      Logger.error('Failed to retrieve alert status', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      res.status(500).json({
        message: 'Failed to retrieve alert status',
      });
    }
  }

  private calculateVariance(values: number[]): number {
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const squaredDiffs = values.map((val) => Math.pow(val - mean, 2));
    return squaredDiffs.reduce((sum, val) => sum + val, 0) / values.length;
  }
}

export function createAdminMetricsController(): AdminMetricsController {
  return new AdminMetricsController();
}
