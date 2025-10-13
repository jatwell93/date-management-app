"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const https_1 = require("https");
const fs_1 = require("fs");
const path_1 = require("path");
const rate_limiter_flexible_1 = require("rate-limiter-flexible");
const database_1 = require("./database");
const auth_routes_1 = __importDefault(require("./routes/auth.routes"));
const product_routes_1 = __importDefault(require("./routes/product.routes"));
const inventory_routes_1 = __importDefault(require("./routes/inventory.routes"));
const report_routes_1 = __importDefault(require("./routes/report.routes"));
const dashboard_routes_1 = __importDefault(require("./routes/dashboard.routes"));
const user_routes_1 = __importDefault(require("./routes/user.routes"));
const store_area_routes_1 = __importDefault(require("./routes/store-area.routes"));
const health_routes_1 = __importDefault(require("./routes/health.routes"));
const database_backup_routes_1 = __importDefault(require("./routes/database.backup.routes"));
const auth_middleware_1 = require("./middleware/auth.middleware");
const error_middleware_1 = require("./middleware/error.middleware");
const scheduler_service_1 = require("./services/scheduler.service");
const database_monitoring_service_1 = require("./services/database.monitoring.service");
const application_monitoring_service_1 = require("./services/application.monitoring.service");
const analytics_service_1 = require("./services/analytics.service");
const environment_1 = require("./config/environment");
const app = (0, express_1.default)();
const port = environment_1.envConfig.PORT;
// Rate limiter configuration - limit each IP to 1000 requests per minute
const rateLimiter = new rate_limiter_flexible_1.RateLimiterMemory({
    points: 1000, // Number of requests allowed per IP
    duration: 60, // Per 60 seconds
});
// Security headers using Helmet
app.use((0, helmet_1.default)({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "https:"],
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
// Configure CORS based on environment
const corsOptions = {
    origin: environment_1.envConfig.NODE_ENV === 'production'
        ? environment_1.envConfig.FRONTEND_URL // Use validated frontend URL in production
        : '*', // Allow all origins in development
    credentials: true,
    optionsSuccessStatus: 200
};
// Apply rate limiting middleware to all requests
app.use((req, res, next) => {
    const ipKey = req.ip ?? req.headers["x-forwarded-for"]?.toString() ?? "unknown";
    rateLimiter.consume(ipKey)
        .then(() => {
        next(); // If rate limit is not exceeded, continue
    })
        .catch(() => {
        // If rate limit is exceeded, return 429 (Too Many Requests)
        res.status(429).send({ error: 'Too Many Requests' });
    });
});
// Middleware
app.use(express_1.default.json());
app.use((0, cors_1.default)(corsOptions)); // Enable CORS with options
// Initialize database
(async () => {
    await (0, database_1.initDatabase)();
})();
// Initialize database monitoring
const dbMonitoringService = database_monitoring_service_1.DatabaseMonitoringService.getInstance();
dbMonitoringService.initialize({
    slowQueryThreshold: 100, // 100ms
    alertThresholds: {
        connectionPoolUtilization: 90, // 90%
        tableSizeThreshold: 100, // 100MB
        rowCountThreshold: 100000, // 100k rows
        diskSpaceUtilization: 85 // 85%
    },
    checkInterval: 30000, // 30 seconds
    enableLogging: true,
    enableAlerting: true
});
// Listen for database alerts
dbMonitoringService.on('alert', (alert) => {
    console.log(`Database Alert [${alert.severity.toUpperCase()}]: ${alert.message}`, {
        type: alert.type,
        timestamp: alert.timestamp,
        metadata: alert.metadata
    });
});
// Initialize application monitoring
const appMonitoringService = application_monitoring_service_1.ApplicationMonitoringService.getInstance();
appMonitoringService.initialize({
    slowEndpointThreshold: 500, // 500ms
    alertThresholds: {
        errorRate: 5, // 5%
        responseTimeThreshold: 1000, // 1 second
        requestPerMinuteThreshold: 1000 // 1000 requests per minute
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
        '/api/reports/expiry'
    ]
});
// Listen for application alerts
appMonitoringService.on('alert', (alert) => {
    console.log(`Application Alert [${alert.severity.toUpperCase()}]: ${alert.message}`, {
        type: alert.type,
        timestamp: alert.timestamp,
        metadata: alert.metadata
    });
});
// Apply application monitoring middleware
app.use(appMonitoringService.requestTrackingMiddleware());
// Initialize analytics service
const analyticsService = analytics_service_1.AnalyticsService.getInstance();
analyticsService.initialize({
    enableTracking: true,
    enableSessionTracking: true,
    retentionPeriod: 90, // 90 days
    batchSize: 100,
    enablePWAAnalytics: true
});
// Initialize scheduled tasks
scheduler_service_1.SchedulerService.initialize();
// Public routes
app.use("/auth", auth_routes_1.default);
app.use("/health", health_routes_1.default); // Health check routes (public)
// Protected routes
app.use("/products", auth_middleware_1.authenticateToken, product_routes_1.default);
app.use("/inventory-items", auth_middleware_1.authenticateToken, inventory_routes_1.default);
app.use("/store-areas", auth_middleware_1.authenticateToken, store_area_routes_1.default);
app.use("/reports", auth_middleware_1.authenticateToken, report_routes_1.default);
app.use("/dashboard", auth_middleware_1.authenticateToken, dashboard_routes_1.default);
app.use("/users", auth_middleware_1.authenticateToken, user_routes_1.default);
app.use("/database", auth_middleware_1.authenticateToken, database_backup_routes_1.default);
app.get("/", (req, res) => {
    res.json({
        message: "Date Management API is running!",
        version: "1.0.0",
        timestamp: new Date().toISOString()
    });
});
// Serve static files from frontend build directory
app.use(express_1.default.static((0, path_1.join)(__dirname, "../../../frontend/build")));
// Catch-all route for SPA fallback (this should come after API routes)
// This handles client-side routing in production
app.get("*", (req, res) => {
    // Check if the request accepts HTML and doesn't have an extension (like .js, .css, .json)
    if (req.accepts('html') && !req.url.match(/\./)) {
        res.sendFile((0, path_1.join)(__dirname, "../../../frontend/build/index.html"));
    }
    else {
        // If it's a file request, return 404 since it's not in the static directory
        res.status(404).send('File not found');
    }
});
// Error handling middleware
app.use(error_middleware_1.errorHandler);
let server;
if (process.env.NODE_ENV !== "test") {
    // Check if we should enable HTTPS
    if (environment_1.envConfig.NODE_ENV === 'production' && environment_1.envConfig.USE_HTTPS) {
        try {
            // Read SSL certificate and key
            if (!environment_1.envConfig.SSL_PRIVATE_KEY_PATH || !environment_1.envConfig.SSL_CERT_PATH) {
                throw new Error('SSL_PRIVATE_KEY_PATH and SSL_CERT_PATH must be provided when USE_HTTPS is true');
            }
            const httpsOptions = {
                key: (0, fs_1.readFileSync)(environment_1.envConfig.SSL_PRIVATE_KEY_PATH),
                cert: (0, fs_1.readFileSync)(environment_1.envConfig.SSL_CERT_PATH)
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
exports.default = app;
