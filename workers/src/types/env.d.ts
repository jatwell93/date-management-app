/**
 * Cloudflare Workers Environment Bindings
 * 
 * This file defines the TypeScript types for environment variables,
 * secrets, and resource bindings available in the Workers runtime.
 */

export interface Env {
  // ============================================================================
  // Environment Variables
  // ============================================================================
  
  NODE_ENV: 'production' | 'staging' | 'development';
  STORAGE_PROVIDER: 'r2' | 'local';
  MAX_FILE_SIZE: string; // e.g., "10485760" (10MB)
  CSV_BATCH_SIZE: string; // e.g., "100"
  RATE_LIMIT_WINDOW: string; // milliseconds
  RATE_LIMIT_MAX_REQUESTS: string;
  RATE_LIMIT_MAX_AUTHENTICATED: string;
  FRONTEND_URL?: string; // Frontend URL for CORS configuration

  // ============================================================================
  // Secrets (Set via wrangler secret put)
  // ============================================================================
  
  // Neon PostgreSQL connection string
  NEON_CONNECTION_STRING: string;
  
  // JWT authentication secret
  JWT_SECRET: string;
  
  // Cloudflare R2 credentials
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET_NAME: string;
  
  // Optional: Sentry DSN for error monitoring (renamed from SENTRY_DSN for clarity)
  WORKERS_SENTRY_DSN?: string;
  SENTRY_DSN?: string; // Deprecated: use WORKERS_SENTRY_DSN

  // ============================================================================
  // R2 Bucket Bindings
  // ============================================================================
  
  // R2 bucket for CSV file uploads
  CSV_UPLOADS: R2Bucket;

  // ============================================================================
  // Hyperdrive Bindings
  // ============================================================================
  
  // Hyperdrive connection to Neon PostgreSQL (edge connection pooling)
  HYPERDRIVE: Hyperdrive;

  // ============================================================================
  // KV Namespace Bindings
  // ============================================================================
  
  // KV namespace for rate limiting (optional, can use Durable Objects instead)
  RATE_LIMITER?: KVNamespace;

  // ============================================================================
  // Analytics Engine Bindings
  // ============================================================================
  
  // Analytics Engine dataset for metrics collection (production only)
  ANALYTICS?: AnalyticsEngineDataset;
}

/**
 * Extended Request type with Cloudflare-specific properties
 */
export interface WorkersRequest extends Request {
  cf?: IncomingRequestCfProperties;
}

/**
 * Context passed to Workers fetch handler
 */
export interface WorkersContext {
  waitUntil(promise: Promise<any>): void;
  passThroughOnException(): void;
}
