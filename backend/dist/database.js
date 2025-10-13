"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDb = getDb;
exports.releaseDb = releaseDb;
exports.getDbWithMonitoring = getDbWithMonitoring;
exports.initDatabase = initDatabase;
// Database setup and initialization with connection pooling
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const bcrypt_1 = __importDefault(require("bcrypt"));
const environment_1 = require("./config/environment");
const logger_1 = require("./utils/logger");
// Import the migration service
const migrate_1 = require("./migrations/migrate");
// Import the monitoring service
const database_monitoring_service_1 = require("./services/database.monitoring.service");
// Define a simple connection pool
class DatabasePool {
    constructor() {
        this.connections = [];
        this.maxConnections = 10; // Maximum connections in the pool
        this.currentConnections = 0;
        this.dbPath = environment_1.envConfig.DATABASE_PATH || "./database.sqlite";
    }
    // Get a database connection from the pool
    acquire() {
        // If we have a connection in the pool, return it
        if (this.connections.length > 0) {
            const connection = this.connections.pop();
            if (connection && connection.open) {
                logger_1.Logger.debug("Reusing database connection from pool");
                return connection;
            }
        }
        // If we haven't reached the max connections limit, create a new one
        if (this.currentConnections < this.maxConnections) {
            const connection = new better_sqlite3_1.default(this.dbPath);
            this.currentConnections++;
            logger_1.Logger.info(`Created new database connection. Total connections: ${this.currentConnections}`);
            return connection;
        }
        // If we've reached max connections, create an additional connection (but log it)
        logger_1.Logger.warn("Database pool at maximum capacity, creating additional connection");
        const connection = new better_sqlite3_1.default(this.dbPath);
        this.currentConnections++;
        return connection;
    }
    // Release a connection back to the pool
    release(connection) {
        if (connection && connection.open && this.connections.length < this.maxConnections) {
            this.connections.push(connection);
            logger_1.Logger.debug("Connection returned to pool");
        }
        else {
            // If pool is full or connection is closed, close the connection
            if (connection && connection.open) {
                connection.close();
                this.currentConnections--;
                logger_1.Logger.info(`Database connection closed. Total connections: ${this.currentConnections}`);
            }
        }
    }
    // Close all connections in the pool
    closeAll() {
        for (const connection of this.connections) {
            if (connection.open) {
                connection.close();
                this.currentConnections--;
            }
        }
        this.connections = [];
        logger_1.Logger.info("All database connections closed");
    }
}
const pool = new DatabasePool();
function getDb() {
    try {
        const db = pool.acquire();
        return db;
    }
    catch (error) {
        logger_1.Logger.error("Failed to acquire database connection", {
            error: error instanceof Error ? error.message : 'Unknown error'
        });
        throw error;
    }
}
// Function to release a connection back to the pool
function releaseDb(db) {
    try {
        pool.release(db);
    }
    catch (error) {
        logger_1.Logger.error("Failed to release database connection", {
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
}
// Initialize the database using migrations
// Enhanced database functions with monitoring
function getDbWithMonitoring() {
    const db = getDb();
    // Add query execution time monitoring
    // Note: TypeScript might not recognize the 'on' method on Database type
    // because better-sqlite3 types can vary based on installation
    db.on('profile', (query, time) => {
        // Convert nanoseconds to milliseconds
        const duration = time / 1000000;
        database_monitoring_service_1.DatabaseMonitoringService.getInstance().recordQuery(duration);
        if (duration > 100) { // 100ms threshold for slow queries
            logger_1.Logger.warn(`Slow query detected (${duration}ms): ${query}`);
        }
    });
    return db;
}
async function initDatabase() {
    try {
        // Run all pending migrations
        await (0, migrate_1.runMigrations)();
        // Get a database connection to add the default user
        const db = getDb();
        try {
            // Check if a user with any PIN already exists
            const existingUser = db.prepare("SELECT * FROM users LIMIT 1").get();
            // Clear existing users for a fresh start if we see there are issues
            if (existingUser) {
                // Clear all users
                db.exec("DELETE FROM users");
                logger_1.Logger.info("Cleared existing users during initialization");
            }
            // Create the default user with the configured default PIN and Manager role
            // First, hash the PIN
            const saltRounds = 10;
            const hashedPin = await new Promise((resolve, reject) => {
                bcrypt_1.default.hash(environment_1.envConfig.DEFAULT_PIN, saltRounds, (err, hash) => {
                    if (err) {
                        reject(err);
                    }
                    else {
                        resolve(hash);
                    }
                });
            });
            // Insert the default user
            const insertUserStmt = db.prepare("INSERT OR IGNORE INTO users (pin, role) VALUES (?, 'Manager')");
            insertUserStmt.run(hashedPin);
            logger_1.Logger.info("Default user created/verified successfully", {
                hasExistingUsers: !!existingUser,
                defaultPinUsed: environment_1.envConfig.DEFAULT_PIN
            });
        }
        finally {
            // Always return the connection to the pool after initialization
            releaseDb(db);
        }
    }
    catch (error) {
        logger_1.Logger.error("Database initialization failed", {
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined
        });
        throw error;
    }
}
