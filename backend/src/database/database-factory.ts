/**
 * Database Factory
 *
 * Creates the appropriate Prisma client based on the environment.
 * - Development: SQLite with local file
 * - Production: PostgreSQL with Neon (via Hyperdrive for Workers, direct for Express)
 *
 * This factory provides environment-based database client creation
 * with proper connection pooling for production.
 */

import { PrismaClient } from './generated/client';

export type DatabaseEnvironment = 'development' | 'production' | 'test';

export interface DatabaseFactoryConfig {
  environment?: DatabaseEnvironment;
  // Connection options
  connectionUrl?: string;
  // Hyperdrive connection (Workers only)
  hyperdriveConnectionString?: string;
  // Logging options
  enableLogging?: boolean;
  logQueries?: boolean;
  // Pool options (production only)
  connectionLimit?: number;
}

/**
 * Detect the current environment from NODE_ENV
 */
function detectEnvironment(): DatabaseEnvironment {
  const nodeEnv = process.env.NODE_ENV?.toLowerCase();

  if (nodeEnv === 'production') {
    return 'production';
  }
  if (nodeEnv === 'test') {
    return 'test';
  }
  return 'development';
}

/**
 * Get the database URL based on environment
 */
function getDatabaseUrl(environment: DatabaseEnvironment, config: DatabaseFactoryConfig): string {
  // Hyperdrive connection string (Workers with Cloudflare Hyperdrive)
  if (config.hyperdriveConnectionString) {
    return config.hyperdriveConnectionString;
  }

  // Use explicit config URL if provided
  if (config.connectionUrl) {
    return config.connectionUrl;
  }

  // Use Neon connection string for production
  if (environment === 'production') {
    const neonUrl = process.env.NEON_CONNECTION_STRING || process.env.DATABASE_URL;
    if (neonUrl) {
      return neonUrl;
    }
    throw new Error('Production environment requires NEON_CONNECTION_STRING or DATABASE_URL');
  }

  // Use environment variable for other cases
  const envUrl = process.env.DATABASE_URL;
  if (envUrl) {
    return envUrl;
  }

  // Default SQLite URLs for development/test
  if (environment === 'test') {
    return 'file:./test.db';
  }
  return 'file:./database.sqlite';
}

/**
 * Get Prisma log options based on config
 */
function getLogOptions(config: DatabaseFactoryConfig): Array<'query' | 'info' | 'warn' | 'error'> {
  const logs: Array<'query' | 'info' | 'warn' | 'error'> = ['warn', 'error'];

  if (config.enableLogging || config.logQueries) {
    logs.push('info');
  }
  if (config.logQueries) {
    logs.push('query');
  }

  return logs;
}

/**
 * Create a Prisma client with environment-appropriate configuration
 */
export function createDatabaseClient(config: DatabaseFactoryConfig = {}): PrismaClient {
  const environment = config.environment ?? detectEnvironment();
  const databaseUrl = getDatabaseUrl(environment, config);
  const logOptions = getLogOptions(config);

  // Create Prisma client with appropriate settings
  const client = new PrismaClient({
    log: logOptions,
    // Data source override with connection URL
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
  });

  // Log connection type for debugging (no sensitive data)
  if (config.hyperdriveConnectionString) {
    console.log('[Database] Connecting via Cloudflare Hyperdrive (edge pooling)');
  } else if (environment === 'production') {
    console.log('[Database] Connecting to Neon PostgreSQL (production mode)');
  } else {
    console.log(`[Database] Using SQLite (${environment} mode)`);
  }

  return client;
}

/**
 * Get the database provider type for the current environment
 */
export function getDatabaseProvider(config: DatabaseFactoryConfig = {}): 'sqlite' | 'postgresql' {
  const environment = config.environment ?? detectEnvironment();
  return environment === 'production' ? 'postgresql' : 'sqlite';
}

// ============================================================================
// Singleton Pattern for Default Client
// ============================================================================

let defaultClient: PrismaClient | null = null;

/**
 * Get the default database client (singleton)
 * Creates the client on first call based on environment
 */
export function getDefaultDatabaseClient(): PrismaClient {
  if (!defaultClient) {
    defaultClient = createDatabaseClient();
  }
  return defaultClient;
}

/**
 * Reset the default client (useful for testing)
 */
export async function resetDefaultDatabaseClient(): Promise<void> {
  if (defaultClient) {
    await defaultClient.$disconnect();
    defaultClient = null;
  }
}

/**
 * Gracefully disconnect the database client
 * Should be called on application shutdown
 */
export async function disconnectDatabase(): Promise<void> {
  await resetDefaultDatabaseClient();
}

// ============================================================================
// Transaction Helpers
// ============================================================================

export type TransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/**
 * Execute operations within a transaction
 * Provides automatic rollback on error
 */
export async function withTransaction<T>(
  client: PrismaClient,
  fn: (tx: TransactionClient) => Promise<T>,
): Promise<T> {
  return client.$transaction(fn);
}

/**
 * Execute operations within a transaction with custom options
 */
export async function withTransactionOptions<T>(
  client: PrismaClient,
  fn: (tx: TransactionClient) => Promise<T>,
  options?: {
    maxWait?: number; // Maximum time to wait to acquire a transaction (ms)
    timeout?: number; // Maximum time the transaction can run (ms)
  },
): Promise<T> {
  return client.$transaction(fn, options);
}
