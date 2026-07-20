// Environment configuration
// - Node.js: loads .env files using dotenv
// - Workers: expects runtime injection via setWorkerConfig

type RawEnv = Record<string, string | undefined>;

const isNodeRuntime =
  typeof process !== 'undefined' &&
  typeof process.versions !== 'undefined' &&
  typeof process.versions.node === 'string';

const loadDotenv = () => {
  if (!isNodeRuntime) {
    return;
  }

  const dotenv = require('dotenv') as typeof import('dotenv');
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');

  const nodeEnv = (process.env.NODE_ENV || 'development').toLowerCase();

  // Check if .env file exists
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) {
    console.warn(`\n⚠️  No .env file found at ${envPath}`);
    console.warn(`ℹ️  Copy .env.example to .env and configure for ${nodeEnv} environment`);
    console.warn(`   Command: cp .env.example .env\n`);
  }

  dotenv.config({ path: `.env.${nodeEnv}` });
  dotenv.config(); // Load default .env file
};

loadDotenv();

export interface EnvironmentConfig {
  NODE_ENV: string;
  PORT: number;
  JWT_SECRET: string;
  DATABASE_PATH: string;
  DATABASE_URL?: string;
  DATABASE_PROVIDER?: string;
  FRONTEND_URL: string;
  CORS_ORIGIN: string;
  USE_HTTPS: boolean;
  DEFAULT_PIN: string;
  SSL_PRIVATE_KEY_PATH?: string;
  SSL_CERT_PATH?: string;
  STORAGE_PROVIDER?: string;
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET_NAME?: string;
  NEON_CONNECTION_STRING?: string;
  MAX_UPLOAD_SIZE_BYTES: number;
  DIRECT_UPLOAD_THRESHOLD_BYTES: number;
  PRESIGNED_URL_EXPIRY_SECONDS: number;
  CSV_TRANSACTION_MAX_WAIT_MS: number;
  CSV_TRANSACTION_TIMEOUT_MS: number;
  SENTRY_DSN?: string;
  SENTRY_FRONTEND_DSN?: string;
  // Stripe Configuration (for SaaS monetization)
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  // SendGrid Configuration (for email notifications)
  SENDGRID_API_KEY?: string;
  SENDGRID_FROM_EMAIL?: string;
  // Resend Configuration (for supplier credit-claim emails)
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  // Clerk Configuration (for authentication)
  CLERK_SECRET_KEY?: string;
  CLERK_PUBLISHABLE_KEY?: string;
  CLERK_WEBHOOK_SECRET?: string;
  ENABLE_CUSTOM_ORG_INVITES: boolean;
  // Error Handling Configuration
  ERROR_HIDE_STACK_TRACE_IN_PRODUCTION: boolean;
  ERROR_LOG_LEVEL: string;
  // CORS Configuration
  CORS_ORIGINS?: string;
  ALLOW_NO_ORIGIN_IN_PRODUCTION: boolean;
  // Add other required environment variables as needed
}

function fail(message: string, remedy?: string): never {
  if (isNodeRuntime) {
    console.error(`\n❌ ${message}`);
    if (remedy) {
      console.error(`ℹ️  ${remedy}`);
    }
    console.error(`📖 See docs/environment-setup.md for detailed help\n`);
    process.exit(1);
  }
  throw new Error(message);
}

function parseNumber(value: string | undefined, defaultValue?: number, fieldName?: string): number {
  if (value === undefined || value === '') {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    return fail(
      `Missing required environment variable${fieldName ? `: ${fieldName}` : ''}`,
      `Add ${fieldName} to your .env file (see .env.example for the template)`,
    );
  }

  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fail(
      `Invalid ${fieldName ?? 'number'} environment variable: ${value}. Must be a positive number.`,
      `Set ${fieldName} to a positive integer in your .env file`,
    );
  }

  return parsed;
}

function normalizeNodeEnv(rawEnv: string | undefined): string {
  const normalized = (rawEnv || 'development').toLowerCase();
  const validEnvironments = ['development', 'staging', 'production', 'test'];

  if (!validEnvironments.includes(normalized)) {
    return fail(
      `NODE_ENV must be one of: ${validEnvironments.join(', ')}. Got: "${rawEnv}"`,
      `Set NODE_ENV=${validEnvironments[0]} in your .env file for local development`,
    );
  }

  return normalized;
}

function resolveJwtSecret(nodeEnv: string, rawSecret: string | undefined): string {
  if (rawSecret && rawSecret.trim() !== '') {
    return rawSecret;
  }

  const isDevOrTest = nodeEnv === 'development' || nodeEnv === 'test';
  const remedy = isDevOrTest
    ? 'For local development, add JWT_SECRET=dev-secret-change-in-production to your .env file'
    : 'Generate a secure secret with: openssl rand -base64 32';

  return fail('JWT_SECRET environment variable is missing or empty', remedy);
}

function resolveFrontendUrl(env: RawEnv): string {
  return env.FRONTEND_URL || env.CORS_ORIGIN || 'http://localhost:3000';
}

function resolveCorsOrigin(env: RawEnv): string {
  return env.CORS_ORIGIN || env.FRONTEND_URL || 'http://localhost:3000';
}

