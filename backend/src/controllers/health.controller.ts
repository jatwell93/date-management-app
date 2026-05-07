import { Response } from 'express';
import { getDb, releaseDb } from '../database';
import { getDiContainer } from '../di/container';
import { AuthRequest } from '../middleware/auth.middleware';
import { SubscriptionRepository } from '../repositories/subscription.repository';
import { DatabaseMonitoringService } from '../services/database.monitoring.service';
import { validateTierFeatureFlags, ValidationResult } from '../utils/validate-tier-flags';

type HealthDatabase = ReturnType<typeof getDb>;

interface ProcessMetrics {
  uptime: number;
  memory: NodeJS.MemoryUsage;
  cpu: NodeJS.CpuUsage | null;
  process: {
    pid: number;
    version: string;
    platform: NodeJS.Platform;
    arch: string;
  };
}

interface HealthControllerDependencies {
  getDb: () => HealthDatabase;
  releaseDb: (db: HealthDatabase) => void;
  getDatabaseMetrics: () => unknown;
  validateTierFeatureFlags: (
    subscriptionRepository: SubscriptionRepository,
  ) => Promise<ValidationResult>;
  getSubscriptionRepository: () => SubscriptionRepository;
  now: () => Date;
  getProcessMetrics: () => ProcessMetrics;
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function defaultProcessMetrics(): ProcessMetrics {
  return {
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    cpu: process.cpuUsage ? process.cpuUsage() : null,
    process: {
      pid: process.pid,
      version: process.version,
      platform: process.platform,
      arch: process.arch,
    },
  };
}

export class HealthController {
  private tierFlagsValidationResult: ValidationResult | null = null;
  private tierFlagsValidationTime: Date | null = null;

  constructor(private readonly dependencies: HealthControllerDependencies) {}

  async initializeTierFlagValidation(): Promise<void> {
    const subscriptionRepository = this.dependencies.getSubscriptionRepository();
    this.tierFlagsValidationResult =
      await this.dependencies.validateTierFeatureFlags(subscriptionRepository);
    this.tierFlagsValidationTime = this.dependencies.now();
  }

  async revalidateTierFlags(): Promise<boolean> {
    const subscriptionRepository = this.dependencies.getSubscriptionRepository();
    const result = await this.dependencies.validateTierFeatureFlags(subscriptionRepository);
    this.tierFlagsValidationResult = result;
    this.tierFlagsValidationTime = this.dependencies.now();
    return result.valid;
  }

  async getHealth(_req: AuthRequest, res: Response): Promise<void> {
    if (!this.tierFlagsValidationResult || !this.tierFlagsValidationResult.valid) {
      res.status(503).json({
        status: 'unhealthy',
        timestamp: this.dependencies.now().toISOString(),
        services: {
          database: 'unknown',
          api: 'healthy',
          tierFeatureFlags: 'unconfigured',
        },
        error: 'Tier feature flags not properly configured',
      });
      return;
    }

    let db: HealthDatabase | undefined;
    try {
      db = this.dependencies.getDb();
      const result = db.prepare('SELECT 1 as alive').get() as { alive?: number } | undefined;

      if (result && result.alive === 1) {
        res.status(200).json({
          status: 'healthy',
          timestamp: this.dependencies.now().toISOString(),
          services: {
            database: 'healthy',
            api: 'healthy',
            tierFeatureFlags: 'configured',
          },
          tierFlags: {
            validatedAt: this.tierFlagsValidationTime?.toISOString(),
            flagCounts: this.tierFlagsValidationResult.flagCounts,
            warnings: this.tierFlagsValidationResult.warnings,
          },
        });
      } else {
        res.status(503).json({
          status: 'unhealthy',
          timestamp: this.dependencies.now().toISOString(),
          services: {
            database: 'unhealthy',
            api: 'healthy',
            tierFeatureFlags: 'configured',
          },
          error: 'Database connectivity test failed',
        });
      }
    } catch (_error) {
      res.status(503).json({
        status: 'unhealthy',
        timestamp: this.dependencies.now().toISOString(),
        services: {
          database: 'unhealthy',
          api: 'healthy',
          tierFeatureFlags: 'configured',
        },
        error: 'Database connectivity error',
      });
    } finally {
      if (db) {
        this.dependencies.releaseDb(db);
      }
    }
  }

