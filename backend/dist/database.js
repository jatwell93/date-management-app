"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDb = getDb;
exports.releaseDb = releaseDb;
exports.initDatabase = initDatabase;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const environment_1 = require("./config/environment");
const logger_1 = require("./utils/logger");
let db;
/**
 * Verify TLS/SSL configuration for database connections
 * Task 5.2: Add TLS verification check and logging
 */
function verifyDatabaseSecurity() {
    const { DATABASE_PROVIDER, DATABASE_URL, NODE_ENV } = environment_1.envConfig;
    // For PostgreSQL in production, verify SSL/TLS is enforced
    if (DATABASE_PROVIDER === 'postgresql') {
        if (!DATABASE_URL) {
            logger_1.Logger.warn('DATABASE_URL not configured for PostgreSQL');
            return;
        }
        const hasSSLMode = DATABASE_URL.includes('sslmode=require') || DATABASE_URL.includes('sslmode=verify-full');
        if (NODE_ENV === 'production' && !hasSSLMode) {
            logger_1.Logger.error('⚠️  SECURITY WARNING: DATABASE_URL missing sslmode=require in production!');
            logger_1.Logger.error('   Add ?sslmode=require to DATABASE_URL for encrypted connections');
        }
        else if (hasSSLMode) {
            logger_1.Logger.info('✅ Database TLS/SSL: Enabled (sslmode detected in connection string)');
        }
        else {
            logger_1.Logger.info(`ℹ️  Database TLS/SSL: Not enforced (${NODE_ENV} environment)`);
        }
    }
    else if (DATABASE_PROVIDER === 'sqlite') {
        logger_1.Logger.info('ℹ️  Database: SQLite (local file, TLS/SSL not applicable)');
    }
    else {
        logger_1.Logger.info(`ℹ️  Database Provider: ${DATABASE_PROVIDER}`);
    }
}
function getDb() {
    if (!db) {
        db = new better_sqlite3_1.default(environment_1.envConfig.DATABASE_PATH || './database.sqlite');
        // Verify security configuration on first connection
        verifyDatabaseSecurity();
    }
    return db;
}
function releaseDb(_db) {
    // better-sqlite3 doesn't have connection pooling, so this is a no-op
}
async function initDatabase() {
    // This function is now a no-op, as the database is initialized on first call to getDb()
}
