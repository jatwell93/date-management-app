/**
 * CORS Middleware for Cloudflare Workers
 * 
 * Handles Cross-Origin Resource Sharing (CORS) headers for production deployment.
 */

import { Env } from '../types/env';
import { ExpressRequest, ExpressResponse, ExpressMiddleware } from '../express-adapter';

/**
 * CORS configuration
 */
interface CorsOptions {
  origin: string | string[];
  credentials: boolean;
  methods?: string[];
  allowedHeaders?: string[];
  exposedHeaders?: string[];
  maxAge?: number;
}

/**
 * Create CORS middleware
 */
export function createCorsMiddleware(options: CorsOptions): ExpressMiddleware {
  return async (req: ExpressRequest, res: ExpressResponse, next: () => void) => {
    const requestOrigin = req.get('Origin') || req.get('Referer') || '';
    
    // Determine if origin is allowed
    let allowedOrigin = '';
    if (typeof options.origin === 'string') {
      allowedOrigin = options.origin === '*' ? '*' : options.origin;
    } else if (Array.isArray(options.origin)) {
      const originUrl = new URL(requestOrigin);
      const isAllowed = options.origin.some(allowed => {
        const allowedUrl = new URL(allowed);
        return originUrl.origin === allowedUrl.origin;
      });
      allowedOrigin = isAllowed ? requestOrigin : '';
    }

    // Set CORS headers
    if (allowedOrigin) {
      res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    }

    if (options.credentials) {
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }

    if (options.methods) {
      res.setHeader('Access-Control-Allow-Methods', options.methods.join(', '));
    }

    if (options.allowedHeaders) {
      res.setHeader('Access-Control-Allow-Headers', options.allowedHeaders.join(', '));
    }

    if (options.exposedHeaders) {
      res.setHeader('Access-Control-Expose-Headers', options.exposedHeaders.join(', '));
    }

    if (options.maxAge) {
      res.setHeader('Access-Control-Max-Age', options.maxAge.toString());
    }

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    next();
  };
}

/**
 * Production CORS configuration
 */
export function createProductionCors(env: Env): ExpressMiddleware {
  // In production, restrict to specific frontend domain
  // In development, allow localhost
  const allowedOrigins = env.NODE_ENV === 'production'
    ? ['https://yourdomain.com', 'https://www.yourdomain.com']
    : ['http://localhost:3000', 'http://127.0.0.1:3000'];

  return createCorsMiddleware({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['Content-Length', 'X-Request-Id'],
    maxAge: 86400, // 24 hours
  });
}
