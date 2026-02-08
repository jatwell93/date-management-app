/**
 * Cloudflare Workers Entry Point
 * 
 * Production deployment entry point that wraps existing Express routes
 * for Cloudflare Workers environment.
 * 
 * Database Connection:
 * - Uses Cloudflare Hyperdrive for edge connection pooling to Neon PostgreSQL
 * - Hyperdrive provides lowest latency by pooling connections at Cloudflare's edge
 * - Connection string available via env.HYPERDRIVE.connectionString
 */

import { Env } from './types/env';
import {
  createExpressRequest,
  ExpressResponse,
  ExpressRequest,
  executeMiddleware,
  ExpressMiddleware,
  adaptExpressHandler,
} from './express-adapter';
import { createProductionCors } from './middleware/cors.middleware';
import { createRateLimiter } from './middleware/rate-limit.middleware';
import { createRequestLogger, createErrorHandler, WorkersLogger } from './middleware/error-handler.middleware';
import {
  createMetricsInitializer,
  getRequestMetrics,
  formatMetricsForAnalytics,
} from './middleware/metrics.middleware';
import { handleHealthCheck } from './health';
import { createDatabaseClient } from '../../backend/src/database/database-factory';

/**
 * Initialize Sentry for Workers error tracking (when DSN is configured)
 * 
 * Note: Sentry for Cloudflare Workers requires ES modules, which is fully
 * supported in the Workers environment.
 */
function initializeSentry(env: Env) {
  // Dynamically check for Sentry initialization based on env
  if (env.SENTRY_DSN) {
    // Sentry initialization would happen here
    // For now, errors are captured via the custom error handler below
    return true;
  }
  return false;
}

/**
 * Initialize Prisma client with Hyperdrive connection
 * This provides edge-pooled connections to Neon PostgreSQL
 */
export function createWorkersDatabase(env: Env) {
  return createDatabaseClient({
    environment: 'production',
    hyperdriveConnectionString: env.HYPERDRIVE.connectionString,
    enableLogging: env.NODE_ENV === 'development',
  });
}

// Import backend Express routes
// Note: Product routes use multer for file uploads - skipped for Workers (no filesystem)
import authRoutes from '../../backend/src/routes/auth.routes';
import dashboardRoutes from '../../backend/src/routes/dashboard.routes';
import expiredItemRoutes from '../../backend/src/routes/expired-item.routes';
import healthRoutes from '../../backend/src/routes/health.routes';
import inventoryRoutes from '../../backend/src/routes/inventory.routes';
import reportRoutes from '../../backend/src/routes/report.routes';
import storeAreaRoutes from '../../backend/src/routes/store-area.routes';
import userRoutes from '../../backend/src/routes/user.routes';
// Skipped: product.routes.ts (uses multer - filesystem dependency)
// Skipped: database.backup.routes.ts (uses filesystem for backups)

import * as Sentry from "@sentry/cloudflare";

/**
 * Route definition
 */
interface Route {
  path: RegExp;
  handler: (req: ExpressRequest, res: ExpressResponse) => Promise<void>;
  middleware?: ExpressMiddleware[];
}

/**
 * Simple router for Workers
 */
class WorkersRouter {
  private routes: Route[] = [];
  private globalMiddleware: ExpressMiddleware[] = [];

  use(middleware: ExpressMiddleware) {
    this.globalMiddleware.push(middleware);
  }

