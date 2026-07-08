// Enable decorators for dependency injection
import 'reflect-metadata';

try {
  // Optional instrumentation (Sentry/analytics). Safe to skip if missing.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('../instrument');
} catch {
  // Instrumentation not present in this environment; continue without it.
}

import express from 'express';
import type { Router as ExpressRouter } from 'express';
import helmet from 'helmet';
import * as Sentry from '@sentry/node';
import { createServer, Server as HttpsServer } from 'https';
import { Server as HttpServer } from 'http'; // Import http server type
import { promises as fs } from 'fs';
import { join } from 'path';
// import { initDatabase } from './database';
import authRoutes from './routes/auth.routes';
import productRoutes from './routes/product.routes';
import inventoryRoutes from './routes/inventory.routes';
import reportRoutes from './routes/report.routes';
import dashboardRoutes from './routes/dashboard.routes';
import userRoutes from './routes/user.routes';
import storeAreaRoutes from './routes/store-area.routes';
import healthRoutes from './routes/health.routes';
import databaseBackupRoutes from './routes/database.backup.routes';
import expiredItemRoutes from './routes/expired-item.routes';
import uploadRoutes from './routes/upload.routes';
import storageQuotaRoutes from './routes/storage-quota.routes';
import webhookRoutes from './routes/webhook.routes';
import orgBootstrapRoutes from './routes/org-bootstrap.routes';
import subscriptionRoutes from './routes/subscription.routes';
import markdownConfigRoutes from './routes/markdown-config.routes';
import { authenticateToken } from './middleware/auth.middleware';
import { errorHandler } from './middleware/error.middleware';
import { corsMiddleware } from './middleware/cors';
import { globalLimiter } from './middleware/rateLimiter';
import { initializeDiContainer } from './di/container';
import { registerApplicationServices } from './di/services';
import { SchedulerService } from './services/scheduler.service';
import { DatabaseMonitoringService } from './services/database.monitoring.service';
import { ApplicationMonitoringService } from './services/application.monitoring.service';
import { AnalyticsService } from './services/analytics.service';
import { SQLiteAnalyticsAdapter } from './adapters/analytics/SQLiteAnalyticsAdapter';
import { getDb } from './database';
import { envConfig } from './config/environment';
import { Logger } from './utils/logger';

let organizationInviteRoutes: ExpressRouter | null = null;

if (envConfig.ENABLE_CUSTOM_ORG_INVITES) {
  // Keep legacy invite endpoints behind an explicit feature flag.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  organizationInviteRoutes = require('./routes/organization-invite.routes').default;
}

const app = express();
const port = envConfig.PORT;

// Initialize Dependency Injection container and register all services
initializeDiContainer();
registerApplicationServices();

// Required when running behind reverse proxies/tunnels (ngrok, nginx, cloud load balancers)
// so middleware like express-rate-limit can safely use X-Forwarded-For.
app.set('trust proxy', 1);

// Security headers using Helmet
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'https:'],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
      },
    },
    hsts: {
      maxAge: 31536000, // 1 year in seconds
      includeSubDomains: true,
      preload: true,
    },
  }),
);

// Apply global rate limiter (DDoS protection - 1000 requests per minute per IP)
// BUT: Skip webhooks since they're from trusted external services
app.use((req, res, next) => {
  if (req.path.startsWith('/api/webhooks')) {
    return next(); // Skip rate limiter for webhooks
  }
  globalLimiter(req, res, next);
});

// IMPORTANT: Webhook route with raw body parser must come BEFORE express.json()
// Stripe signature verification requires the raw body
app.use('/api/webhooks', express.raw({ type: 'application/json' }), webhookRoutes);

// Middleware
// Task 5.3: Configure request payload size limit (10MB)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Apply CORS middleware with environment-based origin whitelist
app.use(corsMiddleware);

const isTestEnv = envConfig.NODE_ENV === 'test';

// Declare monitoring services at module level for process handler access
let dbMonitoringService: DatabaseMonitoringService | null = null;
let appMonitoringService: ApplicationMonitoringService | null = null;

