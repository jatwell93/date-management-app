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
