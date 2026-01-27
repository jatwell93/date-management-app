/**
 * Database Factory
 *
 * Creates the appropriate Prisma client based on the environment.
 * - Development: SQLite with local file
 * - Production: MySQL with PlanetScale (serverless)
 * 
 * This factory provides environment-based database client creation
 * with proper connection pooling for production.
 */

import { PrismaClient } from '@prisma/client';

export type DatabaseEnvironment = 'development' | 'production' | 'test';

export interface DatabaseFactoryConfig {
  environment?: DatabaseEnvironment;
  // Connection options
  connectionUrl?: string;
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
function getDatabaseUrl(environment: DatabaseEnvironment, configUrl?: string): string {
  // Use explicit config URL if provided
  if (configUrl) {
    return configUrl;
  }

  // Use environment variable
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
  const _databaseUrl = getDatabaseUrl(environment, config.connectionUrl);
  const logOptions = getLogOptions(config);

  // Create Prisma client with appropriate settings
  const client = new PrismaClient({
    log: logOptions,
    // Data source override if URL is provided
    datasources: config.connectionUrl ? {
      db: {
        url: config.connectionUrl,
      },
    } : undefined,
  });

  // For production with PlanetScale, we rely on Prisma's built-in
  // connection management which works well with serverless
  if (environment === 'production') {
    // Log connection for debugging (no sensitive data)
    console.log('[Database] Connecting to PlanetScale (production mode)');
  } else {
    console.log(`[Database] Using SQLite (${environment} mode)`);
  }

  return client;
}

/**
 * Get the database provider type for the current environment
 */
export function getDatabaseProvider(config: DatabaseFactoryConfig = {}): 'sqlite' | 'mysql' {
  const environment = config.environment ?? detectEnvironment();
  return environment === 'production' ? 'mysql' : 'sqlite';
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
  fn: (tx: TransactionClient) => Promise<T>
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
  }
): Promise<T> {
  return client.$transaction(fn, options);
}
