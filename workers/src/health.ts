/**
 * Health Check Endpoint
 *
 * Lightweight health check that verifies:
 * - Workers service is running
 * - R2 bucket connectivity (optional)
 * - Neon database connectivity (optional)
 */

import { neon } from '@neondatabase/serverless';
import { Env } from './types/env';
import { validateWorkerConfig } from './utils/env-validation';

export interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  environment: string;
  checks: {
    workers: {
      status: 'pass' | 'fail';
      responseTime: number;
    };
    r2?: {
      status: 'pass' | 'fail';
      responseTime?: number;
      error?: string;
    };
    database?: {
      status: 'pass' | 'fail';
      responseTime?: number;
      error?: string;
    };
    /**
     * Configuration validation. Always present, and evaluated without touching
     * the network -- unlike `r2` and `database` it needs no `?deep=true`,
     * because a missing secret is exactly what an operator needs to see on the
     * cheap health call.
     */
    config: {
      status: 'pass' | 'fail';
      missingRequired?: string[];
      missingFeatures?: string[];
    };
  };
}

/**
 * Perform health check
 */
export async function healthCheck(
  env: Env,
  includeConnectivity: boolean = false,
): Promise<HealthCheckResult> {
  const startTime = Date.now();
  const result: HealthCheckResult = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: env.NODE_ENV,
    checks: {
      workers: {
        status: 'pass',
        responseTime: 0,
      },
      config: {
        status: 'pass',
      },
    },
  };

  // Workers service is always healthy if we got here
  result.checks.workers.responseTime = Date.now() - startTime;

  // Configuration. A missing required capability makes the Worker unhealthy
  // even though the isolate is running perfectly well: it is serving requests
  // it cannot fulfil, which is precisely the state a deploy gate should catch.
  // Missing *feature* keys are reported but do not change the status -- a
  // deployment without RESEND_API_KEY is a valid deployment with email off, and
  // flagging it would make the signal meaningless.
  const configResult = validateWorkerConfig(env);
  result.checks.config = {
    status: configResult.ok ? 'pass' : 'fail',
    ...(configResult.missingRequired.length > 0
      ? { missingRequired: configResult.missingRequired }
      : {}),
    ...(configResult.missingFeatures.length > 0
      ? { missingFeatures: configResult.missingFeatures }
      : {}),
  };
  if (!configResult.ok) {
    result.status = 'unhealthy';
  }

  // The R2 and database branches below assign `degraded` directly. Left as-is
  // that would *downgrade* the `unhealthy` just set -- a missing
  // NEON_CONNECTION_STRING would be reported as merely degraded the moment an
  // unrelated R2 list also failed, which is the exact combination a broken
  // deploy produces. `degrade` only ever moves the status in the worsening
  // direction.
  const degrade = () => {
    if (result.status === 'healthy') {
      result.status = 'degraded';
    }
  };

  // Optional: Check R2 connectivity
  if (includeConnectivity && env.CSV_UPLOADS) {
    const r2Start = Date.now();
    try {
      // Try to list objects (limit 1) to verify bucket access
      await env.CSV_UPLOADS.list({ limit: 1 });
      result.checks.r2 = {
        status: 'pass',
        responseTime: Date.now() - r2Start,
      };
    } catch (error) {
      result.checks.r2 = {
        status: 'fail',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
      degrade();
    }
  }

  // Optional: Check database connectivity
  const connectionString = env.NEON_CONNECTION_STRING || env.DATABASE_URL;
  if (includeConnectivity && connectionString) {
    const dbStart = Date.now();
    try {
      const sql = neon(connectionString);
      const queryPromise = sql`SELECT 1`;
      // If the timeout wins the race the query is abandoned mid-flight. Without a
      // terminal handler its later rejection is unhandled, which the Workers runtime
      // surfaces as an isolate-level error unrelated to the request that caused it.
      // The rejection is already accounted for by the timeout branch below.
      queryPromise.catch(() => {});
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error('Database connectivity check timed out after 2000ms')),
          2000,
        );
      });
      let rows: unknown[];
      try {
        rows = (await Promise.race([queryPromise, timeoutPromise])) as unknown[];
      } finally {
        // Release the timer on the success path so a healthy deep check does not
        // hold a pending 2s timeout open in the isolate.
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }
      }
      if (!rows || rows.length === 0) {
        throw new Error('Database readiness query returned no rows');
      }
      result.checks.database = {
        status: 'pass',
        responseTime: Date.now() - dbStart,
      };
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : 'Unknown error';
      const redactedMessage = rawMessage
        .replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, 'postgresql://[redacted]@')
        .replace(/password=[^\s]+/gi, 'password=[redacted]');
      result.checks.database = {
        status: 'fail',
        responseTime: Date.now() - dbStart,
        error: redactedMessage,
      };
      degrade();
    }
  }

  return result;
}

/**
 * Get CORS headers for a request
 */
function getCorsHeaders(request: Request, env: Env): HeadersInit {
  const origin = request.headers.get('Origin') || '';

  // Allowed origins for CORS
  const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
    'http://127.0.0.1:3002',
    'https://d412d559.date-management-status.pages.dev',
    'https://date-management-status.pages.dev',
  ];

  // Add frontend URL if configured
  if (env.FRONTEND_URL) {
    allowedOrigins.push(env.FRONTEND_URL);
  }

  // Check if origin is allowed
  let allowedOrigin = '';
  if (origin) {
    try {
      const requestUrl = new URL(origin);
      const isAllowed = allowedOrigins.some((allowed) => {
        try {
          const allowedUrl = new URL(allowed);
          return requestUrl.origin === allowedUrl.origin;
        } catch {
          return origin === allowed;
        }
      });
      allowedOrigin = isAllowed ? origin : '';
    } catch {
      allowedOrigin = allowedOrigins.includes(origin) ? origin : '';
    }
  }

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
  };

  // Add CORS headers if origin is allowed
  if (allowedOrigin) {
    headers['Access-Control-Allow-Origin'] = allowedOrigin;
    headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
    headers['Access-Control-Max-Age'] = '86400';
  }

  return headers;
}

/**
 * Health check request handler
 */
export async function handleHealthCheck(request: Request, env: Env): Promise<Response> {
  // Handle OPTIONS preflight
  if (request.method === 'OPTIONS') {
    return new Response('', {
      status: 204,
      headers: getCorsHeaders(request, env),
    });
  }

  const url = new URL(request.url);
  const includeConnectivity = url.searchParams.get('deep') === 'true';

  try {
    const result = await healthCheck(env, includeConnectivity);

    const statusCode = result.status === 'healthy' ? 200 : result.status === 'degraded' ? 200 : 503;

    return new Response(JSON.stringify(result, null, 2), {
      status: statusCode,
      headers: getCorsHeaders(request, env),
    });
  } catch (error) {
    return new Response(
      JSON.stringify(
        {
          status: 'unhealthy',
          timestamp: new Date().toISOString(),
          error: error instanceof Error ? error.message : 'Health check failed',
        },
        null,
        2,
      ),
      {
        status: 503,
        headers: getCorsHeaders(request, env),
      },
    );
  }
}
