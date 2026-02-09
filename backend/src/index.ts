require('../instrument');

import express from 'express';
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
import { authenticateToken } from './middleware/auth.middleware';
import { errorHandler } from './middleware/error.middleware';
import { corsMiddleware } from './middleware/cors';
import { globalLimiter } from './middleware/rateLimiter';
import { SchedulerService } from './services/scheduler.service';
import { DatabaseMonitoringService } from './services/database.monitoring.service';
import { ApplicationMonitoringService } from './services/application.monitoring.service';
import { ServiceProvider } from './services/service-provider';
import { envConfig } from './config/environment';

const app = express();
const port = envConfig.PORT;

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
app.use(globalLimiter);

// Middleware
// Task 5.3: Configure request payload size limit (10MB)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Apply CORS middleware with environment-based origin whitelist
app.use(corsMiddleware);

// Initialize database
(async () => {
  // await initDatabase();
})();

const isTestEnv = envConfig.NODE_ENV === 'test';

if (!isTestEnv) {
  // Initialize database monitoring
  const dbMonitoringService = DatabaseMonitoringService.getInstance();
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
  const appMonitoringService = ApplicationMonitoringService.getInstance();
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

  // Listen for application alerts
  appMonitoringService.on('alert', (alert) => {
    console.log('Application Alert [%s]: %s', alert.severity.toUpperCase(), alert.message, {
      type: alert.type,
      timestamp: alert.timestamp,
      metadata: alert.metadata,
    });
  });

  // Apply application monitoring middleware
  app.use(appMonitoringService.requestTrackingMiddleware());

  // Initialize analytics service via ServiceProvider (Task 8.7)
  const serviceProvider = new ServiceProvider();
  const analyticsService = serviceProvider.getAnalyticsService();
  analyticsService.initialize({
    enableTracking: true,
    enableSessionTracking: true,
    retentionPeriod: 90, // 90 days
    batchSize: 100,
    enablePWAAnalytics: true,
  });

  // Initialize scheduled tasks
  SchedulerService.initialize();
}

// Public routes
app.use('/auth', authRoutes);
app.use('/health', healthRoutes); // Health check routes (public)

// Protected routes
app.use('/products', authenticateToken, productRoutes);
app.use('/inventory-items', authenticateToken, inventoryRoutes);
app.use('/store-areas', authenticateToken, storeAreaRoutes);
app.use('/reports', authenticateToken, reportRoutes);
app.use('/dashboard', authenticateToken, dashboardRoutes);
app.use('/users', authenticateToken, userRoutes);
app.use('/database', authenticateToken, databaseBackupRoutes);
app.use('/expired-items', authenticateToken, expiredItemRoutes);
app.use('/api/upload', authenticateToken, uploadRoutes);
app.use('/api/storage-quota', authenticateToken, storageQuotaRoutes);

app.get('/', (req, res) => {
  res.json({
    message: 'Date Management API is running!',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// Serve static files from frontend build directory
app.use(express.static(join(__dirname, '../../../frontend/build')));

// Catch-all route for SPA fallback (this should come after API routes)
// This handles client-side routing in production
app.get('*', (req, res) => {
  // Check if the request accepts HTML and doesn't have an extension (like .js, .css, .json)
  if (req.accepts('html') && !req.url.match(/\./)) {
    res.sendFile(join(__dirname, '../../../frontend/build/index.html'));
  } else {
    // If it's a file request, return 404 since it's not in the static directory
    res.status(404).send('File not found');
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
        console.error('Failed to start HTTPS server:', error);
        console.log('Falling back to HTTP server');
        server = app.listen(port, () => {
          console.log(`HTTP Server is running on http://localhost:${port}`);
        });
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
