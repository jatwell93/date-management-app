/**
 * Cloudflare Workers Entry Point
 * 
 * Production deployment entry point that wraps existing Express routes
 * for Cloudflare Workers environment.
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
import { handleHealthCheck } from './health';

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
 * Initialize Workers router with all Express routes
 */
function createRouter(env: Env): WorkersRouter {
  const router = new WorkersRouter();

  // Global middleware
  router.use(createProductionCors(env));
  router.use(createRequestLogger(env));
  router.use(createRateLimiter(env));

  // Import and register Express routes
  // Note: Actual route registration would import from backend/src/routes/
  // For now, we'll define the structure. The actual imports need to be
  // adapted to work in Workers environment (no file system access)

  // Health check (no auth required)
  router.addRoute('/health', async (req: ExpressRequest, res: ExpressResponse) => {
    res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      environment: env.NODE_ENV,
    });
  });

  // TODO: Import and register all backend routes
  // router.addRoute('/api/auth/*', authRoutes);
  // router.addRoute('/api/products/*', productRoutes);
  // router.addRoute('/api/inventory-items/*', inventoryRoutes);
  // router.addRoute('/api/store-areas/*', storeAreaRoutes);
  // router.addRoute('/api/reports/*', reportRoutes);
  // router.addRoute('/api/dashboard/*', dashboardRoutes);
  // router.addRoute('/api/users/*', userRoutes);
  // router.addRoute('/api/database/*', databaseBackupRoutes);
  // router.addRoute('/api/expired-items/*', expiredItemRoutes);

  return router;
}

/**
 * Main Workers fetch handler
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    
    // Fast-path health check (bypass full routing)
    if (url.pathname === '/health') {
      return handleHealthCheck(request, env);
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

      return res.toResponse();
    } catch (error) {
      // Global error handler
      logger.error('Unhandled error in fetch handler', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });

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
  },
};