if (!isTestEnv) {
  // Initialize database monitoring
  dbMonitoringService = DatabaseMonitoringService.getInstance();
  dbMonitoringService.initialize({
    slowQueryThreshold: 100, // 100ms
    alertThresholds: {
      connectionPoolUtilization: 90, // 90%
      tableSizeThreshold: 100, // 100MB
      rowCountThreshold: 100000, // 100k rows
      diskSpaceUtilization: 85, // 85%
    },
    checkInterval: 30000, // 30 seconds
    enableLogging: true,
    enableAlerting: true,
  });

  // Listen for database alerts
  dbMonitoringService.on('alert', (alert) => {
    console.log(`Database Alert [${alert.severity.toUpperCase()}]: ${alert.message}`, {
      type: alert.type,
      timestamp: alert.timestamp,
      metadata: alert.metadata,
    });
  });

  // Initialize application monitoring
  appMonitoringService = ApplicationMonitoringService.getInstance();
  appMonitoringService.initialize({
    slowEndpointThreshold: 500, // 500ms
    alertThresholds: {
      errorRate: 5, // 5%
      responseTimeThreshold: 1000, // 1 second
      requestPerMinuteThreshold: 1000, // 1000 requests per minute
    },
    checkInterval: 60000, // 1 minute
    enableLogging: true,
    enableAlerting: true,
    monitoredEndpoints: [
      '/api/inventory-items',
      '/api/products',
      '/api/store-areas',
      '/api/auth/login',
      '/api/reports/usage',
      '/api/reports/expiry',
    ],
  });

  // Listen for application alerts and forward critical/warning alerts to Sentry
  appMonitoringService.on('alert', (alert) => {
    console.log('Application Alert [%s]: %s', alert.severity.toUpperCase(), alert.message, {
      type: alert.type,
      timestamp: alert.timestamp,
      metadata: alert.metadata,
    });

    // Forward to Sentry for visibility and alerting
    if (alert.severity === 'high' || alert.severity === 'critical') {
      Sentry.captureMessage(alert.message, {
        level: 'error',
        extra: alert.metadata,
      });
    } else {
      Sentry.captureMessage(alert.message, {
        level: 'warning',
        extra: alert.metadata,
      });
    }
  });

  // Apply application monitoring middleware
  app.use(appMonitoringService.requestTrackingMiddleware());

  // Initialize analytics service with SQLite adapter (P0-2)
  const analyticsAdapter = new SQLiteAnalyticsAdapter(getDb());
  const analyticsService = new AnalyticsService(analyticsAdapter);
  analyticsService.initialize({
    enableTracking: true,
    enableSessionTracking: true,
    retentionPeriod: 90, // 90 days
    batchSize: 100,
    enablePWAAnalytics: true,
  });

  // Initialize scheduled tasks unless explicitly disabled for test harness runs.
  SchedulerService.initialize();

  // Initialize tier feature flags validation (16A.F.2)
  (async () => {
    try {
      const { initializeTierFlagValidation } = await import('./routes/health.routes');
      await initializeTierFlagValidation();
    } catch (error) {
      console.error('FATAL: Tier feature flags validation failed at startup:', error);
      console.error(
        'Application may not function correctly. Check database tier_feature_flags table.',
      );
    }
  })();

  // ============================================================================
  // Process Lifecycle Handlers
  // ============================================================================
  // Handle graceful shutdown and critical errors at the application level
  // (moved from ApplicationMonitoringService for proper separation of concerns)

  let isShuttingDown = false;

  const shutdown = async (signal: string) => {
    if (isShuttingDown) {
      Logger.info(`Already shutting down, ignoring ${signal}`);
      return;
    }
    isShuttingDown = true;

    Logger.info(`Received ${signal}, shutting down gracefully...`);

    // Stop monitoring services if they were initialized
    if (appMonitoringService) {
      appMonitoringService.stopMonitoring(true);
    }
    if (dbMonitoringService) {
      dbMonitoringService.stopMonitoring(true);
    }

    // Close server if it exists
    if (typeof server !== 'undefined' && server) {
      server.close(() => {
        Logger.info('Server closed');
        process.exit(0);
      });

      // Force close after 10 seconds
      setTimeout(() => {
        Logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    } else {
      process.exit(0);
    }
  };

  // Handle shutdown signals
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM').catch((err) => {
      Logger.error('SIGTERM shutdown error', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT').catch((err) => {
      Logger.error('SIGINT shutdown error', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  });

  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    Logger.error('Uncaught exception:', {
      message: error.message,
      stack: error.stack,
    });

    // Report to Sentry
    Sentry.captureException(error);

    // Attempt graceful shutdown
    void shutdown('uncaughtException');
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
    Logger.error('Unhandled promise rejection:', {
      reason: reason instanceof Error ? reason.message : reason,
      promise: promise.toString(),
    });

    // Report to Sentry
    Sentry.captureException(reason instanceof Error ? reason : new Error(String(reason)));
  });
}

// Public routes
app.use('/auth', authRoutes);
app.use('/api/auth', authRoutes);
app.use('/', healthRoutes); // Health check routes (public)
app.use('/api', healthRoutes);

