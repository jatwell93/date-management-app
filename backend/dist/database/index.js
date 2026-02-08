"use strict";
/**
 * Database Module
 *
 * Exports database abstraction layer for Prisma client management
 * across development (SQLite) and production (PlanetScale MySQL).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrismaClient = exports.withTransactionOptions = exports.withTransaction = exports.disconnectDatabase = exports.resetDefaultDatabaseClient = exports.getDefaultDatabaseClient = exports.getDatabaseProvider = exports.createDatabaseClient = void 0;
// Factory functions and types
var database_factory_1 = require("./database-factory");
Object.defineProperty(exports, "createDatabaseClient", { enumerable: true, get: function () { return database_factory_1.createDatabaseClient; } });
Object.defineProperty(exports, "getDatabaseProvider", { enumerable: true, get: function () { return database_factory_1.getDatabaseProvider; } });
Object.defineProperty(exports, "getDefaultDatabaseClient", { enumerable: true, get: function () { return database_factory_1.getDefaultDatabaseClient; } });
Object.defineProperty(exports, "resetDefaultDatabaseClient", { enumerable: true, get: function () { return database_factory_1.resetDefaultDatabaseClient; } });
Object.defineProperty(exports, "disconnectDatabase", { enumerable: true, get: function () { return database_factory_1.disconnectDatabase; } });
Object.defineProperty(exports, "withTransaction", { enumerable: true, get: function () { return database_factory_1.withTransaction; } });
Object.defineProperty(exports, "withTransactionOptions", { enumerable: true, get: function () { return database_factory_1.withTransactionOptions; } });
// Re-export Prisma client and types for convenience
var client_1 = require("@prisma/client");
Object.defineProperty(exports, "PrismaClient", { enumerable: true, get: function () { return client_1.PrismaClient; } });