function validateEnvironment(env: RawEnv, allowMissingRequired: boolean): EnvironmentConfig {
  const nodeEnv = normalizeNodeEnv(env.NODE_ENV);
  const isProduction = nodeEnv === 'production';
  const portDefault = isProduction && !allowMissingRequired ? undefined : 3001;

  const port = parseNumber(env.PORT, portDefault, 'PORT');
  const jwtSecret = resolveJwtSecret(nodeEnv, env.JWT_SECRET);

  const maxUploadSize = Number(env.MAX_UPLOAD_SIZE_BYTES || env.MAX_FILE_SIZE || 10 * 1024 * 1024);
  const directThreshold = Number(
    env.DIRECT_UPLOAD_THRESHOLD_BYTES || env.DIRECT_UPLOAD_THRESHOLD || 2 * 1024 * 1024,
  );
  const presignedUrlExpirySeconds = Number(env.PRESIGNED_URL_EXPIRY_SECONDS || 6 * 60 * 60);
  const csvTransactionMaxWaitMs = Number(env.CSV_TRANSACTION_MAX_WAIT_MS || 10000);
  const csvTransactionTimeoutMs = Number(env.CSV_TRANSACTION_TIMEOUT_MS || 60000);

  return {
    NODE_ENV: nodeEnv,
    PORT: port,
    JWT_SECRET: jwtSecret,
    DATABASE_PATH: env.DATABASE_PATH || './database.sqlite',
    DATABASE_URL: env.DATABASE_URL || env.NEON_CONNECTION_STRING,
    DATABASE_PROVIDER: env.DATABASE_PROVIDER,
    FRONTEND_URL: resolveFrontendUrl(env),
    CORS_ORIGIN: resolveCorsOrigin(env),
    DEFAULT_PIN: env.DEFAULT_PIN || '5624',
    USE_HTTPS: env.USE_HTTPS === 'true',
    SSL_PRIVATE_KEY_PATH: env.SSL_PRIVATE_KEY_PATH,
    SSL_CERT_PATH: env.SSL_CERT_PATH,
    STORAGE_PROVIDER: env.STORAGE_PROVIDER,
    R2_ACCOUNT_ID: env.R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY,
    R2_BUCKET_NAME: env.R2_BUCKET_NAME,
    NEON_CONNECTION_STRING: env.NEON_CONNECTION_STRING,
    MAX_UPLOAD_SIZE_BYTES: Number.isNaN(maxUploadSize) ? 10 * 1024 * 1024 : maxUploadSize,
    DIRECT_UPLOAD_THRESHOLD_BYTES: Number.isNaN(directThreshold)
      ? 2 * 1024 * 1024
      : directThreshold,
    PRESIGNED_URL_EXPIRY_SECONDS: Number.isNaN(presignedUrlExpirySeconds)
      ? 6 * 60 * 60
      : presignedUrlExpirySeconds,
    CSV_TRANSACTION_MAX_WAIT_MS: Number.isNaN(csvTransactionMaxWaitMs)
      ? 10000
      : csvTransactionMaxWaitMs,
    CSV_TRANSACTION_TIMEOUT_MS: Number.isNaN(csvTransactionTimeoutMs)
      ? 60000
      : csvTransactionTimeoutMs,
    SENTRY_DSN: env.SENTRY_DSN,
    SENTRY_FRONTEND_DSN: env.SENTRY_FRONTEND_DSN,
    // Stripe Configuration (for SaaS monetization)
    STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: env.STRIPE_WEBHOOK_SECRET,
    // SendGrid Configuration (for email notifications)
    SENDGRID_API_KEY: env.SENDGRID_API_KEY,
    SENDGRID_FROM_EMAIL: env.SENDGRID_FROM_EMAIL,
    // Resend Configuration (for supplier credit-claim emails)
    RESEND_API_KEY: env.RESEND_API_KEY,
    RESEND_FROM_EMAIL: env.RESEND_FROM_EMAIL,
    // Clerk Configuration (for authentication)
    CLERK_SECRET_KEY: env.CLERK_SECRET_KEY, // Required in production, optional during development
    CLERK_PUBLISHABLE_KEY: env.CLERK_PUBLISHABLE_KEY,
    CLERK_WEBHOOK_SECRET: env.CLERK_WEBHOOK_SECRET,
    ENABLE_CUSTOM_ORG_INVITES: env.ENABLE_CUSTOM_ORG_INVITES === 'true',
    // Error Handling Configuration
    ERROR_HIDE_STACK_TRACE_IN_PRODUCTION: nodeEnv === 'production',
    ERROR_LOG_LEVEL: env.ERROR_LOG_LEVEL || 'error',
    // CORS Configuration
    CORS_ORIGINS: env.CORS_ORIGINS,
    ALLOW_NO_ORIGIN_IN_PRODUCTION: env.ALLOW_NO_ORIGIN_IN_PRODUCTION === 'true',
  };
}

let workerEnvOverrides: RawEnv | undefined;

export function setWorkerConfig(env: RawEnv): void {
  workerEnvOverrides = env;
  envConfig = validateEnvironment(workerEnvOverrides, false);
}

function getRuntimeEnv(): RawEnv {
  if (isNodeRuntime) {
    return process.env as RawEnv;
  }
  return workerEnvOverrides || {};
}

export let envConfig = validateEnvironment(getRuntimeEnv(), !isNodeRuntime);
