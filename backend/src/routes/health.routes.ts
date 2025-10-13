import { Router } from 'express';
import { getDb, releaseDb } from '../database';
import { DatabaseMonitoringService, DatabaseAlertType } from '../services/database.monitoring.service';

const router = Router();

// Health check endpoint
router.get('/health', (req, res) => {
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
          api: 'healthy'
        }
      });
    } else {
      res.status(503).json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        services: {
          database: 'unhealthy',
          api: 'healthy'
        },
        error: 'Database connectivity test failed'
      });
    }
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      services: {
        database: 'unhealthy',
        api: 'healthy'
      },
      error: 'Database connectivity error: ' + (error as Error).message
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
    timestamp: new Date().toISOString()
  });
});

// Readiness probe (checks if the service is ready to accept traffic)
router.get('/ready', (req, res) => {
  let db;
  try {
    // Check if database is available
    db = getDb();
    const result: any = db.prepare('SELECT 1 as ready').get();
    
    if (result && result.ready === 1) {
      res.status(200).json({
        status: 'ready',
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(503).json({
        status: 'not ready',
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    res.status(503).json({
      status: 'not ready',
      timestamp: new Date().toISOString(),
      error: 'Database not available'
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
      external: memoryUsage.external
    },
    cpu: cpuUsage,
    timestamp: new Date().toISOString(),
    process: {
      pid: process.pid,
      version: process.version,
      platform: process.platform,
      arch: process.arch
    }
  });
});

// Database metrics endpoint
router.get('/database-metrics', (req, res) => {
  try {
    const dbMetrics = DatabaseMonitoringService.getInstance().getMetrics();
    
    res.status(200).json({
      status: 'success',
      timestamp: new Date().toISOString(),
      metrics: dbMetrics
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: 'Failed to retrieve database metrics: ' + (error as Error).message
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
          integrity_check: db.pragma ? db.pragma('integrity_check', { simple: true }) : 'N/A'
        }
      });
    } else {
      res.status(503).json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        database: {
          connected: false,
          error: 'Database connectivity test failed'
        }
      });
    }
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      database: {
        connected: false,
        error: 'Database connectivity error: ' + (error as Error).message
      }
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
    alerts: []  // This would come from a persisted alert store in a real implementation
  });
});

export default router;