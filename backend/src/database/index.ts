/**
 * Database Module
 *
 * Exports database abstraction layer for Prisma client management
 * across development (SQLite) and production (PlanetScale MySQL).
 */

// Factory functions and types
export {
  createDatabaseClient,
  getDatabaseProvider,
  getDefaultDatabaseClient,
  resetDefaultDatabaseClient,
  disconnectDatabase,
  withTransaction,
  withTransactionOptions,
  DatabaseEnvironment,
  DatabaseFactoryConfig,
  TransactionClient,
} from './database-factory';

// Re-export Prisma client and types for convenience
export { PrismaClient } from './generated/client';
