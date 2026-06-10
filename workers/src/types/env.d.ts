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
  MAX_CONCURRENT_CONNECTIONS?: string; // default: 50
  QUERY_MAX_RESULTS?: string; // default: 100
  QUERY_TIMEOUT_MS?: string; // default: 10000
  FRONTEND_URL?: string; // Frontend URL for CORS + Clerk authorizedParties
  CATALOGUE_QUEUE_ENABLED?: string;
  ENTERPRISE_MAX_SKUS?: string;
  ENTERPRISE_MAX_ACTIVE_EXPIRIES?: string;
  ENTERPRISE_MAX_FILE_SIZE?: string;

  // ============================================================================
  // Secrets (Set via wrangler secret put)
  // ============================================================================

  // Neon PostgreSQL connection string
  NEON_CONNECTION_STRING: string;

  // Fallback database connection string (used when Hyperdrive unavailable)
  DATABASE_URL?: string;

  // JWT authentication secret
  JWT_SECRET: string;

  // Clerk backend secret for verifying Clerk session tokens
  CLERK_SECRET_KEY?: string;

  // Clerk Svix webhook signing secret (whsec_...)
  CLERK_WEBHOOK_SECRET: string;

  // Cloudflare R2 credentials
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET_NAME: string;

  // Optional: Sentry DSN for error monitoring
  WORKERS_SENTRY_DSN?: string;

  // ============================================================================
  // R2 Bucket Bindings
  // ============================================================================

  // R2 bucket for CSV file uploads
  CSV_UPLOADS: R2Bucket;

  // Queue for durable catalogue import processing
  CATALOGUE_IMPORT_QUEUE?: Queue<CatalogueImportMessage>;

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

export interface CatalogueImportMessage {
  uploadId: number;
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
