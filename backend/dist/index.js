"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
try {
    // Optional instrumentation (Sentry/analytics). Safe to skip if missing.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('../instrument');
}
catch {
    // Instrumentation not present in this environment; continue without it.
}
const express_1 = __importDefault(require("express"));
const helmet_1 = __importDefault(require("helmet"));
const Sentry = __importStar(require("@sentry/node"));
const https_1 = require("https");
const fs_1 = require("fs");
const path_1 = require("path");
// import { initDatabase } from './database';
const auth_routes_1 = __importDefault(require("./routes/auth.routes"));
const product_routes_1 = __importDefault(require("./routes/product.routes"));
const inventory_routes_1 = __importDefault(require("./routes/inventory.routes"));
const report_routes_1 = __importDefault(require("./routes/report.routes"));
const dashboard_routes_1 = __importDefault(require("./routes/dashboard.routes"));
const user_routes_1 = __importDefault(require("./routes/user.routes"));
const store_area_routes_1 = __importDefault(require("./routes/store-area.routes"));
const health_routes_1 = __importDefault(require("./routes/health.routes"));
const database_backup_routes_1 = __importDefault(require("./routes/database.backup.routes"));
const expired_item_routes_1 = __importDefault(require("./routes/expired-item.routes"));
const upload_routes_1 = __importDefault(require("./routes/upload.routes"));
const storage_quota_routes_1 = __importDefault(require("./routes/storage-quota.routes"));
const webhook_routes_1 = __importDefault(require("./routes/webhook.routes"));
const organization_invite_routes_1 = __importDefault(require("./routes/organization-invite.routes"));
const subscription_routes_1 = __importDefault(require("./routes/subscription.routes"));
const auth_middleware_1 = require("./middleware/auth.middleware");
const error_middleware_1 = require("./middleware/error.middleware");
const cors_1 = require("./middleware/cors");
const rateLimiter_1 = require("./middleware/rateLimiter");
const scheduler_service_1 = require("./services/scheduler.service");
const database_monitoring_service_1 = require("./services/database.monitoring.service");
const application_monitoring_service_1 = require("./services/application.monitoring.service");
const analytics_service_1 = require("./services/analytics.service");
const database_1 = require("./database");
const environment_1 = require("./config/environment");
const app = (0, express_1.default)();
const port = environment_1.envConfig.PORT;
// Required when running behind reverse proxies/tunnels (ngrok, nginx, cloud load balancers)
// so middleware like express-rate-limit can safely use X-Forwarded-For.
app.set('trust proxy', 1);
// Security headers using Helmet
app.use((0, helmet_1.default)({
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
}));
// Apply global rate limiter (DDoS protection - 1000 requests per minute per IP)
// BUT: Skip webhooks since they're from trusted external services
app.use((req, res, next) => {
    if (req.path.startsWith('/api/webhooks')) {
        return next(); // Skip rate limiter for webhooks
    }
    (0, rateLimiter_1.globalLimiter)(req, res, next);
});
// IMPORTANT: Webhook route with raw body parser must come BEFORE express.json()
// Stripe signature verification requires the raw body
app.use('/api/webhooks', express_1.default.raw({ type: 'application/json' }), webhook_routes_1.default);
// Middleware
// Task 5.3: Configure request payload size limit (10MB)
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ extended: true, limit: '10mb' }));
// Apply CORS middleware with environment-based origin whitelist
app.use(cors_1.corsMiddleware);
// Initialize database
(async () => {
    // await initDatabase();
})();
const isTestEnv = environment_1.envConfig.NODE_ENV === 'test';
if (!isTestEnv) {
    // Initialize database monitoring
    const dbMonitoringService = database_monitoring_service_1.DatabaseMonitoringService.getInstance();
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
    const appMonitoringService = application_monitoring_service_1.ApplicationMonitoringService.getInstance();
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
        }
        else {
            Sentry.captureMessage(alert.message, {
                level: 'warning',
                extra: alert.metadata,
            });
        }
    });
    // Apply application monitoring middleware
    app.use(appMonitoringService.requestTrackingMiddleware());
    // Initialize analytics service (Task 8.7)
    const analyticsService = new analytics_service_1.AnalyticsService((0, database_1.getDb)());
    analyticsService.initialize({
        enableTracking: true,
        enableSessionTracking: true,
        retentionPeriod: 90, // 90 days
        batchSize: 100,
        enablePWAAnalytics: true,
    });
    // Initialize scheduled tasks
    scheduler_service_1.SchedulerService.initialize();
    // Initialize tier feature flags validation (16A.F.2)
    (async () => {
        try {
            const { initializeTierFlagValidation } = await Promise.resolve().then(() => __importStar(require('./routes/health.routes')));
            await initializeTierFlagValidation();
        }
        catch (error) {
            console.error('FATAL: Tier feature flags validation failed at startup:', error);
            console.error('Application may not function correctly. Check database tier_feature_flags table.');
        }
    })();
}
// Public routes
app.use('/auth', auth_routes_1.default);
app.use('/health', health_routes_1.default); // Health check routes (public)
// Protected routes
app.use('/products', auth_middleware_1.authenticateToken, product_routes_1.default);
app.use('/inventory-items', auth_middleware_1.authenticateToken, inventory_routes_1.default);
app.use('/store-areas', auth_middleware_1.authenticateToken, store_area_routes_1.default);
app.use('/reports', auth_middleware_1.authenticateToken, report_routes_1.default);
app.use('/dashboard', auth_middleware_1.authenticateToken, dashboard_routes_1.default);
app.use('/users', auth_middleware_1.authenticateToken, user_routes_1.default);
app.use('/api/organizations', organization_invite_routes_1.default);
app.use('/database', auth_middleware_1.authenticateToken, database_backup_routes_1.default);
app.use('/expired-items', auth_middleware_1.authenticateToken, expired_item_routes_1.default);
app.use('/api/upload', auth_middleware_1.authenticateToken, upload_routes_1.default);
app.use('/api/storage-quota', auth_middleware_1.authenticateToken, storage_quota_routes_1.default);
app.use('/api/subscription', subscription_routes_1.default);
app.get('/', (req, res) => {
    res.json({
        message: 'Date Management API is running!',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
    });
});
// Serve static files from frontend build directory
app.use(express_1.default.static((0, path_1.join)(__dirname, '../../../frontend/build')));
// Catch-all route for SPA fallback (this should come after API routes)
// This handles client-side routing in production
app.get('*', (req, res) => {
    // Check if the request accepts HTML and doesn't have an extension (like .js, .css, .json)
    if (req.accepts('html') && !req.url.match(/\./)) {
        res.sendFile((0, path_1.join)(__dirname, '../../../frontend/build/index.html'));
    }
    else {
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
app.use(error_middleware_1.errorHandler);
let server;
const startServer = async () => {
    if (process.env.NODE_ENV !== 'test') {
        // Check if we should enable HTTPS
        if (environment_1.envConfig.NODE_ENV === 'production' && environment_1.envConfig.USE_HTTPS) {
            try {
                // Read SSL certificate and key
                if (!environment_1.envConfig.SSL_PRIVATE_KEY_PATH || !environment_1.envConfig.SSL_CERT_PATH) {
                    throw new Error('SSL_PRIVATE_KEY_PATH and SSL_CERT_PATH must be provided when USE_HTTPS is true');
                }
                const [key, cert] = await Promise.all([
                    fs_1.promises.readFile(environment_1.envConfig.SSL_PRIVATE_KEY_PATH),
                    fs_1.promises.readFile(environment_1.envConfig.SSL_CERT_PATH),
                ]);
                const httpsOptions = {
                    key,
                    cert,
                };
                server = (0, https_1.createServer)(httpsOptions, app);
                server.listen(port, () => {
                    console.log(`HTTPS Server is running on https://localhost:${port}`);
                });
            }
            catch (error) {
                console.error('Failed to start HTTPS server:', error);
                console.log('Falling back to HTTP server');
                server = app.listen(port, () => {
                    console.log(`HTTP Server is running on http://localhost:${port}`);
                });
            }
        }
        else {
            // Use regular HTTP server for development or if HTTPS is disabled
            server = app.listen(port, () => {
                console.log(`Server is running on http://localhost:${port}`);
            });
        }
    }
};
void startServer();
exports.default = app;