// Protected routes
app.use('/products', authenticateToken, productRoutes);
app.use('/api/products', authenticateToken, productRoutes);
app.use('/inventory-items', authenticateToken, inventoryRoutes);
app.use('/api/inventory-items', authenticateToken, inventoryRoutes);
app.use('/store-areas', authenticateToken, storeAreaRoutes);
app.use('/api/store-areas', authenticateToken, storeAreaRoutes);
app.use('/reports', authenticateToken, reportRoutes);
app.use('/api/reports', authenticateToken, reportRoutes);
app.use('/dashboard', authenticateToken, dashboardRoutes);
app.use('/api/dashboard', authenticateToken, dashboardRoutes);
app.use('/users', authenticateToken, userRoutes);
app.use('/api/users', authenticateToken, userRoutes);
if (organizationInviteRoutes) {
  app.use('/api/organizations', organizationInviteRoutes);
}
app.use('/api/organization', orgBootstrapRoutes);
app.use('/database', authenticateToken, databaseBackupRoutes);
app.use('/api/database', authenticateToken, databaseBackupRoutes);
app.use('/expired-items', authenticateToken, expiredItemRoutes);
app.use('/api/expired-items', authenticateToken, expiredItemRoutes);
app.use('/api/upload', authenticateToken, uploadRoutes);
app.use('/api/storage-quota', authenticateToken, storageQuotaRoutes);
app.use('/api/subscription', subscriptionRoutes);
app.use('/markdown-config', authenticateToken, markdownConfigRoutes);
app.use('/api/markdown-config', authenticateToken, markdownConfigRoutes);

app.get('/', (req, res) => {
  res.json({
    message: 'Date Management API is running!',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// Serve static files from frontend build directory
const frontendBuildDir = join(__dirname, '../../frontend/build');
const frontendIndexPath = join(frontendBuildDir, 'index.html');
const FRONTEND_INDEX_CHECK_TTL_MS = 30000;
let frontendIndexAvailability: { exists: boolean; checkedAt: number } | null = null;

async function isFrontendIndexAvailable(): Promise<boolean> {
  const now = Date.now();
  if (
    frontendIndexAvailability &&
    now - frontendIndexAvailability.checkedAt < FRONTEND_INDEX_CHECK_TTL_MS
  ) {
    return frontendIndexAvailability.exists;
  }

  try {
    await fs.access(frontendIndexPath);
    frontendIndexAvailability = { exists: true, checkedAt: now };
    return true;
  } catch {
    frontendIndexAvailability = { exists: false, checkedAt: now };
    return false;
  }
}

app.use(express.static(frontendBuildDir));

// Catch-all route for SPA fallback (this should come after API routes)
// This handles client-side routing in production
app.get('*', async (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({
      code: 'NOT_FOUND',
      message: 'Endpoint not found',
    });
  }

  // Check if the request accepts HTML and doesn't have an extension (like .js, .css, .json)
  if (req.accepts('html') && !req.url.match(/\./)) {
    const indexAvailable = await isFrontendIndexAvailable();
    if (indexAvailable) {
      return res.sendFile(frontendIndexPath);
    }

    return res.status(404).json({
      code: 'FRONTEND_BUILD_NOT_FOUND',
      message: 'Frontend build is not available on this server.',
    });
  } else {
    // If it's a file request, return 404 since it's not in the static directory
    return res.status(404).send('File not found');
  }
});

// Sentry error handler must be added before any other error-handling middleware
// Skip in test environment to avoid instrumentation warnings
if (!isTestEnv) {
  Sentry.setupExpressErrorHandler(app);
}

// Error handling middleware
app.use(errorHandler);

// Define a union type for the server to handle both HTTP and HTTPS
type AppServer = HttpServer | HttpsServer;

let server: AppServer;

const startServer = async (): Promise<void> => {
  if (process.env.NODE_ENV !== 'test') {
    // Check if we should enable HTTPS
    if (envConfig.NODE_ENV === 'production' && envConfig.USE_HTTPS) {
      try {
        // Read SSL certificate and key
        if (!envConfig.SSL_PRIVATE_KEY_PATH || !envConfig.SSL_CERT_PATH) {
          throw new Error(
            'SSL_PRIVATE_KEY_PATH and SSL_CERT_PATH must be provided when USE_HTTPS is true',
          );
        }

        const [key, cert] = await Promise.all([
          fs.readFile(envConfig.SSL_PRIVATE_KEY_PATH),
          fs.readFile(envConfig.SSL_CERT_PATH),
        ]);

        const httpsOptions = {
          key,
          cert,
        };

        server = createServer(httpsOptions, app);
        server.listen(port, () => {
          console.log(`HTTPS Server is running on https://localhost:${port}`);
        });
      } catch (error) {
        console.error('FATAL: Failed to start HTTPS server in production:', error);
        process.exit(1);
      }
    } else {
      // Use regular HTTP server for development or if HTTPS is disabled
      server = app.listen(port, () => {
        console.log(`Server is running on http://localhost:${port}`);
      });
    }
  }
};

void startServer();

export default app;
