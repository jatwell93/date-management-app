/**
 * Express-to-Workers Adapter
 * 
 * Provides compatibility layer between Express route handlers and Cloudflare Workers.
 * Converts Workers Request/Response objects to Express-style req/res objects.
 */

import { Env } from './types/env';

/**
 * Express-compatible Request object
 */
export interface ExpressRequest {
  body: any;
  params: Record<string, string>;
  query: Record<string, string>;
  headers: Record<string, string>;
  method: string;
  url: string;
  path: string;
  ip: string;
  correlationId?: string;
  get(header: string): string | undefined;
  userId?: number;
  userRole?: string;
  user?: {
    id: number;
    role: string;
  };
  organizationId?: string;
  requestTimeoutMs?: number;
  releaseConnection?: () => void;
}

/**
 * Express-compatible Response object
 */
export class ExpressResponse {
  private statusCode: number = 200;
  private responseHeaders: Record<string, string> = {};
  private responseBody: any = null;
  private sent: boolean = false;

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  json(data: any): void {
    if (this.sent) return;
    this.responseHeaders['Content-Type'] = 'application/json';
    this.responseBody = JSON.stringify(data);
    this.sent = true;
  }

  send(data: any): void {
    if (this.sent) return;
    this.responseBody = data;
    this.sent = true;
  }

  setHeader(name: string, value: string): void {
    this.responseHeaders[name] = value;
  }

  getHeader(name: string): string | undefined {
    return this.responseHeaders[name];
  }

  toResponse(): Response {
    return new Response(this.responseBody, {
      status: this.statusCode,
      headers: this.responseHeaders,
    });
  }

  isSent(): boolean {
    return this.sent;
  }
}

/**
 * Convert Workers Request to Express-style Request
 */
export async function createExpressRequest(
  request: Request,
  params: Record<string, string> = {},
  env: Env
): Promise<ExpressRequest> {
  const url = new URL(request.url);
  const query: Record<string, string> = {};
  
  // Parse query parameters
  url.searchParams.forEach((value, key) => {
    query[key] = value;
  });

  // Parse request body if present
  let body: any = null;
  const contentType = request.headers.get('Content-Type') || '';
  
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    if (contentType.includes('application/json')) {
      try {
        body = await request.json();
      } catch {
        body = {};
      }
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      const formData = await request.formData();
      body = Object.fromEntries(formData.entries());
    } else if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      body = Object.fromEntries(formData.entries());
    }
  }

  // Extract headers
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  // Get client IP (from CF-Connecting-IP header or fallback)
  const ip = request.headers.get('CF-Connecting-IP') || 
             request.headers.get('X-Forwarded-For')?.split(',')[0].trim() || 
             'unknown';

  return {
    body,
    params,
    query,
    headers,
    method: request.method,
    url: request.url,
    path: url.pathname,
    ip,
    get(header: string): string | undefined {
      return headers[header.toLowerCase()];
    },
  };
}

/**
 * Express route handler type
 */
export type ExpressHandler = (
  req: ExpressRequest,
  res: ExpressResponse
) => Promise<void> | void;

/**
 * Middleware function type
 */
export type ExpressMiddleware = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: () => void
) => Promise<void> | void;

/**
 * Execute middleware chain
 */
export async function executeMiddleware(
  middlewares: ExpressMiddleware[],
  req: ExpressRequest,
  res: ExpressResponse
): Promise<boolean> {
  for (const middleware of middlewares) {
    let nextCalled = false;
    const next = () => {
      nextCalled = true;
    };

    await middleware(req, res, next);

    // If response was sent or next() wasn't called, stop
    if (res.isSent() || !nextCalled) {
      return false;
    }
  }
  return true;
}

/**
 * Wrap Express route handler for Workers environment
 */
export function adaptExpressHandler(handler: ExpressHandler): ExpressHandler {
  return async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (!res.isSent()) {
        console.error('Express handler error:', error);
        res.status(500).json({
          error: 'Internal server error',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  };
}
