import { Router } from 'express';
import { getDb, releaseDb } from '../database';
import { DatabaseMonitoringService } from '../services/database.monitoring.service';
import {
  validateTierFeatureFlags,
  quickValidateTierFeatureFlags,
  ValidationResult,
} from '../utils/validate-tier-flags';
import { getDefaultDatabaseClient } from '../database/database-factory';

const router = Router();

// Tier feature flags validation state (16A.F.2)
let tierFlagsValidationResult: ValidationResult | null = null;
let tierFlagsValidationTime: Date | null = null;

/**
 * Initialize tier feature flags validation at boot time
 * Call this during application startup
 */
export async function initializeTierFlagValidation(): Promise<void> {
  const prisma = getDefaultDatabaseClient();
  tierFlagsValidationResult = await validateTierFeatureFlags(prisma);
  tierFlagsValidationTime = new Date();
}

/**
 * Re-validate tier feature flags (for health check refreshes)
 */
export async function revalidateTierFlags(): Promise<boolean> {
  const prisma = getDefaultDatabaseClient();
  const result = await validateTierFeatureFlags(prisma);
  tierFlagsValidationResult = result;
  tierFlagsValidationTime = new Date();
  return result.valid;
}

// Health check endpoint
router.get('/health', async (req, res) => {
  // Check tier feature flags first (16A.F.2 - fail fast if invalid)
  if (!tierFlagsValidationResult || !tierFlagsValidationResult.valid) {
    return res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      services: {
        database: 'unknown',
        api: 'healthy',
        tierFeatureFlags: 'unconfigured',
      },
      error: 'Tier feature flags not properly configured',
      details: tierFlagsValidationResult?.errors || ['Validation not performed'],
      missingFeatures: tierFlagsValidationResult?.missingFeatures || [],
      warnings: tierFlagsValidationResult?.warnings || [],
    });
  }

  let db;
  try {
    // Check database connectivity
    db = getDb();
    const result: any = db.prepare('SELECT 1 as alive').get();

    if (result && result.alive === 1) {
      res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: {
          database: 'healthy',
          api: 'healthy',
          tierFeatureFlags: 'configured',
        },
        tierFlags: {
          validatedAt: tierFlagsValidationTime?.toISOString(),
          flagCounts: tierFlagsValidationResult.flagCounts,
          warnings: tierFlagsValidationResult.warnings,
        },
      });
    } else {
      res.status(503).json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        services: {
          database: 'unhealthy',
          api: 'healthy',
          tierFeatureFlags: 'configured',
        },
        error: 'Database connectivity test failed',
      });
    }
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      services: {
        database: 'unhealthy',
        api: 'healthy',
        tierFeatureFlags: 'configured',
      },
      error: 'Database connectivity error: ' + (error as Error).message,
    });
  } finally {
    if (db) {
      releaseDb(db);
    }
  }
});

// Liveness probe (same as health for now, but can be extended)
router.get('/live', (req, res) => {
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString(),
  });
});

// Readiness probe (checks if the service is ready to accept traffic)
router.get('/ready', async (req, res) => {
  // Check tier feature flags first (fail fast if misconfigured)
  if (!tierFlagsValidationResult || !tierFlagsValidationResult.valid) {
    return res.status(503).json({
      status: 'not ready',
      timestamp: new Date().toISOString(),
      error: 'Tier feature flags not properly configured',
    });
  }

  let db;
  try {
    // Check if database is available
    db = getDb();
    const result: any = db.prepare('SELECT 1 as ready').get();

    if (result && result.ready === 1) {
      res.status(200).json({
        status: 'ready',
        timestamp: new Date().toISOString(),
      });
    } else {
      res.status(503).json({
        status: 'not ready',
        timestamp: new Date().toISOString(),
      });
    }
  } catch (_error) {
    res.status(503).json({
      status: 'not ready',
      timestamp: new Date().toISOString(),
      error: 'Database not available',
    });
  } finally {
    if (db) {
      releaseDb(db);
    }
  }
});

// Metrics endpoint for basic server info
router.get('/metrics', (req, res) => {
  const uptime = process.uptime();
  const memoryUsage = process.memoryUsage();
  const cpuUsage = process.cpuUsage ? process.cpuUsage() : null;

  res.status(200).json({
    uptime: uptime,
    memory: {
      rss: memoryUsage.rss,
      heapTotal: memoryUsage.heapTotal,
      heapUsed: memoryUsage.heapUsed,
      external: memoryUsage.external,
    },
    cpu: cpuUsage,
    timestamp: new Date().toISOString(),
    process: {
      pid: process.pid,
      version: process.version,
      platform: process.platform,
      arch: process.arch,
    },
  });
});

// Database metrics endpoint
router.get('/database-metrics', (req, res) => {
  try {
    const dbMetrics = DatabaseMonitoringService.getInstance().getMetrics();

    res.status(200).json({
      status: 'success',
      timestamp: new Date().toISOString(),
      metrics: dbMetrics,
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: 'Failed to retrieve database metrics: ' + (error as Error).message,
    });
  }
});

// Database health check endpoint
router.get('/database-health', (req, res) => {
  let db;
  try {
    // Check database connectivity
    db = getDb();
    const result: any = db.prepare('SELECT 1 as alive').get();

    if (result && result.alive === 1) {
      res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        database: {
          connected: true,
          version: db.pragma ? db.pragma('user_version', { simple: true }) : 'N/A',
          integrity_check: db.pragma ? db.pragma('integrity_check', { simple: true }) : 'N/A',
        },
      });
    } else {
      res.status(503).json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        database: {
          connected: false,
          error: 'Database connectivity test failed',
        },
      });
    }
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      database: {
        connected: false,
        error: 'Database connectivity error: ' + (error as Error).message,
      },
    });
  } finally {
    if (db) {
      releaseDb(db);
    }
  }
});

// Recent alerts endpoint
router.get('/recent-alerts', (req, res) => {
  // In a real implementation, this would return alerts from the last N minutes
  // For now, we'll return an empty list
  res.status(200).json({
    status: 'success',
    timestamp: new Date().toISOString(),
    alerts: [], // This would come from a persisted alert store in a real implementation
  });
});

export default router;
