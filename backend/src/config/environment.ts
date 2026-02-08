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

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const dotenv = require('dotenv') as typeof import('dotenv');
  const nodeEnv = (process.env.NODE_ENV || 'development').toLowerCase();

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
  SENTRY_DSN?: string;
  SENTRY_FRONTEND_DSN?: string;
  // Error Handling Configuration
  ERROR_HIDE_STACK_TRACE_IN_PRODUCTION: boolean;
  ERROR_LOG_LEVEL: string;
  // CORS Configuration
  CORS_ORIGINS?: string;
  // Add other required environment variables as needed
}

function fail(message: string): never {
  if (isNodeRuntime) {
    console.error(message);
    process.exit(1);
  }
  throw new Error(message);
}

function parseNumber(value: string | undefined, defaultValue?: number, fieldName?: string): number {
  if (value === undefined || value === '') {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    return fail(`Missing required environment variable${fieldName ? `: ${fieldName}` : ''}`);
  }

  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fail(
      `Invalid ${fieldName ?? 'number'} environment variable: ${value}. Must be a positive number.`,
    );
  }

  return parsed;
}

function normalizeNodeEnv(rawEnv: string | undefined): string {
  const normalized = (rawEnv || 'development').toLowerCase();
  const validEnvironments = ['development', 'staging', 'production', 'test'];

  if (!validEnvironments.includes(normalized)) {
    return fail(`NODE_ENV must be one of: ${validEnvironments.join(', ')}`);
  }

  return normalized;
}

function resolveJwtSecret(nodeEnv: string, rawSecret: string | undefined): string {
  if (rawSecret && rawSecret.trim() !== '') {
    return rawSecret;
  }

  if (nodeEnv === 'production') {
    return fail('JWT_SECRET environment variable is empty');
  }

  return nodeEnv === 'test' ? 'test-secret' : 'dev-secret';
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
  if (!allowMissingRequired && isProduction && (!env.JWT_SECRET || env.JWT_SECRET.trim() === '')) {
    fail('JWT_SECRET environment variable is empty');
  }

  const maxUploadSize = Number(env.MAX_UPLOAD_SIZE_BYTES || env.MAX_FILE_SIZE || 10 * 1024 * 1024);
  const directThreshold = Number(
    env.DIRECT_UPLOAD_THRESHOLD_BYTES || env.DIRECT_UPLOAD_THRESHOLD || 2 * 1024 * 1024,
  );

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
    SENTRY_DSN: env.SENTRY_DSN,
    SENTRY_FRONTEND_DSN: env.SENTRY_FRONTEND_DSN,
    // Error Handling Configuration
    ERROR_HIDE_STACK_TRACE_IN_PRODUCTION: nodeEnv === 'production',
    ERROR_LOG_LEVEL: env.ERROR_LOG_LEVEL || 'error',
    // CORS Configuration
    CORS_ORIGINS: env.CORS_ORIGINS,
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