  addRoute(pattern: string, handler: any, middleware: ExpressMiddleware[] = []) {
    // Convert Express-style pattern to RegExp
    const regexPattern = pattern
      .replace(/\*/g, '.*')
      .replace(/\//g, '\\/')
      .replace(/:(\w+)/g, '(?<$1>[^/]+)');
    
    const regex = new RegExp(`^${regexPattern}$`);
    
    this.routes.push({
      path: regex,
      handler: async (req: ExpressRequest, res: ExpressResponse) => {
        await adaptExpressHandler(handler)(req, res);
      },
      middleware,
    });
  }

  async route(req: ExpressRequest, res: ExpressResponse): Promise<boolean> {
    // Execute global middleware first
    const continueGlobal = await executeMiddleware(this.globalMiddleware, req, res);
    if (!continueGlobal) {
      return true;
    }

    // Find matching route
    for (const route of this.routes) {
      const match = req.path.match(route.path);
      if (match) {
        // Extract route params from named groups
        if (match.groups) {
          req.params = match.groups;
        }

        // Execute route-specific middleware
        if (route.middleware) {
          const continueRoute = await executeMiddleware(route.middleware, req, res);
          if (!continueRoute) {
            return true;
          }
        }

        // Execute handler
        await route.handler(req, res);
        return true;
      }
    }

    return false;
  }
}

/**
 * Register Express Router with Workers router
 * Converts Express router's stack to Workers-compatible routes
 */
function registerExpressRouter(
  workersRouter: WorkersRouter,
  expressRouter: any,
  basePath: string,
  env: Env
) {
  // Express router stores routes in router.stack
  const stack = expressRouter.stack || [];
  
  for (const layer of stack) {
    if (layer.route) {
      // Direct route handler
      const methods = Object.keys(layer.route.methods);
      const path = basePath + layer.route.path;
      
      // Register for each HTTP method
      for (const method of methods) {
        const handlers = layer.route.stack.map((l: any) => l.handle);
        
        // Wrap all handlers with adapter
        workersRouter.addRoute(path, async (req: ExpressRequest, res: ExpressResponse) => {
          req.method = method.toUpperCase();
          
          // Execute handlers in sequence
          for (const handler of handlers) {
            await adaptExpressHandler(handler)(req, res);
            if (res.isSent()) break;
          }
        });
      }
    } else if (layer.name === 'router') {
      // Nested router
      const nestedPath = basePath + (layer.regexp.source.match(/^\/\^\\\/([^\\]+)/) || ['', ''])[1];
      registerExpressRouter(workersRouter, layer.handle, nestedPath, env);
    }
  }
}

/**
 * Initialize Workers router with all Express routes
 */
function createRouter(env: Env): WorkersRouter {
  const router = new WorkersRouter();

  // Global middleware
  router.use(createMetricsInitializer()); // Initialize metrics tracking first
  router.use(createProductionCors(env));
  router.use(createRequestLogger(env));
  router.use(createRateLimiter(env));

  // Register imported Express routes
  // Each route is prefixed with /api to match backend URL structure
  registerExpressRouter(router, authRoutes, '/api/auth', env);
  registerExpressRouter(router, dashboardRoutes, '/api/dashboard', env);
  registerExpressRouter(router, expiredItemRoutes, '/api/expired-items', env);
  registerExpressRouter(router, healthRoutes, '/api/health', env);
  registerExpressRouter(router, inventoryRoutes, '/api/inventory-items', env);
  registerExpressRouter(router, reportRoutes, '/api/reports', env);
  registerExpressRouter(router, storeAreaRoutes, '/api/store-areas', env);
  registerExpressRouter(router, userRoutes, '/api/users', env);

  // Note: Skipped routes that require filesystem access:
  // - product.routes.ts (uses multer for CSV uploads)
  // - database.backup.routes.ts (filesystem backups)
  // These would need Workers-specific implementations using R2

  return router;
}

/**
 * Write metrics to Cloudflare Analytics Engine
 * Production-only: tracks request/response metrics for monitoring
 */
function writeMetrics(env: Env, metrics: any): void {
  // Only write metrics in production when Analytics is available
  if (env.NODE_ENV === 'production' && env.ANALYTICS) {
    try {
      const analyticsData = formatMetricsForAnalytics(metrics);
      env.ANALYTICS.writeDataPoint(analyticsData);
    } catch (error) {
      // Silently fail if Analytics writing fails - don't block requests
      console.error('Failed to write metrics to Analytics Engine:', error);
    }
  }
}

/**
 * Main Workers fetch handler
 */
export default Sentry.withSentry(
  (env: any) => ({
    dsn: env.WORKERS_SENTRY_DSN || env.SENTRY_DSN,
    tracesSampleRate: 1.0, // Adjust to 0.1 later to save on free tier quota
  }),
  {
    async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
      const url = new URL(request.url);
      const startTime = Date.now();
      
      // Fast-path health check (bypass full routing)
      if (url.pathname === '/health') {
        return handleHealthCheck(request, env);
      }

      // Test route for Sentry testing
      if (url.pathname === '/api/test-error') {
        // This will trigger a Sentry error in Workers
        throw new Error('Test error from Cloudflare Workers - this should be captured by Sentry');
      }

      const logger = new WorkersLogger(env);
      const errorHandler = createErrorHandler(env);

      try {
        // Create Express-compatible request
        const req = await createExpressRequest(request, {}, env);
        const res = new ExpressResponse();

        // Route request
        const router = createRouter(env);
        const handled = await router.route(req, res);

        if (!handled) {
          // 404 Not Found
          res.status(404).json({
            error: 'Not Found',
            message: `Route ${req.path} not found`,
          });
        }

        const response = res.toResponse();
        
        // Extract metrics from request context (includes CSV instrumentation if applicable)
        const metrics = getRequestMetrics(req, res, response.status);
        writeMetrics(env, metrics);

        return response;
      } catch (error) {
        // Global error handler
        const responseTime = Date.now() - startTime;
        
        logger.error('Unhandled error in fetch handler', {
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
        });

        // Create error metrics for error responses
        const errorMetrics = {
          timestamp: startTime,
          endpoint: url.pathname,
          method: request.method,
          status: 500,
          responseTime,
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
        };
        
        writeMetrics(env, errorMetrics);

        return new Response(
          JSON.stringify({
            error: 'Internal Server Error',
            message: env.NODE_ENV === 'development' 
              ? (error instanceof Error ? error.message : 'Unknown error')
              : 'An unexpected error occurred',
          }),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
    }
  }
);