  getLive(_req: AuthRequest, res: Response): void {
    res.status(200).json({
      status: 'alive',
      timestamp: this.dependencies.now().toISOString(),
    });
  }

  async getReady(_req: AuthRequest, res: Response): Promise<void> {
    if (!this.tierFlagsValidationResult || !this.tierFlagsValidationResult.valid) {
      res.status(503).json({
        status: 'not ready',
        timestamp: this.dependencies.now().toISOString(),
        error: 'Tier feature flags not properly configured',
      });
      return;
    }

    let db: HealthDatabase | undefined;
    try {
      db = this.dependencies.getDb();
      const result = db.prepare('SELECT 1 as ready').get() as { ready?: number } | undefined;

      if (result && result.ready === 1) {
        res.status(200).json({
          status: 'ready',
          timestamp: this.dependencies.now().toISOString(),
        });
      } else {
        res.status(503).json({
          status: 'not ready',
          timestamp: this.dependencies.now().toISOString(),
        });
      }
    } catch (_error) {
      res.status(503).json({
        status: 'not ready',
        timestamp: this.dependencies.now().toISOString(),
        error: 'Database not available',
      });
    } finally {
      if (db) {
        this.dependencies.releaseDb(db);
      }
    }
  }

  getMetrics(_req: AuthRequest, res: Response): void {
    const metrics = this.dependencies.getProcessMetrics();

    res.status(200).json({
      uptime: metrics.uptime,
      memory: {
        rss: metrics.memory.rss,
        heapTotal: metrics.memory.heapTotal,
        heapUsed: metrics.memory.heapUsed,
        external: metrics.memory.external,
      },
      cpu: metrics.cpu,
      timestamp: this.dependencies.now().toISOString(),
      process: metrics.process,
    });
  }

  getDatabaseMetrics(_req: AuthRequest, res: Response): void {
    try {
      const dbMetrics = this.dependencies.getDatabaseMetrics();

      res.status(200).json({
        status: 'success',
        timestamp: this.dependencies.now().toISOString(),
        metrics: dbMetrics,
      });
    } catch (error: unknown) {
      res.status(500).json({
        status: 'error',
        timestamp: this.dependencies.now().toISOString(),
        error: `Failed to retrieve database metrics: ${getErrorMessage(error, 'Unknown error')}`,
      });
    }
  }

  getDatabaseHealth(_req: AuthRequest, res: Response): void {
    let db: HealthDatabase | undefined;
    try {
      db = this.dependencies.getDb();
      const result = db.prepare('SELECT 1 as alive').get() as { alive?: number } | undefined;

      if (result && result.alive === 1) {
        res.status(200).json({
          status: 'healthy',
          timestamp: this.dependencies.now().toISOString(),
          database: {
            connected: true,
            version: db.pragma ? db.pragma('user_version', { simple: true }) : 'N/A',
            integrity_check: db.pragma ? db.pragma('integrity_check', { simple: true }) : 'N/A',
          },
        });
      } else {
        res.status(503).json({
          status: 'unhealthy',
          timestamp: this.dependencies.now().toISOString(),
          database: {
            connected: false,
            error: 'Database connectivity test failed',
          },
        });
      }
    } catch (error: unknown) {
      res.status(503).json({
        status: 'unhealthy',
        timestamp: this.dependencies.now().toISOString(),
        database: {
          connected: false,
          error: `Database connectivity error: ${getErrorMessage(error, 'Unknown error')}`,
        },
      });
    } finally {
      if (db) {
        this.dependencies.releaseDb(db);
      }
    }
  }

  getRecentAlerts(_req: AuthRequest, res: Response): void {
    res.status(200).json({
      status: 'success',
      timestamp: this.dependencies.now().toISOString(),
      alerts: [],
    });
  }
}

export function createHealthController(): HealthController {
  return new HealthController({
    getDb,
    releaseDb,
    getDatabaseMetrics: () => DatabaseMonitoringService.getInstance().getMetrics(),
    validateTierFeatureFlags,
    getSubscriptionRepository: () => getDiContainer().resolve(SubscriptionRepository),
    now: () => new Date(),
    getProcessMetrics: defaultProcessMetrics,
  });
}
